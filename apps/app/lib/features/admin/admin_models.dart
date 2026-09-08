import '../auth/auth_models.dart';

class MemberItem {
  const MemberItem({
    required this.userId,
    required this.familyId,
    required this.displayName,
    this.avatarUrl,
    required this.flags,
    required this.joinedAt,
    this.lastSeenAt,
  });

  final String userId;
  final String familyId;
  final String displayName;
  final String? avatarUrl;
  final MembershipFlags flags;
  final DateTime joinedAt;
  final DateTime? lastSeenAt;

  factory MemberItem.fromJson(Map<String, dynamic> j) => MemberItem(
    userId: j['userId'] as String,
    familyId: j['familyId'] as String,
    displayName: (j['user'] as Map<String, dynamic>)['displayName'] as String,
    avatarUrl: (j['user'] as Map<String, dynamic>)['avatarUrl'] as String?,
    flags: MembershipFlags.fromJson(j),
    joinedAt: DateTime.parse(j['joinedAt'] as String),
    lastSeenAt: j['lastSeenAt'] == null ? null : DateTime.parse(j['lastSeenAt'] as String),
  );
}

class AdminUser {
  const AdminUser({
    required this.id,
    required this.email,
    required this.displayName,
    required this.isAdmin,
    required this.isDisabled,
    required this.createdAt,
  });

  final String id;
  final String email;
  final String displayName;
  final bool isAdmin;
  final bool isDisabled;
  final DateTime createdAt;

  factory AdminUser.fromJson(Map<String, dynamic> j) => AdminUser(
    id: j['id'] as String,
    email: j['email'] as String,
    displayName: j['displayName'] as String,
    isAdmin: j['isAdmin'] as bool,
    isDisabled: j['isDisabled'] as bool,
    createdAt: DateTime.parse(j['createdAt'] as String),
  );
}

class AdminUserDetail extends AdminUser {
  const AdminUserDetail({
    required super.id,
    required super.email,
    required super.displayName,
    required super.isAdmin,
    required super.isDisabled,
    required super.createdAt,
    required this.deviceCount,
    required this.families,
  });

  final int deviceCount;
  final List<Family> families;

  factory AdminUserDetail.fromJson(Map<String, dynamic> j) {
    final u = AdminUser.fromJson(j);
    return AdminUserDetail(
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      isAdmin: u.isAdmin,
      isDisabled: u.isDisabled,
      createdAt: u.createdAt,
      deviceCount: j['deviceCount'] as int,
      families: (j['families'] as List<dynamic>).map((e) => Family.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }
}

class AdminFamily {
  const AdminFamily({required this.id, required this.name, required this.createdAt, required this.memberCount, required this.mediaCount, required this.photoCount, required this.videoCount, required this.totalBytes});

  final String id;
  final String name;
  final DateTime createdAt;
  final int memberCount;
  final int mediaCount;
  final int photoCount;
  final int videoCount;
  final int totalBytes;

  factory AdminFamily.fromJson(Map<String, dynamic> j) => AdminFamily(
    id: j['id'] as String,
    name: j['name'] as String,
    createdAt: DateTime.parse(j['createdAt'] as String),
    memberCount: j['memberCount'] as int,
    mediaCount: j['mediaCount'] as int,
    photoCount: (j['photoCount'] as int?) ?? 0,
    videoCount: (j['videoCount'] as int?) ?? 0,
    totalBytes: ((j['totalBytes'] as num?) ?? 0).toInt(),
  );
}

/// Rechte als Map für PATCH-Bodies.
Map<String, dynamic> flagsJson({bool? isFamilyAdmin, bool? canUpload, bool? canDownload, bool? canComment}) => {
  'isFamilyAdmin': ?isFamilyAdmin,
  'canUpload': ?canUpload,
  'canDownload': ?canDownload,
  'canComment': ?canComment,
};
