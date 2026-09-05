import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:web/web.dart' as web;

import 'prepared_original.dart';

/// Web: Original in den Speicher laden. Auf mobilen Browsern (iPhone/iPad/Android) bietet das
/// Teilen-Blatt „Bild sichern“/„Video sichern“; am Desktop landet die Datei im Download-Ordner.
Future<PreparedOriginal> prepareOriginal(
  Dio dio, {
  required String url,
  required String fileName,
  required String mimeType,
  required bool isVideo,
  required DownloadProgress onProgress,
}) async {
  final res = await dio.get<List<int>>(
    url,
    options: Options(responseType: ResponseType.bytes),
    onReceiveProgress: (received, total) => onProgress(total > 0 ? received / total : null),
  );
  final data = res.data;
  if (data == null || data.isEmpty) throw const OriginalSaveException('Leere Antwort vom Server.');
  return _WebOriginal(Uint8List.fromList(data), fileName, mimeType);
}

bool get _isMobileBrowser {
  final nav = web.window.navigator;
  final ua = nav.userAgent;
  return nav.maxTouchPoints > 1 || RegExp(r'iPhone|iPad|Android|Mobile').hasMatch(ua);
}

class _WebOriginal implements PreparedOriginal {
  _WebOriginal(this._bytes, this.fileName, this._mimeType);
  Uint8List? _bytes;
  final String _mimeType;

  @override
  final String fileName;

  @override
  bool get canSaveToPhotos => false;

  @override
  bool get canShare {
    if (!_isMobileBrowser) return false;
    final nav = web.window.navigator;
    if (!nav.has('share') || !nav.has('canShare')) return false;
    return nav.canShare(_shareData());
  }

  @override
  bool get canDownload => true;

  web.File _file() {
    final bytes = _bytes ?? (throw const OriginalSaveException('Download bereits verworfen.'));
    return web.File(<JSAny>[bytes.toJS].toJS, fileName, web.FilePropertyBag(type: _mimeType));
  }

  web.ShareData _shareData() => web.ShareData(files: <web.File>[_file()].toJS);

  @override
  Future<void> saveToPhotos() => throw const OriginalSaveException('Im Browser nicht möglich.');

  @override
  Future<void> share() async {
    try {
      await web.window.navigator.share(_shareData()).toDart;
    } catch (e) {
      final msg = e.toString();
      if (msg.contains('AbortError')) return; // Nutzer hat abgebrochen
      throw OriginalSaveException('Teilen nicht möglich: $msg');
    }
  }

  @override
  Future<void> download() async {
    final bytes = _bytes ?? (throw const OriginalSaveException('Download bereits verworfen.'));
    final blob = web.Blob(<JSAny>[bytes.toJS].toJS, web.BlobPropertyBag(type: _mimeType));
    final objectUrl = web.URL.createObjectURL(blob);
    final a = web.HTMLAnchorElement()
      ..href = objectUrl
      ..download = fileName
      ..style.display = 'none';
    web.document.body!.appendChild(a);
    a.click();
    a.remove();
    // Safari braucht den Blob noch kurz, bis der Download angestossen ist
    Future<void>.delayed(const Duration(seconds: 30), () => web.URL.revokeObjectURL(objectUrl));
  }

  @override
  Future<void> dispose() async {
    _bytes = null;
  }
}
