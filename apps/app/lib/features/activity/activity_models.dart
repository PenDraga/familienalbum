import '../../l10n/l10n.dart';
import '../timeline/media_model.dart';

enum FeedType { upload, comment }

class FeedMediaRef {
  const FeedMediaRef({required this.id, required this.type, required this.thumb400});
  final String id;
  final MediaType type;
  final String thumb400;

  bool get isVideo => type == MediaType.video;

  factory FeedMediaRef.fromJson(Map<String, dynamic> j, String Function(String) absolute) => FeedMediaRef(
    id: j['id'] as String,
    type: j['type'] == 'VIDEO' ? MediaType.video : MediaType.photo,
    thumb400: absolute(j['thumb400'] as String),
  );
}

/// Ein Eintrag im Aktivitäts-Verlauf: Upload-Serie oder Kommentar.
class FeedItem {
  const FeedItem({
    required this.id,
    required this.type,
    required this.at,
    required this.actorId,
    required this.actorName,
    this.actorAvatarUrl,
    required this.mine,
    required this.unread,
    required this.media,
    required this.count,
    required this.photos,
    required this.videos,
    this.commentId,
    this.commentBody,
    this.commentMediaId,
  });

  final String id;
  final FeedType type;
  final DateTime at;
  final String actorId;
  final String actorName;
  final String? actorAvatarUrl;
  final bool mine;
  final bool unread;
  final List<FeedMediaRef> media;
  final int count;
  final int photos;
  final int videos;
  final String? commentId;
  final String? commentBody;
  final String? commentMediaId;

  /// Medium, das beim Antippen geöffnet wird (Kommentar: das kommentierte, Serie: das neueste).
  String? get targetMediaId => commentMediaId ?? media.firstOrNull?.id;

  /// „12 Fotos und 1 Video“
  String mediaLabel(AppLocalizations l10n) {
    final parts = <String>[
      if (photos > 0) l10n.activityPhotos(photos),
      if (videos > 0) l10n.activityVideos(videos),
    ];
    if (parts.isEmpty) return l10n.activityMediaCount(count);
    return parts.length == 1 ? parts.single : l10n.activityAnd(parts[0], parts[1]);
  }

  FeedItem copyWith({bool? unread}) => FeedItem(
    id: id,
    type: type,
    at: at,
    actorId: actorId,
    actorName: actorName,
    actorAvatarUrl: actorAvatarUrl,
    mine: mine,
    unread: unread ?? this.unread,
    media: media,
    count: count,
    photos: photos,
    videos: videos,
    commentId: commentId,
    commentBody: commentBody,
    commentMediaId: commentMediaId,
  );

  factory FeedItem.fromJson(Map<String, dynamic> j, String Function(String) absolute) {
    final actor = j['actor'] as Map<String, dynamic>;
    final comment = j['comment'] as Map<String, dynamic>?;
    return FeedItem(
      id: j['id'] as String,
      type: j['type'] == 'COMMENT' ? FeedType.comment : FeedType.upload,
      at: DateTime.parse(j['at'] as String),
      actorId: actor['id'] as String,
      actorName: actor['displayName'] as String,
      actorAvatarUrl: actor['avatarUrl'] as String?,
      mine: j['mine'] as bool,
      unread: j['unread'] as bool,
      media: (j['media'] as List<dynamic>).map((m) => FeedMediaRef.fromJson(m as Map<String, dynamic>, absolute)).toList(),
      count: j['count'] as int,
      photos: j['photos'] as int,
      videos: j['videos'] as int,
      commentId: comment?['id'] as String?,
      commentBody: comment?['body'] as String?,
      commentMediaId: comment?['mediaId'] as String?,
    );
  }
}

class FeedPage {
  const FeedPage({required this.items, required this.nextCursor, required this.seenAt});
  final List<FeedItem> items;
  final String? nextCursor;
  final DateTime seenAt;
}

class UnreadCounts {
  const UnreadCounts({required this.media, required this.comments});
  static const zero = UnreadCounts(media: 0, comments: 0);
  final int media;
  final int comments;
  int get total => media + comments;
}
