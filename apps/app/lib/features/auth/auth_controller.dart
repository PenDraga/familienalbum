import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../../core/token_store.dart';
import 'auth_models.dart';
import 'auth_repository.dart';
import '../push/push_service.dart';

sealed class AuthState {
  const AuthState();
}

class Unauthenticated extends AuthState {
  const Unauthenticated();
}

class Authenticated extends AuthState {
  const Authenticated(this.me);
  final Me me;
}

class AuthController extends AsyncNotifier<AuthState> {
  AuthRepository get _repo => AuthRepository(ref.read(apiClientProvider));

  @override
  Future<AuthState> build() async {
    // Erststart ohne Server-Adresse: direkt zum Login, dort wird sie abgefragt
    final baseUrl = ref.watch(settingsProvider.select((s) => s.baseUrl));
    if (baseUrl.isEmpty) return const Unauthenticated();
    // Bei geänderter Server-URL neu prüfen
    ref.watch(apiClientProvider);
    final tokens = ref.read(tokenStoreProvider);
    if (!await tokens.hasSession()) return const Unauthenticated();
    try {
      return Authenticated(await _repo.me());
    } on ApiException catch (e) {
      if (e.status == 401 || e.status == 403) {
        await tokens.clear();
        return const Unauthenticated();
      }
      rethrow;
    }
  }

  /// Wirft ApiException bei falschen Zugangsdaten.
  Future<void> login(String email, String password) async {
    final tokens = await _repo.login(email, password);
    await ref.read(tokenStoreProvider).save(tokens);
    state = AsyncData(Authenticated(await _repo.me()));
  }

  /// Nach Einladung mit Registrierung: Tokens übernehmen.
  Future<void> adoptTokens(TokenPair tokens) async {
    await ref.read(tokenStoreProvider).save(tokens);
    state = AsyncData(Authenticated(await _repo.me()));
  }

  Future<void> refreshMe() async {
    final me = await _repo.me();
    state = AsyncData(Authenticated(me));
  }

  /// Netzwerkaufrufe beim Abmelden dürfen das lokale Abmelden nicht blockieren.
  static const _logoutNetworkTimeout = Duration(seconds: 5);

  Future<void> logout() async {
    try {
      await ref.read(pushServiceProvider).onLogout().timeout(_logoutNetworkTimeout);
    } catch (_) {
      // Push-Token bleibt serverseitig, wird beim nächsten Login umgehängt
    }
    final tokens = ref.read(tokenStoreProvider);
    final refresh = await tokens.refreshToken();
    if (refresh != null) {
      try {
        await _repo.logout(refresh).timeout(_logoutNetworkTimeout);
      } catch (_) {
        // Server nicht erreichbar – lokal trotzdem abmelden
      }
    }
    await tokens.clear();
    state = const AsyncData(Unauthenticated());
  }

  /// Startprüfung abbrechen (Server antwortet nicht): Session verwerfen, Login-Screen zeigen.
  Future<void> abortStartup() async {
    await ref.read(tokenStoreProvider).clear();
    state = const AsyncData(Unauthenticated());
  }

  /// Zu einem anderen Server wechseln: lokale Session verwerfen, URL speichern, Login-Screen zeigen.
  /// Die alten Tokens gelten auf dem neuen Server nicht, ein Logout-Aufruf lohnt sich nicht.
  Future<void> switchServer(String baseUrl) async {
    await ref.read(tokenStoreProvider).clear();
    state = const AsyncData(Unauthenticated());
    await ref.read(settingsProvider.notifier).setBaseUrl(baseUrl);
  }

  /// Vom ApiClient aufgerufen, wenn der Refresh scheitert.
  void sessionExpired() {
    if (state.whenOrNull(data: (s) => s) is Authenticated) {
      state = const AsyncData(Unauthenticated());
    }
  }
}

/// Kein automatisches Riverpod-Retry: Bei unerreichbarem Server würde build() sonst endlos
/// neu starten (Timeout, Neustart, Timeout …) und die App bliebe auf dem Splash hängen.
/// Der Fehler landet stattdessen als AsyncError im Router (→ Login-Screen mit Hinweis).
final authControllerProvider = AsyncNotifierProvider<AuthController, AuthState>(
  AuthController.new,
  retry: (_, _) => null,
);

/// Bequemer Zugriff auf den angemeldeten Benutzer (null wenn nicht angemeldet).
final meProvider = Provider<Me?>((ref) {
  final s = ref.watch(authControllerProvider).whenOrNull(data: (s) => s);
  return s is Authenticated ? s.me : null;
});

/// Aktuell gewählte Familie (Fallback: erste Familie des Benutzers).
final selectedFamilyProvider = Provider<Family?>((ref) {
  final me = ref.watch(meProvider);
  if (me == null || me.families.isEmpty) return null;
  final wanted = ref.watch(settingsProvider.select((s) => s.selectedFamilyId));
  return me.families.where((f) => f.id == wanted).firstOrNull ?? me.families.first;
});
