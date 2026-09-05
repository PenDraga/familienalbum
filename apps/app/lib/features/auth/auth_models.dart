class MembershipFlags {
  const MembershipFlags({
    required this.isFamilyAdmin,
    required this.canUpload,
    required this.canDownload,
    required this.canComment,
  });

  final bool isFamilyAdmin;
  final bool canUpload;
  final bool canDownload;
  final bool canComment;

  factory MembershipFlags.fromJson(Map<String, dynamic> j) => MembershipFlags(
    isFamilyAdmin: j['isFamilyAdmin'] as bool,
    canUpload: j['canUpload'] as bool,
    canDownload: j['canDownload'] as bool,
    canComment: j['canComment'] as bool,
  );
}

class Family {
  const Family({required this.id, required this.name, required this.membership});

  final String id;
  final String name;
  final MembershipFlags membership;

  factory Family.fromJson(Map<String, dynamic> j) => Family(
    id: j['id'] as String,
    name: j['name'] as String,
    membership: MembershipFlags.fromJson(j['membership'] as Map<String, dynamic>),
  );
}

/// Antwort von GET /me
class Me {
  const Me({required this.id, required this.email, required this.displayName, required this.isAdmin, required this.families});

  final String id;
  final String email;
  final String displayName;
  final bool isAdmin;
  final List<Family> families;

  factory Me.fromJson(Map<String, dynamic> j) => Me(
    id: j['id'] as String,
    email: j['email'] as String,
    displayName: j['displayName'] as String,
    isAdmin: j['isAdmin'] as bool,
    families: (j['families'] as List<dynamic>).map((e) => Family.fromJson(e as Map<String, dynamic>)).toList(),
  );
}

class InvitePreview {
  const InvitePreview({required this.familyName, required this.isValid, required this.expiresAt, required this.flags});

  final String familyName;
  final bool isValid;
  final DateTime expiresAt;
  final MembershipFlags flags;

  factory InvitePreview.fromJson(Map<String, dynamic> j) => InvitePreview(
    familyName: j['familyName'] as String,
    isValid: j['isValid'] as bool,
    expiresAt: DateTime.parse(j['expiresAt'] as String),
    flags: MembershipFlags(
      isFamilyAdmin: false,
      canUpload: j['canUpload'] as bool,
      canDownload: j['canDownload'] as bool,
      canComment: j['canComment'] as bool,
    ),
  );
}
