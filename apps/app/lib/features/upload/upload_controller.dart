import 'dart:async';

import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mime/mime.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../../l10n/l10n.dart';
import 'chunk_source.dart';
import 'upload_service.dart';

enum UploadStatus { queued, running, done, duplicate, failed, cancelled }

class UploadTask {
  UploadTask({required this.id, required this.fileName, required this.sizeBytes, required this.familyId, required this.file, this.preloaded});

  final String id;
  final String fileName;
  int sizeBytes;
  final String familyId;
  final PlatformFile file;
  /// Web: Dateiinhalt wird sofort bei der Auswahl gelesen – Safari entzieht der Seite sonst nach kurzer Zeit
  /// den Zugriff auf gewählte Dateien, und spätere Uploads einer Mehrfachauswahl scheitern.
  final Future<Uint8List>? preloaded;
  CancelToken cancel = CancelToken();

  UploadStatus status = UploadStatus.queued;
  double progress = 0;
  String phase = currentL10n().uploadPhaseWaiting;
  String? error;
  String? mediaId;
  int attempts = 0;

  UploadTask copy() => UploadTask(id: id, fileName: fileName, sizeBytes: sizeBytes, familyId: familyId, file: file, preloaded: preloaded)
    ..cancel = cancel
    ..status = status
    ..progress = progress
    ..phase = phase
    ..error = error
    ..mediaId = mediaId
    ..attempts = attempts;
}

/// Sequenzielle Upload-Warteschlange (ein Upload gleichzeitig, schont Mobilfunk/WLAN).
/// Netzwerkfehler werden automatisch bis zu dreimal wiederholt; die Server-Session macht daraus ein Resume.
class UploadController extends Notifier<List<UploadTask>> {
  static const maxAttempts = 3;
  bool _running = false;
  int _seq = 0;

  @override
  List<UploadTask> build() => const [];

  UploadService get _service => UploadService(ref.read(apiClientProvider));

  void enqueue(String familyId, List<PlatformFile> files) {
    final tasks = [
      for (final f in files)
        UploadTask(
          id: '${DateTime.now().microsecondsSinceEpoch}-${_seq++}',
          fileName: f.name,
          sizeBytes: f.lengthSync() ?? 0,
          familyId: familyId,
          file: f,
          preloaded: kIsWeb ? f.readAsBytes() : null,
        ),
    ];
    state = [...state, ...tasks];
    _drain();
  }

  void cancel(String taskId) {
    final t = state.where((t) => t.id == taskId).firstOrNull;
    if (t == null) return;
    if (t.status == UploadStatus.running) {
      t.cancel.cancel('abgebrochen');
    } else if (t.status == UploadStatus.queued) {
      _update(t..status = UploadStatus.cancelled..phase = currentL10n().uploadPhaseCancelled);
    }
  }

  /// Fehlgeschlagenen oder abgebrochenen Upload erneut einreihen.
  void retry(String taskId) {
    final t = state.where((t) => t.id == taskId).firstOrNull;
    if (t == null || (t.status != UploadStatus.failed && t.status != UploadStatus.cancelled)) return;
    t
      ..status = UploadStatus.queued
      ..phase = currentL10n().uploadPhaseWaiting
      ..error = null
      ..progress = 0
      ..attempts = 0
      ..cancel = CancelToken();
    _update(t);
    _drain();
  }

  void retryAllFailed() {
    for (final t in state.where((t) => t.status == UploadStatus.failed).toList()) {
      retry(t.id);
    }
  }

  /// Fertige/abgebrochene Einträge aus der Liste nehmen.
  void clearFinished() {
    state = state.where((t) => t.status == UploadStatus.queued || t.status == UploadStatus.running).toList();
  }

  void _update(UploadTask t) {
    state = [for (final x in state) x.id == t.id ? t.copy() : x];
  }

  Future<void> _drain() async {
    if (_running) return;
    _running = true;
    try {
      while (true) {
        final next = state.where((t) => t.status == UploadStatus.queued).firstOrNull;
        if (next == null) break;
        await _run(next);
      }
    } finally {
      _running = false;
    }
  }

  Future<void> _run(UploadTask t) async {
    final l10n = currentL10n();
    _update(t..status = UploadStatus.running..phase = l10n.uploadPhasePreparing);
    ChunkSource? source;
    try {
      source = await _sourceFor(t);
      _update(t..sizeBytes = source.length);
      final mime = lookupMimeType(t.fileName) ?? 'application/octet-stream';
      DateTime? takenAtHint;
      try {
        final modified = await t.file.xFile.lastModified();
        // Browser liefern ohne Metadaten gern 1970 – nur plausible Werte weitergeben
        if (modified.year >= 2001 && modified.isBefore(DateTime.now().add(const Duration(days: 1)))) takenAtHint = modified;
      } catch (_) {
        // nicht auf allen Plattformen verfügbar
      }

      while (true) {
        t.attempts++;
        try {
          var lastTick = DateTime.now();
          final result = await _service.upload(
            familyId: t.familyId,
            source: source,
            fileName: t.fileName,
            mimeType: mime,
            takenAt: takenAtHint,
            cancel: t.cancel,
            onProgress: (p, phase) {
              final now = DateTime.now();
              if (now.difference(lastTick).inMilliseconds < 100 && p < 1) return;
              lastTick = now;
              _update(t..progress = p..phase = phase);
            },
          );
          _update(
            t
              ..progress = 1
              ..mediaId = result.mediaId
              ..status = result.duplicate ? UploadStatus.duplicate : UploadStatus.done
              ..phase = result.duplicate ? l10n.uploadPhaseDuplicate : l10n.uploadPhaseDone,
          );
          return;
        } on DioException catch (e) {
          if (CancelToken.isCancel(e)) {
            _update(t..status = UploadStatus.cancelled..phase = l10n.uploadPhaseCancelled);
            return;
          }
          final api = e.error is ApiException ? e.error! as ApiException : ApiException.fromDio(e);
          if (!_shouldRetry(api) || t.attempts >= maxAttempts) {
            _update(t..status = UploadStatus.failed..error = api.detail..phase = l10n.uploadPhaseError);
            return;
          }
          _update(t..phase = l10n.uploadPhaseReconnect(t.attempts + 1, maxAttempts));
          await Future<void>.delayed(Duration(seconds: 2 * t.attempts));
        } on ApiException catch (e) {
          if (!_shouldRetry(e) || t.attempts >= maxAttempts) {
            _update(t..status = UploadStatus.failed..error = e.detail..phase = l10n.uploadPhaseError);
            return;
          }
          _update(t..phase = l10n.uploadPhaseRetry(t.attempts + 1, maxAttempts));
          await Future<void>.delayed(Duration(seconds: 2 * t.attempts));
        }
      }
    } catch (e) {
      _update(t..status = UploadStatus.failed..error = errorMessage(e)..phase = l10n.uploadPhaseError);
    } finally {
      await source?.close();
    }
  }

  /// Netzwerkfehler, Zeitüberschreitungen und Serverfehler lohnen einen neuen Versuch; Client-Fehler (4xx) nicht.
  static bool _shouldRetry(ApiException e) => e.status == 0 || e.status >= 500 || e.status == 408 || e.status == 429;

  /// Mobile/Desktop: von der Platte lesen (Chunks wahlfrei). Web: bereits vorgeladene Bytes verwenden.
  Future<ChunkSource> _sourceFor(UploadTask t) async {
    if (t.preloaded != null) return ChunkSource.fromBytes(await t.preloaded!);
    final path = t.file.path;
    if (!kIsWeb && path != null) {
      final s = ChunkSource.fromPath(path, await t.file.length());
      if (s != null) return s;
    }
    return ChunkSource.fromBytes(await t.file.readAsBytes());
  }
}

final uploadControllerProvider = NotifierProvider<UploadController, List<UploadTask>>(UploadController.new);
