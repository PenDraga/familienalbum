import 'dart:io';

import 'package:dio/dio.dart';
import 'package:share_plus/share_plus.dart';

/// iOS und Android: in der App laden, dann «In Dateien sichern» über das Teilen-Blatt.
bool get exportInApp => Platform.isIOS || Platform.isAndroid;

typedef ExportProgress = void Function(int receivedBytes, int? totalBytes);

Future<void> downloadAndShareExport(
  Dio dio, {
  required String url,
  required String fileName,
  required ExportProgress onProgress,
  required CancelToken cancel,
}) async {
  final dir = await Directory.systemTemp.createTemp('familienalbum-export-');
  final file = File('${dir.path}${Platform.pathSeparator}$fileName');
  try {
    await dio.download(
      url,
      file.path,
      cancelToken: cancel,
      // Der Server streamt ohne Content-Length; grosse Archive dürfen lange dauern.
      options: Options(receiveTimeout: const Duration(hours: 3)),
      onReceiveProgress: (received, total) => onProgress(received, total > 0 ? total : null),
    );
    await SharePlus.instance.share(ShareParams(files: [XFile(file.path, mimeType: 'application/zip', name: fileName)]));
  } finally {
    // Nach dem Teilen-Blatt ist die Datei kopiert (Dateien-App, AirDrop, …)
    await dir.delete(recursive: true).catchError((_) => dir);
  }
}
