import 'dart:typed_data';

import 'chunk_source_stub.dart' if (dart.library.io) 'chunk_source_io.dart' as impl;

/// Quelle für Datei-Bytes, plattformneutral (Web: Speicher, sonst Datei).
abstract class ChunkSource {
  int get length;

  /// Sequenzielles Lesen (für den SHA-256).
  Stream<List<int>> openRead();

  /// Wahlfreier Zugriff für einzelne Chunks (auch zum Wiederaufnehmen).
  Future<Uint8List> read(int start, int length);

  Future<void> close() async {}

  static ChunkSource fromBytes(Uint8List bytes) => _BytesSource(bytes);

  /// null, wenn die Plattform keinen Dateizugriff hat (Web).
  static ChunkSource? fromPath(String path, int length) => impl.fromPath(path, length);
}

class _BytesSource extends ChunkSource {
  _BytesSource(this._bytes);
  final Uint8List _bytes;

  @override
  int get length => _bytes.length;

  @override
  Stream<List<int>> openRead() async* {
    const step = 1 << 20;
    for (var i = 0; i < _bytes.length; i += step) {
      yield _bytes.sublist(i, (i + step).clamp(0, _bytes.length));
    }
  }

  @override
  Future<Uint8List> read(int start, int length) async => _bytes.sublist(start, (start + length).clamp(0, _bytes.length));
}
