import 'dart:io';
import 'dart:typed_data';

import 'chunk_source.dart';

ChunkSource? fromPath(String path, int length) => _FileSource(File(path), length);

class _FileSource extends ChunkSource {
  _FileSource(this._file, this.length);
  final File _file;
  RandomAccessFile? _raf;

  @override
  final int length;

  @override
  Stream<List<int>> openRead() => _file.openRead();

  @override
  Future<Uint8List> read(int start, int length) async {
    final raf = _raf ??= await _file.open();
    await raf.setPosition(start);
    return raf.read(length);
  }

  @override
  Future<void> close() async {
    await _raf?.close();
    _raf = null;
  }
}
