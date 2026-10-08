import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:mime/mime.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../auth/auth_models.dart';

import '../../core/api_client.dart';
import '../../core/api_exception.dart';
import '../../core/token_store.dart';
import '../../l10n/l10n.dart';
import '../upload/chunk_source.dart';
import '../upload/upload_service.dart';
import 'auto_upload_background.dart';
import 'auto_upload_settings.dart';

class SyncResult {
  const SyncResult({required this.uploaded, required this.duplicates, required this.failed, required this.skippedReason});
  final int uploaded;
  final int duplicates;
  final int failed;
  /// Gesetzt, wenn gar nicht synchronisiert wurde (z.B. kein WLAN, keine Berechtigung)
  final String? skippedReason;

  String get summary {
    if (skippedReason != null) return skippedReason!;
    final l10n = currentL10n();
    final parts = <String>[
      if (uploaded > 0) l10n.autoUploadSummaryUploaded(uploaded),
      if (duplicates > 0) l10n.autoUploadSummaryDuplicates(duplicates),
      if (failed > 0) l10n.autoUploadSummaryFailed(failed),
    ];
    return parts.isEmpty ? l10n.autoUploadSummaryNothingNew : parts.join(', ');
  }
}

/// Lädt neue Galerie-Aufnahmen hoch. Läuft im Vordergrund (App-Resume, „Jetzt synchronisieren“)
/// und im Hintergrund (Workmanager) – deshalb ohne Riverpod, nur mit SharedPreferences.
class AutoUploadService {
  AutoUploadService({required this.prefs, required this.baseUrl, void Function(String)? log}) : _log = log ?? debugPrint;

  final SharedPreferences prefs;
  final String baseUrl;
  final void Function(String) _log;

  /// Pro Lauf höchstens so viele Dateien, damit Hintergrundfenster (iOS ~30 s, Android 10 min) reichen.
  static const maxPerRun = 25;

  static bool get platformSupported => !kIsWeb && (defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS);

  Future<SyncResult> run() async {
    final store = AutoUploadStore(prefs);
    final settings = store.read();
    final l10n = currentL10n();
    if (!settings.enabled || settings.familyId == null) return SyncResult(uploaded: 0, duplicates: 0, failed: 0, skippedReason: l10n.autoUploadSkipOff);
    if (!platformSupported) return SyncResult(uploaded: 0, duplicates: 0, failed: 0, skippedReason: l10n.autoUploadSkipPlatform);

    final tokens = TokenStore();
    if (!await tokens.hasSession()) return SyncResult(uploaded: 0, duplicates: 0, failed: 0, skippedReason: l10n.autoUploadSkipNotSignedIn);

    if (settings.wifiOnly) {
      final conn = await Connectivity().checkConnectivity();
      final onWifi = conn.contains(ConnectivityResult.wifi) || conn.contains(ConnectivityResult.ethernet);
      if (!onWifi) return SyncResult(uploaded: 0, duplicates: 0, failed: 0, skippedReason: l10n.autoUploadSkipWaitingWifi);
    }

    final permission = await PhotoManager.requestPermissionExtend();
    if (!permission.hasAccess) return SyncResult(uploaded: 0, duplicates: 0, failed: 0, skippedReason: l10n.autoUploadSkipNoPhotoAccess);

    // Upload-Recht kann jederzeit entzogen werden: vor jedem Lauf prüfen, sonst Auto-Upload abschalten.
    final rights = await _checkUploadRight(tokens, settings.familyId!);
    if (rights != null) {
      await store.write(settings.copyWith(enabled: false, lastRunAt: DateTime.now(), lastRunSummary: rights));
      await AutoUploadBackground.cancel();
      _log('Auto-Upload abgeschaltet: $rights');
      return SyncResult(uploaded: 0, duplicates: 0, failed: 0, skippedReason: rights);
    }

    final since = settings.since ?? DateTime.now();
    final assets = await _newAssets(since: since, includeVideos: settings.includeVideos, done: store.doneAssetIds());
    if (assets.isEmpty) {
      await _finish(store, settings, const SyncResult(uploaded: 0, duplicates: 0, failed: 0, skippedReason: null));
      return const SyncResult(uploaded: 0, duplicates: 0, failed: 0, skippedReason: null);
    }

    final api = ApiClient(baseUrl: baseUrl, tokens: tokens, onSessionExpired: () {});
    final uploader = UploadService(api);
    var uploaded = 0, duplicates = 0, failed = 0;
    final done = <String>[];

    try {
      for (final asset in assets.take(maxPerRun)) {
        try {
          final prepared = await _prepare(asset);
          if (prepared == null) {
            failed++;
            continue;
          }
          final source = ChunkSource.fromPath(prepared.path, await prepared.file.length())!;
          try {
            final result = await uploader.upload(
              familyId: settings.familyId!,
              source: source,
              fileName: prepared.name,
              mimeType: prepared.mimeType,
              takenAt: asset.createDateTime,
              onProgress: (_, _) {},
            );
            result.duplicate ? duplicates++ : uploaded++;
            done.add(asset.id);
          } finally {
            await source.close();
            if (prepared.temporary) {
              try {
                await prepared.file.delete();
              } catch (_) {}
            }
          }
        } on ApiException catch (e) {
          if (e.status == 415) {
            // Format wird nie gehen (z.B. exotischer Codec) – nicht ewig erneut versuchen
            done.add(asset.id);
          }
          failed++;
          _log('Auto-Upload ${asset.id}: ${e.detail}');
        } catch (e) {
          failed++;
          _log('Auto-Upload ${asset.id}: $e');
        }
      }
    } finally {
      api.dispose();
    }

    await store.markDone(done);
    final result = SyncResult(uploaded: uploaded, duplicates: duplicates, failed: failed, skippedReason: null);
    await _finish(store, settings, result);
    return result;
  }

  /// null = darf hochladen; sonst der Grund, warum der Auto-Upload abgeschaltet wird.
  /// Netzfehler zählen nicht als Entzug (dann wird einfach dieser Lauf übersprungen).
  Future<String?> _checkUploadRight(TokenStore tokens, String familyId) async {
    final api = ApiClient(baseUrl: baseUrl, tokens: tokens, onSessionExpired: () {});
    final l10n = currentL10n();
    try {
      final data = await api.dio.get<List<dynamic>>('/families').unwrap();
      final families = data.map((e) => Family.fromJson(e as Map<String, dynamic>)).toList();
      final family = families.where((f) => f.id == familyId).firstOrNull;
      if (family == null) return l10n.autoUploadOffNotMember;
      if (!family.membership.canUpload) return l10n.autoUploadOffNoRight(family.name);
      return null;
    } on ApiException catch (e) {
      // Recht lässt sich nicht prüfen (Server nicht erreichbar, Session abgelaufen): diesen Lauf auslassen
      throw StateError(l10n.autoUploadRightCheckFailed(e.detail));
    } finally {
      api.dispose();
    }
  }

  Future<void> _finish(AutoUploadStore store, AutoUploadSettings settings, SyncResult result) => store.write(
    settings.copyWith(lastRunAt: DateTime.now(), lastRunSummary: result.summary, uploadedCount: settings.uploadedCount + result.uploaded),
  );

  /// Neue Aufnahmen seit `since`, älteste zuerst, ohne bereits erledigte.
  Future<List<AssetEntity>> _newAssets({required DateTime since, required bool includeVideos, required Set<String> done}) async {
    final filter = FilterOptionGroup(
      createTimeCond: DateTimeCond(min: since, max: DateTime.now().add(const Duration(days: 1))),
      orders: const [OrderOption(type: OrderOptionType.createDate, asc: true)],
    );
    final paths = await PhotoManager.getAssetPathList(
      onlyAll: true,
      type: includeVideos ? RequestType.common : RequestType.image,
      filterOption: filter,
    );
    if (paths.isEmpty) return const [];
    final all = paths.first;
    final count = await all.assetCountAsync;
    if (count == 0) return const [];
    final assets = await all.getAssetListRange(start: 0, end: count);
    return assets.where((a) => !done.contains(a.id)).toList();
  }

  /// Datei fürs Hochladen bereitstellen: HEIC/HEIF wird zu JPEG gewandelt (der Server kann kein HEVC).
  Future<_Prepared?> _prepare(AssetEntity asset) async {
    final title = await asset.titleAsync;
    final name = title.isNotEmpty ? title : '${asset.id}.${asset.type == AssetType.video ? 'mp4' : 'jpg'}';
    final ext = name.contains('.') ? name.split('.').last.toLowerCase() : '';
    final isHeic = ext == 'heic' || ext == 'heif';

    if (asset.type == AssetType.video) {
      final file = await asset.originFile;
      if (file == null) return null;
      final mime = (await asset.mimeTypeAsync) ?? lookupMimeType(name) ?? 'video/mp4';
      return _Prepared(file: file, name: name, mimeType: mime, temporary: false);
    }

    if (isHeic) {
      // iOS liefert über `file` (nicht `originFile`) bereits eine kompatible JPEG-Version
      final file = await asset.file;
      if (file == null) return null;
      final jpegName = '${name.substring(0, name.length - ext.length)}jpg';
      if (await _looksLikeJpeg(file)) return _Prepared(file: file, name: jpegName, mimeType: 'image/jpeg', temporary: false);
      final target = '${file.path}.jpg';
      final out = await FlutterImageCompress.compressAndGetFile(file.path, target, quality: 92, keepExif: true, format: CompressFormat.jpeg, minWidth: 6000, minHeight: 6000);
      if (out == null) return null;
      return _Prepared(file: File(out.path), name: jpegName, mimeType: 'image/jpeg', temporary: true);
    }

    final file = await asset.originFile;
    if (file == null) return null;
    final mime = (await asset.mimeTypeAsync) ?? lookupMimeType(name) ?? 'image/jpeg';
    return _Prepared(file: file, name: name, mimeType: mime, temporary: false);
  }

  Future<bool> _looksLikeJpeg(File f) async {
    final raf = await f.open();
    try {
      final head = await raf.read(3);
      return head.length == 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF;
    } finally {
      await raf.close();
    }
  }
}

class _Prepared {
  const _Prepared({required this.file, required this.name, required this.mimeType, required this.temporary});
  final File file;
  final String name;
  final String mimeType;
  /// Konvertierte Zwischendatei – nach dem Upload löschen
  final bool temporary;
  String get path => file.path;
}
