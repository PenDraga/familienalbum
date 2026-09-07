import '../../core/api_client.dart';
import '../media/media_info.dart';
import 'media_model.dart';

class TimelineRepository {
  TimelineRepository(this._api);
  final ApiClient _api;

  Future<TimelinePage> fetch(String familyId, {String? cursor, int limit = 60, String? type, bool commented = false}) async {
    final data = await _api.dio
        .get<Map<String, dynamic>>(
          '/families/$familyId/timeline',
          queryParameters: {'limit': limit, 'cursor': ?cursor, 'type': ?type, if (commented) 'commented': 'true'},
        )
        .unwrap();
    final items = <MediaItem>[];
    for (final g in data['groups'] as List<dynamic>) {
      for (final m in (g as Map<String, dynamic>)['items'] as List<dynamic>) {
        items.add(MediaItem.fromJson(m as Map<String, dynamic>, _api.absolute));
      }
    }
    return TimelinePage(items: items, nextCursor: data['nextCursor'] as String?);
  }

  Future<MediaItem> get(String mediaId) async =>
      MediaItem.fromJson(await _api.dio.get<Map<String, dynamic>>('/media/$mediaId').unwrap(), _api.absolute);

  Future<MediaItem> updateCaption(String mediaId, String? caption) => _patch(mediaId, {'caption': caption});

  Future<MediaItem> updateTakenAt(String mediaId, DateTime takenAt) => _patch(mediaId, {'takenAt': takenAt.toUtc().toIso8601String()});

  Future<MediaItem> _patch(String mediaId, Map<String, dynamic> body) async =>
      MediaItem.fromJson(await _api.dio.patch<Map<String, dynamic>>('/media/$mediaId', data: body).unwrap(), _api.absolute);

  Future<MediaInfo> info(String mediaId) async => MediaInfo.fromJson(await _api.dio.get<Map<String, dynamic>>('/media/$mediaId/info').unwrap());

  /// Aufnahmedatum mehrerer Medien setzen oder verschieben; fremde Medien meldet der Server in `skipped`.
  Future<BatchTakenAtResult> batchTakenAt(String familyId, List<String> ids, TakenAtChange change) async => BatchTakenAtResult.fromJson(
    await _api.dio.post<Map<String, dynamic>>('/families/$familyId/media/taken-at', data: {'ids': ids, ...change.toJson()}).unwrap(),
  );

  Future<void> delete(String mediaId) => _api.dio.delete<void>('/media/$mediaId').unwrap();

  /// Signierter Download-Link für den Export (ZIP mit Originalen und Kommentaren); [scope] = 'alle' oder 'JJJJ-MM'.
  /// Liefert die absolute URL, die der Browser ohne Token öffnen kann.
  Future<String> exportLink(String familyId, String scope) async {
    final data = await _api.dio.get<Map<String, dynamic>>('/families/$familyId/export-link/$scope').unwrap();
    return _api.absolute(data['url'] as String);
  }

  Future<Map<String, dynamic>> createInvite(String familyId, {bool canUpload = false, bool canDownload = false}) =>
      _api.dio
          .post<Map<String, dynamic>>(
            '/families/$familyId/invites',
            data: {'canUpload': canUpload, 'canDownload': canDownload, 'canComment': true},
          )
          .unwrap();
}
