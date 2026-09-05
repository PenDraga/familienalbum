/// Ein heruntergeladenes Original, das noch gesichert, geteilt oder als Datei abgelegt werden kann.
///
/// Plattform-Implementierungen: `original_saver_io.dart` (Datei im Temp-Ordner) und
/// `original_saver_web.dart` (Bytes im Speicher). Nach der Aktion [dispose] aufrufen.
abstract class PreparedOriginal {
  String get fileName;

  /// In die Fotos-Mediathek (iOS/Android).
  bool get canSaveToPhotos;

  /// System-Teilen-Blatt (nativ immer; im Web nur mobile Browser mit Web-Share).
  bool get canShare;

  /// Als Datei ablegen (Web: Download-Ordner bzw. „Dateien“).
  bool get canDownload;

  Future<void> saveToPhotos();

  Future<void> share();

  Future<void> download();

  Future<void> dispose();
}

/// Fortschritt in 0..1, null solange die Gesamtgrösse unbekannt ist.
typedef DownloadProgress = void Function(double? fraction);

class OriginalSaveException implements Exception {
  const OriginalSaveException(this.message);
  final String message;

  @override
  String toString() => message;
}
