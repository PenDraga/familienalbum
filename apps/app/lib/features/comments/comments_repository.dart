import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/providers.dart';

class CommentItem {
  const CommentItem({
    required this.id,
    required this.mediaId,
    required this.authorId,
    required this.authorName,
    required this.body,
    required this.createdAt,
    required this.canDelete,
    this.canEdit = false,
    this.editedAt,
  });

  final String id;
  final String mediaId;
  final String authorId;
  final String authorName;
  final String body;
  final DateTime createdAt;
  final bool canDelete;
  final bool canEdit;
  final DateTime? editedAt;

  factory CommentItem.fromJson(Map<String, dynamic> j) => CommentItem(
    id: j['id'] as String,
    mediaId: j['mediaId'] as String,
    authorId: (j['author'] as Map<String, dynamic>)['id'] as String,
    authorName: (j['author'] as Map<String, dynamic>)['displayName'] as String,
    body: j['body'] as String,
    createdAt: DateTime.parse(j['createdAt'] as String),
    canDelete: j['canDelete'] as bool,
    canEdit: (j['canEdit'] as bool?) ?? false,
    editedAt: j['editedAt'] == null ? null : DateTime.parse(j['editedAt'] as String),
  );
}

class Activity {
  const Activity({required this.newMedia, required this.newComments, required this.serverTime});
  final int newMedia;
  final int newComments;
  final DateTime serverTime;

  bool get hasNews => newMedia > 0 || newComments > 0;

  factory Activity.fromJson(Map<String, dynamic> j) => Activity(
    newMedia: j['newMedia'] as int,
    newComments: j['newComments'] as int,
    serverTime: DateTime.parse(j['serverTime'] as String),
  );
}

class CommentsRepository {
  CommentsRepository(this._api);
  final ApiClient _api;

  Future<List<CommentItem>> list(String mediaId) async {
    final data = await _api.dio.get<List<dynamic>>('/media/$mediaId/comments').unwrap();
    return data.map((e) => CommentItem.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<CommentItem> create(String mediaId, String body) async =>
      CommentItem.fromJson(await _api.dio.post<Map<String, dynamic>>('/media/$mediaId/comments', data: {'body': body}).unwrap());

  Future<CommentItem> update(String commentId, String body) async =>
      CommentItem.fromJson(await _api.dio.patch<Map<String, dynamic>>('/comments/$commentId', data: {'body': body}).unwrap());

  Future<void> delete(String commentId) => _api.dio.delete<void>('/comments/$commentId').unwrap();

  Future<Activity> activity(String familyId, DateTime since) async => Activity.fromJson(
    await _api.dio
        .get<Map<String, dynamic>>('/families/$familyId/activity', queryParameters: {'since': since.toUtc().toIso8601String()})
        .unwrap(),
  );

  Future<void> registerDevice(String fcmToken, String platform) =>
      _api.dio.post<void>('/devices', data: {'fcmToken': fcmToken, 'platform': platform}).unwrap();

  Future<void> unregisterDevice(String fcmToken) => _api.dio.delete<void>('/devices', data: {'fcmToken': fcmToken}).unwrap();
}

final commentsRepositoryProvider = Provider<CommentsRepository>((ref) => CommentsRepository(ref.watch(apiClientProvider)));
