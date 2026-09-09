import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/providers.dart';
import 'admin_models.dart';

class AdminRepository {
  AdminRepository(this._api);
  final ApiClient _api;

  // ---------- Mitglieder (Familien-Admin) ----------

  Future<List<MemberItem>> members(String familyId) async {
    final data = await _api.dio.get<List<dynamic>>('/families/$familyId/members').unwrap();
    return data.map((e) => MemberItem.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<MemberItem> updateMember(String familyId, String userId, Map<String, dynamic> flags) async =>
      MemberItem.fromJson(await _api.dio.patch<Map<String, dynamic>>('/families/$familyId/members/$userId', data: flags).unwrap());

  Future<void> removeMember(String familyId, String userId) => _api.dio.delete<void>('/families/$familyId/members/$userId').unwrap();

  Future<MemberItem> createMemberAccount(
    String familyId, {
    required String email,
    required String password,
    required String displayName,
    required Map<String, dynamic> flags,
  }) async => MemberItem.fromJson(
    await _api.dio
        .post<Map<String, dynamic>>('/families/$familyId/members', data: {'email': email, 'password': password, 'displayName': displayName, ...flags})
        .unwrap(),
  );

  /// Album umbenennen (Album-Admin).
  Future<void> renameFamily(String familyId, String name) => _api.dio.patch<void>('/families/$familyId', data: {'name': name}).unwrap();

  Future<String> createInviteCode(String familyId, Map<String, dynamic> flags) async {
    final data = await _api.dio.post<Map<String, dynamic>>('/families/$familyId/invites', data: flags).unwrap();
    return data['code'] as String;
  }

  // ---------- Eigenes Profil ----------

  Future<void> updateMe({String? displayName, String? currentPassword, String? newPassword}) => _api.dio
      .patch<void>('/me', data: {
        'displayName': ?displayName,
        'currentPassword': ?currentPassword,
        'newPassword': ?newPassword,
      })
      .unwrap();

  // ---------- Globaler Admin ----------

  Future<List<AdminUser>> users({String? q}) async {
    final data = await _api.dio.get<Map<String, dynamic>>('/admin/users', queryParameters: {'limit': 200, 'q': ?q}).unwrap();
    return (data['items'] as List<dynamic>).map((e) => AdminUser.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<AdminUserDetail> user(String id) async => AdminUserDetail.fromJson(await _api.dio.get<Map<String, dynamic>>('/admin/users/$id').unwrap());

  Future<AdminUser> createUser({required String email, required String password, required String displayName, bool isAdmin = false}) async =>
      AdminUser.fromJson(
        await _api.dio
            .post<Map<String, dynamic>>('/admin/users', data: {'email': email, 'password': password, 'displayName': displayName, 'isAdmin': isAdmin})
            .unwrap(),
      );

  /// Konto löschen (globaler Admin): anonymisiert, Fotos und Kommentare bleiben.
  Future<void> deleteUser(String id) => _api.dio.delete<void>('/admin/users/$id').unwrap();

  Future<AdminUser> updateUser(String id, {String? displayName, bool? isAdmin, bool? isDisabled, String? password}) async => AdminUser.fromJson(
    await _api.dio
        .patch<Map<String, dynamic>>('/admin/users/$id', data: {
          'displayName': ?displayName,
          'isAdmin': ?isAdmin,
          'isDisabled': ?isDisabled,
          'password': ?password,
        })
        .unwrap(),
  );

  Future<List<AdminFamily>> families() async {
    final data = await _api.dio.get<List<dynamic>>('/admin/families').unwrap();
    return data.map((e) => AdminFamily.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> createFamily(String name, {String? initialAdminUserId}) =>
      _api.dio.post<void>('/families', data: {'name': name, 'initialAdminUserId': ?initialAdminUserId}).unwrap();

  Future<void> deleteFamily(String id) => _api.dio.delete<void>('/families/$id').unwrap();

  Future<void> addUserToFamily(String familyId, String userId, Map<String, dynamic> flags) =>
      _api.dio.post<void>('/admin/families/$familyId/members', data: {'userId': userId, ...flags}).unwrap();
}

final adminRepositoryProvider = Provider<AdminRepository>((ref) => AdminRepository(ref.watch(apiClientProvider)));
