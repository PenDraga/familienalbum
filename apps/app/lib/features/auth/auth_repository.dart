import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../core/api_client.dart';
import '../../core/token_store.dart';
import 'auth_models.dart';

class LoginResult {
  const LoginResult({required this.tokens});
  final TokenPair tokens;
}

class AuthRepository {
  AuthRepository(this._api);
  final ApiClient _api;

  Future<TokenPair> login(String email, String password) async {
    final data = await _api.dio
        .post<Map<String, dynamic>>('/auth/login', data: {'email': email, 'password': password})
        .unwrap();
    return TokenPair.fromJson(data['tokens'] as Map<String, dynamic>);
  }

  Future<Me> me() async => Me.fromJson(await _api.dio.get<Map<String, dynamic>>('/me').unwrap());

  /// Profilbild hochladen (JPEG/PNG/WebP als Rohdaten); der Server schneidet zu und verkleinert.
  Future<String?> uploadAvatar(Uint8List bytes, {String contentType = 'image/jpeg'}) async {
    final data = await _api.dio
        .put<Map<String, dynamic>>('/me/avatar', data: Stream.fromIterable([bytes]), options: Options(headers: {'content-type': contentType, 'content-length': bytes.length}))
        .unwrap();
    return data['avatarUrl'] as String?;
  }

  Future<void> deleteAvatar() => _api.dio.delete<void>('/me/avatar').unwrap();

  /// Passwort vergessen: Server schickt einen Link per Mail (antwortet immer 204; 503 wenn kein Mail-Versand eingerichtet).
  Future<void> requestPasswordReset(String email) => _api.dio.post<void>('/auth/password-reset', data: {'email': email}).unwrap();

  /// Neues Passwort mit dem Token aus dem Mail-Link setzen.
  Future<void> confirmPasswordReset(String token, String password) =>
      _api.dio.post<void>('/auth/password-reset/confirm', data: {'token': token, 'password': password}).unwrap();

  Future<void> logout(String refreshToken) async {
    await _api.dio.post<void>('/auth/logout', data: {'refreshToken': refreshToken}).unwrap();
  }

  Future<InvitePreview> previewInvite(String code) async =>
      InvitePreview.fromJson(await _api.dio.get<Map<String, dynamic>>('/invites/${code.trim().toUpperCase()}').unwrap());

  /// Angemeldet: leerer Body. Neu: Registrierungsdaten → Tokens in der Antwort.
  Future<TokenPair?> acceptInvite(String code, {String? email, String? password, String? displayName}) async {
    final body = email == null ? null : {'email': email, 'password': password, 'displayName': displayName};
    final data = await _api.dio
        .post<Map<String, dynamic>>('/invites/${code.trim().toUpperCase()}/accept', data: body)
        .unwrap();
    final tokens = data['tokens'];
    return tokens is Map<String, dynamic> ? TokenPair.fromJson(tokens) : null;
  }
}
