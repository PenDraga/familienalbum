/// Export-ZIP: auf dem Handy in der App herunterladen und über das Teilen-Blatt sichern
/// (Safari auf iOS bricht grosse Streams ohne Längenangabe ab), sonst im Browser öffnen.
library;

export 'export_download_io.dart' if (dart.library.js_interop) 'export_download_web.dart';
