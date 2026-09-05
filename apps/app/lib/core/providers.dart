import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' show ThemeMode;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../features/auth/auth_controller.dart';
import 'api_client.dart';
import 'token_store.dart';

/// Wird in main.dart überschrieben.
final sharedPreferencesProvider = Provider<SharedPreferences>((ref) => throw UnimplementedError());

/// Server-URL: --dart-define=API_BASE_URL=… > gespeicherter Wert > Web-Origin > leer (Login-Screen fragt).
String defaultBaseUrl() {
  const fromDefine = String.fromEnvironment('API_BASE_URL');
  if (fromDefine.isNotEmpty) return fromDefine;
  if (kIsWeb) return Uri.base.origin;
  return '';
}

class Settings {
  const Settings({required this.baseUrl, this.selectedFamilyId, this.themeMode = ThemeMode.system});
  final String baseUrl;
  final String? selectedFamilyId;
  final ThemeMode themeMode;

  Settings copyWith({String? baseUrl, String? selectedFamilyId, bool clearFamily = false, ThemeMode? themeMode}) => Settings(
    baseUrl: baseUrl ?? this.baseUrl,
    selectedFamilyId: clearFamily ? null : (selectedFamilyId ?? this.selectedFamilyId),
    themeMode: themeMode ?? this.themeMode,
  );
}

class SettingsController extends Notifier<Settings> {
  static const _kBaseUrl = 'fa.baseUrl';
  static const _kFamily = 'fa.familyId';
  static const _kTheme = 'fa.themeMode';

  @override
  Settings build() {
    final prefs = ref.watch(sharedPreferencesProvider);
    final stored = prefs.getString(_kBaseUrl);
    return Settings(
      baseUrl: (stored != null && stored.isNotEmpty) ? stored : defaultBaseUrl(),
      selectedFamilyId: prefs.getString(_kFamily),
      themeMode: ThemeMode.values.firstWhere((m) => m.name == prefs.getString(_kTheme), orElse: () => ThemeMode.system),
    );
  }

  Future<void> setBaseUrl(String url) async {
    final normalized = url.trim().replaceAll(RegExp(r'/+$'), '');
    await ref.read(sharedPreferencesProvider).setString(_kBaseUrl, normalized);
    state = state.copyWith(baseUrl: normalized);
  }

  Future<void> selectFamily(String? familyId) async {
    final prefs = ref.read(sharedPreferencesProvider);
    if (familyId == null) {
      await prefs.remove(_kFamily);
      state = state.copyWith(clearFamily: true);
    } else {
      await prefs.setString(_kFamily, familyId);
      state = state.copyWith(selectedFamilyId: familyId);
    }
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    await ref.read(sharedPreferencesProvider).setString(_kTheme, mode.name);
    state = state.copyWith(themeMode: mode);
  }
}

final settingsProvider = NotifierProvider<SettingsController, Settings>(SettingsController.new);

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore());

final apiClientProvider = Provider<ApiClient>((ref) {
  final baseUrl = ref.watch(settingsProvider.select((s) => s.baseUrl));
  final client = ApiClient(
    baseUrl: baseUrl,
    tokens: ref.watch(tokenStoreProvider),
    onSessionExpired: () => ref.read(authControllerProvider.notifier).sessionExpired(),
  );
  ref.onDispose(client.dispose);
  return client;
});
