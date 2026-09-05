import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/providers.dart';
import 'activity_models.dart';

class ActivityRepository {
  ActivityRepository(this._api);
  final ApiClient _api;

  Future<FeedPage> feed(String familyId, {String? cursor, int limit = 30}) async {
    final data = await _api.dio
        .get<Map<String, dynamic>>('/families/$familyId/activity/feed', queryParameters: {'limit': limit, 'cursor': ?cursor})
        .unwrap();
    return FeedPage(
      items: (data['items'] as List<dynamic>).map((e) => FeedItem.fromJson(e as Map<String, dynamic>, _api.absolute)).toList(),
      nextCursor: data['nextCursor'] as String?,
      seenAt: DateTime.parse(data['seenAt'] as String),
    );
  }

  /// Ungelesenes seit dem zuletzt gesehenen Zeitpunkt (Server merkt sich den Stand).
  Future<UnreadCounts> unread(String familyId) async {
    final data = await _api.dio.get<Map<String, dynamic>>('/families/$familyId/activity').unwrap();
    return UnreadCounts(media: data['newMedia'] as int, comments: data['newComments'] as int);
  }

  Future<DateTime> markSeen(String familyId) async {
    final data = await _api.dio.post<Map<String, dynamic>>('/families/$familyId/activity/seen').unwrap();
    return DateTime.parse(data['seenAt'] as String);
  }
}

final activityRepositoryProvider = Provider<ActivityRepository>((ref) => ActivityRepository(ref.watch(apiClientProvider)));
