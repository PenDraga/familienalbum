import 'dart:io';

import 'package:dio/dio.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:share_plus/share_plus.dart';

import 'prepared_original.dart';

/// Nativ (iOS/Android/Desktop): Original in eine Temp-Datei streamen, danach in die
/// Fotos-Mediathek sichern oder über das System-Teilen-Blatt weitergeben.
Future<PreparedOriginal> prepareOriginal(
  Dio dio, {
  required String url,
  required String fileName,
  required String mimeType,
  required bool isVideo,
  required DownloadProgress onProgress,
}) async {
  final dir = await Directory.systemTemp.createTemp('familienalbum-');
  final file = File('${dir.path}${Platform.pathSeparator}$fileName');
  try {
    await dio.download(
      url,
      file.path,
      onReceiveProgress: (received, total) => onProgress(total > 0 ? received / total : null),
    );
  } catch (e) {
    await dir.delete(recursive: true).catchError((_) => dir);
    rethrow;
  }
  return _IoOriginal(file, dir, mimeType: mimeType, isVideo: isVideo);
}

class _IoOriginal implements PreparedOriginal {
  _IoOriginal(this._file, this._dir, {required this.mimeType, required this.isVideo});
  final File _file;
  final Directory _dir;
  final String mimeType;
  final bool isVideo;

  static bool get _isMobile => Platform.isIOS || Platform.isAndroid;

  @override
  String get fileName => _file.uri.pathSegments.last;

  @override
  bool get canSaveToPhotos => _isMobile;

  @override
  bool get canShare => true;

  @override
  bool get canDownload => false;

  @override
  Future<void> saveToPhotos() async {
    final permission = await PhotoManager.requestPermissionExtend(
      requestOption: const PermissionRequestOption(iosAccessLevel: IosAccessLevel.addOnly),
    );
    if (!permission.hasAccess) {
      throw const OriginalSaveException('Kein Zugriff auf die Fotos-Mediathek. Bitte in den Einstellungen erlauben.');
    }
    final title = fileName;
    if (isVideo) {
      await PhotoManager.editor.saveVideo(_file, title: title);
    } else {
      await PhotoManager.editor.saveImageWithPath(_file.path, title: title);
    }
  }

  @override
  Future<void> share() async {
    await SharePlus.instance.share(ShareParams(files: [XFile(_file.path, mimeType: mimeType, name: fileName)]));
  }

  @override
  Future<void> download() => throw const OriginalSaveException('Nicht verfügbar.');

  @override
  Future<void> dispose() async {
    await _dir.delete(recursive: true).catchError((_) => _dir);
  }
}
