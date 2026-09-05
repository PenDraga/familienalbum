import 'dart:async';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';

import '../../core/api_client.dart';
import '../../core/api_exception.dart';
import 'chunk_source.dart';

class UploadSession {
  UploadSession.fromJson(Map<String, dynamic> j)
      : id = j['id'] as String,
        chunkSize = j['chunkSize'] as int,
        totalChunks = j['totalChunks'] as int,
        receivedChunks = (j['receivedChunks'] as List<dynamic>).cast<int>().toSet();

  final String id;
  final int chunkSize;
  final int totalChunks;
  final Set<int> receivedChunks;
}

class UploadResult {
  const UploadResult({required this.mediaId, required this.duplicate});
  final String mediaId;
  final bool duplicate;
}

/// Chunk-Upload gemäss docs/api.md: SHA-256 → Session → Chunks → complete.
class UploadService {
  UploadService(this._api);
  final ApiClient _api;

  Future<String> sha256Hex(ChunkSource source, {void Function(double)? onProgress}) async {
    final sink = _DigestSink();
    final input = sha256.startChunkedConversion(sink);
    var done = 0;
    await for (final chunk in source.openRead()) {
      input.add(chunk);
      done += chunk.length;
      onProgress?.call(source.length == 0 ? 1 : done / source.length);
    }
    input.close();
    return sink.digest.toString();
  }

  Future<UploadResult> upload({
    required String familyId,
    required ChunkSource source,
    required String fileName,
    required String mimeType,
    DateTime? takenAt,
    required void Function(double progress, String phase) onProgress,
    CancelToken? cancel,
  }) async {
    onProgress(0, 'Prüfsumme');
    final hash = await sha256Hex(source, onProgress: (p) => onProgress(p * 0.1, 'Prüfsumme'));

    final UploadSession session;
    try {
      session = UploadSession.fromJson(
        await _api.dio
            .post<Map<String, dynamic>>(
              '/families/$familyId/uploads',
              data: {
                'sha256': hash,
                'sizeBytes': source.length,
                'originalName': fileName,
                'mimeType': mimeType,
                if (takenAt != null) 'takenAt': takenAt.toUtc().toIso8601String(),
              },
              cancelToken: cancel,
            )
            .unwrap(),
      );
    } on ApiException catch (e) {
      if (e.code == 'DUPLICATE_MEDIA' && e.extra['mediaId'] is String) {
        return UploadResult(mediaId: e.extra['mediaId'] as String, duplicate: true);
      }
      rethrow;
    }

    onProgress(0.1, 'Hochladen');
    final pending = [for (var i = 0; i < session.totalChunks; i++) if (!session.receivedChunks.contains(i)) i];
    var uploadedBytes = session.receivedChunks.length * session.chunkSize;
    for (final index in pending) {
      final start = index * session.chunkSize;
      final bytes = await source.read(start, session.chunkSize);
      await _api.dio
          .put<void>(
            '/uploads/${session.id}/chunks/$index',
            // Bytes statt Stream: Dio kann die Anfrage so nach einem Token-Refresh unverändert wiederholen
            data: bytes,
            options: Options(
              headers: {Headers.contentTypeHeader: 'application/octet-stream'},
              sendTimeout: const Duration(minutes: 10),
            ),
            cancelToken: cancel,
            onSendProgress: (sent, _) {
              final total = source.length == 0 ? 1 : source.length;
              onProgress(0.1 + 0.85 * ((uploadedBytes + sent) / total).clamp(0, 1), 'Hochladen');
            },
          )
          .unwrap();
      uploadedBytes += bytes.length;
    }

    onProgress(0.95, 'Abschliessen');
    final media = await _api.dio.post<Map<String, dynamic>>('/uploads/${session.id}/complete', cancelToken: cancel).unwrap();
    onProgress(1, 'Fertig');
    return UploadResult(mediaId: media['id'] as String, duplicate: false);
  }
}

class _DigestSink implements Sink<Digest> {
  late Digest digest;

  @override
  void add(Digest data) => digest = data;

  @override
  void close() {}
}

/// Für Debug-Ausgaben.
String prettyBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
  if (bytes < 1024 * 1024 * 1024) return '${(bytes / 1024 / 1024).toStringAsFixed(1)} MB';
  return '${(bytes / 1024 / 1024 / 1024).toStringAsFixed(2)} GB';
}
