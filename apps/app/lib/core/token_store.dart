import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

class TokenPair {
  const TokenPair({required this.accessToken, required this.refreshToken});
  final String accessToken;
  final String refreshToken;

  factory TokenPair.fromJson(Map<String, dynamic> json) =>
      TokenPair(accessToken: json['accessToken'] as String, refreshToken: json['refreshToken'] as String);
}

/// Access-/Refresh-Token: Keychain/Keystore auf Mobile und Desktop.
///
/// Im Web braucht der Secure Storage WebCrypto, das nur in sicheren Kontexten (HTTPS oder localhost)
/// existiert. Über HTTP im LAN (Test vom Handy) würde er stillschweigend scheitern – dann fallen wir
/// auf localStorage zurück. Im Betrieb hinter Cloudflare (HTTPS) bleibt es beim Secure Storage.
class TokenStore {
  TokenStore([FlutterSecureStorage? storage]) : _secure = storage ?? const FlutterSecureStorage();

  static const _kAccess = 'fa.accessToken';
  static const _kRefresh = 'fa.refreshToken';

  final FlutterSecureStorage _secure;
  bool _useFallback = false;
  String? _access;
  String? _refresh;
  bool _loaded = false;

  Future<String?> _read(String key) async {
    if (!_useFallback) {
      try {
        return await _secure.read(key: key);
      } catch (e) {
        if (!kIsWeb) rethrow;
        debugPrint('Secure Storage nicht verfügbar (unsicherer Kontext?), nutze localStorage: $e');
        _useFallback = true;
      }
    }
    return (await SharedPreferences.getInstance()).getString(key);
  }

  Future<void> _write(String key, String? value) async {
    if (!_useFallback) {
      try {
        if (value == null) {
          await _secure.delete(key: key);
        } else {
          await _secure.write(key: key, value: value);
        }
        return;
      } catch (e) {
        if (!kIsWeb) rethrow;
        _useFallback = true;
      }
    }
    final prefs = await SharedPreferences.getInstance();
    if (value == null) {
      await prefs.remove(key);
    } else {
      await prefs.setString(key, value);
    }
  }

  Future<void> _ensureLoaded() async {
    if (_loaded) return;
    _access = await _read(_kAccess);
    _refresh = await _read(_kRefresh);
    _loaded = true;
  }

  Future<String?> accessToken() async {
    await _ensureLoaded();
    return _access;
  }

  Future<String?> refreshToken() async {
    await _ensureLoaded();
    return _refresh;
  }

  Future<bool> hasSession() async => (await refreshToken()) != null;

  Future<void> save(TokenPair tokens) async {
    _access = tokens.accessToken;
    _refresh = tokens.refreshToken;
    _loaded = true;
    await _write(_kAccess, tokens.accessToken);
    await _write(_kRefresh, tokens.refreshToken);
  }

  Future<void> clear() async {
    _access = null;
    _refresh = null;
    _loaded = true;
    await _write(_kAccess, null);
    await _write(_kRefresh, null);
  }
}
