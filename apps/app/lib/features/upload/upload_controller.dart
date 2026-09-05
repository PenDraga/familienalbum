import 'dart:async';

import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mime/mime.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
import 'chunk_source.dart';
import 'upload_service.dart';

enum UploadStatus { queued, running, done, duplicate, failed, cancelled }

class UploadTask {
  UploadTask({required this.id, required this.fileName, required this.sizeBytes, required this.familyId, required this.file});

  final String id;
  final String fileName;
  int sizeBytes;
  final String familyId;
  final PlatformFile file;
  final CancelToken cancel = CancelToken();

  UploadStatus status = UploadStatus.queued;
  double progress = 0;
  String phase = 'Wartet';
  String? error;
  String? mediaId;

  UploadTask copy() => UploadTask(id: id, fileName: fileName, sizeBytes: sizeBytes, familyId: familyId, file: file)
    ..status = status
    ..progress = progress
    ..phase = phase
    ..error = error
    ..mediaId = mediaId;
}

/// Sequenzielle Upload-Warteschlange (ein Upload gleichzeitig, schont Mobilfunk/WLAN).
class UploadController extends Notifier<List<UploadTask>> {
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
      _update(t..status = UploadStatus.cancelled..phase = 'Abgebrochen');
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
    _update(t..status = UploadStatus.running..phase = 'Vorbereiten');
    ChunkSource? source;
    try {
      source = await _sourceFor(t.file);
      _update(t..sizeBytes = source.length);
      final mime = lookupMimeType(t.fileName) ?? 'application/octet-stream';
      if (mime.contains('heic') || mime.contains('heif')) {
        throw ApiException(status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', detail: 'HEIC wird nicht unterstützt – bitte als JPEG exportieren.');
      }
      DateTime? takenAtHint;
      try {
        final modified = await t.file.xFile.lastModified();
        // Browser liefern ohne Metadaten gern 1970 – nur plausible Werte weitergeben
        if (modified.year >= 2001 && modified.isBefore(DateTime.now().add(const Duration(days: 1)))) takenAtHint = modified;
      } catch (_) {
        // nicht auf allen Plattformen verfügbar
      }
      var lastTick = DateTime.now();
      final result = await _service.upload(
        familyId: t.familyId,
        source: source,
        fileName: t.fileName,
        mimeType: mime,
        takenAt: takenAtHint,
        cancel: t.cancel,
        onProgress: (p, phase) {
          // UI nicht mit jedem Byte-Event fluten
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
          ..phase = result.duplicate ? 'Bereits vorhanden' : 'Hochgeladen',
      );
    } on DioException catch (e) {
      if (CancelToken.isCancel(e)) {
        _update(t..status = UploadStatus.cancelled..phase = 'Abgebrochen');
      } else {
        _update(t..status = UploadStatus.failed..error = errorMessage(e)..phase = 'Fehler');
      }
    } catch (e) {
      _update(t..status = UploadStatus.failed..error = errorMessage(e)..phase = 'Fehler');
    } finally {
      await source?.close();
    }
  }

  /// Mobile/Desktop: von der Platte lesen (Chunks wahlfrei). Web: Datei in den Speicher laden.
  Future<ChunkSource> _sourceFor(PlatformFile f) async {
    final path = f.path;
    if (!kIsWeb && path != null) {
      final s = ChunkSource.fromPath(path, await f.length());
      if (s != null) return s;
    }
    return ChunkSource.fromBytes(await f.readAsBytes());
  }
}

final uploadControllerProvider = NotifierProvider<UploadController, List<UploadTask>>(UploadController.new);
