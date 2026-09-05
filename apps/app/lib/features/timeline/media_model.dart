enum MediaType { photo, video }

enum MediaStatus { uploading, processing, ready, failed }

class MediaUrls {
  const MediaUrls({this.thumb400, this.thumb1600, this.preview, this.original});
  final String? thumb400;
  final String? thumb1600;
  final String? preview;
  final String? original;

  factory MediaUrls.fromJson(Map<String, dynamic> j, String Function(String) absolute) {
    String? abs(dynamic v) => v is String ? absolute(v) : null;
    return MediaUrls(
      thumb400: abs(j['thumb400']),
      thumb1600: abs(j['thumb1600']),
      preview: abs(j['preview']),
      original: abs(j['original']),
    );
  }
}

class MediaItem {
  const MediaItem({
    required this.id,
    required this.familyId,
    required this.uploaderId,
    required this.uploaderName,
    required this.type,
    required this.status,
    required this.originalName,
    required this.mimeType,
    required this.sizeBytes,
    required this.takenAt,
    required this.uploadedAt,
    required this.canEdit,
    required this.commentCount,
    required this.urls,
    this.width,
    this.height,
    this.durationSec,
    this.caption,
  });

  final String id;
  final String familyId;
  final String uploaderId;
  final String uploaderName;
  final MediaType type;
  final MediaStatus status;
  final String originalName;
  final String mimeType;
  final int sizeBytes;
  final int? width;
  final int? height;
  final double? durationSec;
  final DateTime takenAt;
  final DateTime uploadedAt;
  final String? caption;
  final bool canEdit;
  final int commentCount;
  final MediaUrls urls;

  bool get isVideo => type == MediaType.video;
  bool get isReady => status == MediaStatus.ready;

  /// Schlüssel für die Monatsgruppierung (UTC wie der Server).
  String get monthKey => '${takenAt.toUtc().year}-${takenAt.toUtc().month.toString().padLeft(2, '0')}';

  double get aspectRatio => (width != null && height != null && height! > 0) ? width! / height! : 1;

  factory MediaItem.fromJson(Map<String, dynamic> j, String Function(String) absolute) => MediaItem(
    id: j['id'] as String,
    familyId: j['familyId'] as String,
    uploaderId: (j['uploader'] as Map<String, dynamic>)['id'] as String,
    uploaderName: (j['uploader'] as Map<String, dynamic>)['displayName'] as String,
    type: j['type'] == 'VIDEO' ? MediaType.video : MediaType.photo,
    status: switch (j['status'] as String) {
      'READY' => MediaStatus.ready,
      'PROCESSING' => MediaStatus.processing,
      'FAILED' => MediaStatus.failed,
      _ => MediaStatus.uploading,
    },
    originalName: j['originalName'] as String,
    mimeType: j['mimeType'] as String,
    sizeBytes: j['sizeBytes'] as int,
    width: j['width'] as int?,
    height: j['height'] as int?,
    durationSec: (j['durationSec'] as num?)?.toDouble(),
    takenAt: DateTime.parse(j['takenAt'] as String),
    uploadedAt: DateTime.parse(j['uploadedAt'] as String),
    caption: j['caption'] as String?,
    canEdit: j['canEdit'] as bool,
    commentCount: j['commentCount'] as int,
    urls: MediaUrls.fromJson(j['urls'] as Map<String, dynamic>, absolute),
  );
}

class TimelinePage {
  const TimelinePage({required this.items, required this.nextCursor});
  final List<MediaItem> items;
  final String? nextCursor;
}
