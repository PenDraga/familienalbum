import 'package:dio/dio.dart';

/// Web: der Browser lädt den signierten Link selbst herunter.
bool get exportInApp => false;

typedef ExportProgress = void Function(int receivedBytes, int? totalBytes);

Future<void> downloadAndShareExport(
  Dio dio, {
  required String url,
  required String fileName,
  required ExportProgress onProgress,
  required CancelToken cancel,
}) async {
  throw UnsupportedError('Im Web öffnet der Browser den Export direkt.');
}
