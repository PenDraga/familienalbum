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

  Future<void> logout() async {
    await ref.read(pushServiceProvider).onLogout();
    final tokens = ref.read(tokenStoreProvider);
    final refresh = await tokens.refreshToken();
    if (refresh != null) {
      try {
        await _repo.logout(refresh);
      } catch (_) {
        // Server nicht erreichbar – lokal trotzdem abmelden
      }
    }
    await tokens.clear();
    state = const AsyncData(Unauthenticated());
  }

  /// Vom ApiClient aufgerufen, wenn der Refresh scheitert.
  void sessionExpired() {
    if (state.whenOrNull(data: (s) => s) is Authenticated) {
      state = const AsyncData(Unauthenticated());
    }
  }
}

final authControllerProvider = AsyncNotifierProvider<AuthController, AuthState>(AuthController.new);

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
