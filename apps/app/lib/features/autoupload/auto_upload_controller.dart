import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../auth/auth_controller.dart';
import '../auth/auth_models.dart';
import '../timeline/timeline_controller.dart';
import 'auto_upload_background.dart';
import 'auto_upload_service.dart';
import 'auto_upload_settings.dart';

class AutoUploadState {
  const AutoUploadState({required this.settings, this.running = false, this.lastError});
  final AutoUploadSettings settings;
  final bool running;
  final String? lastError;

  AutoUploadState copyWith({AutoUploadSettings? settings, bool? running, String? lastError, bool clearError = false}) => AutoUploadState(
    settings: settings ?? this.settings,
    running: running ?? this.running,
    lastError: clearError ? null : (lastError ?? this.lastError),
  );
}

/// Einstellungen des Auto-Uploads plus Vordergrund-Sync (App-Start, Rückkehr in den Vordergrund, manuell).
class AutoUploadController extends Notifier<AutoUploadState> with WidgetsBindingObserver {
  DateTime _lastForegroundRun = DateTime.fromMillisecondsSinceEpoch(0);

  AutoUploadStore get _store => AutoUploadStore(ref.read(sharedPreferencesProvider));

  @override
  AutoUploadState build() {
    WidgetsBinding.instance.addObserver(this);
    ref.onDispose(() => WidgetsBinding.instance.removeObserver(this));
    final settings = _store.read();
    // Recht entzogen oder Album verlassen: Auto-Upload aus, sobald /me das meldet
    ref.listen(meProvider, (_, me) => _enforceUploadRight(me));
    if (settings.enabled) Future.microtask(() => runNow(silent: true));
    return AutoUploadState(settings: settings);
  }

  /// Familien, in denen der Benutzer hochladen darf – nur die kommen für den Auto-Upload in Frage.
  static List<Family> uploadableFamilies(Me? me) => me?.families.where((f) => f.membership.canUpload).toList() ?? const [];

  Future<void> _enforceUploadRight(Me? me) async {
    final s = state.settings;
    if (!s.enabled || me == null) return;
    final family = me.families.where((f) => f.id == s.familyId).firstOrNull;
    if (family != null && family.membership.canUpload) return;
    final reason = family == null ? 'Ausgeschaltet: du bist nicht mehr Mitglied dieses Albums' : 'Ausgeschaltet: du darfst in «${family.name}» nicht hochladen';
    await _store.write(s.copyWith(enabled: false, lastRunAt: DateTime.now(), lastRunSummary: reason));
    await AutoUploadBackground.cancel();
    state = state.copyWith(settings: _store.read(), lastError: reason);
  }

  @override
  // ignore: avoid_renaming_method_parameters – `state` ist im Notifier belegt
  void didChangeAppLifecycleState(AppLifecycleState lifecycle) {
    if (lifecycle == AppLifecycleState.resumed && state.settings.enabled) {
      // Höchstens alle 5 Minuten, sonst hämmert jede kurze Rückkehr auf die Galerie
      if (DateTime.now().difference(_lastForegroundRun) > const Duration(minutes: 5)) runNow(silent: true);
    }
  }

  Future<void> setEnabled(bool enabled) async {
    var s = state.settings.copyWith(enabled: enabled);
    if (enabled) {
      final allowed = uploadableFamilies(ref.read(meProvider));
      if (allowed.isEmpty) return;
      final selected = ref.read(selectedFamilyProvider)?.id;
      final keep = allowed.any((f) => f.id == s.familyId) ? s.familyId : null;
      s = s.copyWith(
        familyId: keep ?? (allowed.any((f) => f.id == selected) ? selected : allowed.first.id),
        // Nur Aufnahmen ab jetzt – die bestehende Galerie wird nicht rückwirkend hochgeladen
        since: s.since ?? DateTime.now(),
      );
    }
    await _save(s);
    await AutoUploadBackground.schedule(s);
    if (enabled) await runNow(silent: true);
  }

  Future<void> setFamily(String familyId) => _save(state.settings.copyWith(familyId: familyId));

  Future<void> setWifiOnly(bool v) async {
    await _save(state.settings.copyWith(wifiOnly: v));
    await AutoUploadBackground.schedule(state.settings);
  }

  Future<void> setIncludeVideos(bool v) => _save(state.settings.copyWith(includeVideos: v));

  /// Auch ältere Aufnahmen ab einem Datum nachladen.
  Future<void> setSince(DateTime since) => _save(state.settings.copyWith(since: since));

  Future<void> _save(AutoUploadSettings s) async {
    await _store.write(s);
    state = state.copyWith(settings: s, clearError: true);
  }

  Future<void> runNow({bool silent = false}) async {
    if (state.running || !AutoUploadService.platformSupported) return;
    if (ref.read(meProvider) == null) return;
    _lastForegroundRun = DateTime.now();
    state = state.copyWith(running: true, clearError: true);
    try {
      final baseUrl = ref.read(settingsProvider).baseUrl;
      final result = await AutoUploadService(prefs: ref.read(sharedPreferencesProvider), baseUrl: baseUrl).run();
      state = state.copyWith(settings: _store.read(), running: false);
      if (result.uploaded > 0) ref.read(timelineControllerProvider.notifier).refresh();
    } catch (e) {
      state = state.copyWith(running: false, lastError: '$e', settings: _store.read());
      if (!silent) rethrow;
    }
  }
}

final autoUploadControllerProvider = NotifierProvider<AutoUploadController, AutoUploadState>(AutoUploadController.new);
