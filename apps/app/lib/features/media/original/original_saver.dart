/// Original herunterladen und sichern/teilen – Plattform-Weiche.
///
/// ```dart
/// final prepared = await prepareOriginal(dio, url: ..., fileName: ..., mimeType: ..., isVideo: ..., onProgress: ...);
/// if (prepared.canSaveToPhotos) await prepared.saveToPhotos();
/// await prepared.dispose();
/// ```
library;

export 'prepared_original.dart';
export 'original_saver_io.dart' if (dart.library.js_interop) 'original_saver_web.dart';
