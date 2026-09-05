import '../../core/api_client.dart';
import 'media_model.dart';

class TimelineRepository {
  TimelineRepository(this._api);
  final ApiClient _api;

  Future<TimelinePage> fetch(String familyId, {String? cursor, int limit = 60}) async {
    final data = await _api.dio
        .get<Map<String, dynamic>>(
          '/families/$familyId/timeline',
          queryParameters: {'limit': limit, 'cursor': ?cursor},
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

  Future<MediaItem> updateCaption(String mediaId, String? caption) async => MediaItem.fromJson(
    await _api.dio.patch<Map<String, dynamic>>('/media/$mediaId', data: {'caption': caption}).unwrap(),
    _api.absolute,
  );

  Future<void> delete(String mediaId) => _api.dio.delete<void>('/media/$mediaId').unwrap();

  Future<Map<String, dynamic>> createInvite(String familyId, {bool canUpload = false, bool canDownload = false}) =>
      _api.dio
          .post<Map<String, dynamic>>(
            '/families/$familyId/invites',
            data: {'canUpload': canUpload, 'canDownload': canDownload, 'canComment': true},
          )
          .unwrap();
}
