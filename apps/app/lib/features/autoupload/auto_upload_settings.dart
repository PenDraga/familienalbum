import 'package:shared_preferences/shared_preferences.dart';

/// Konfiguration und Zustand des automatischen Uploads – bewusst nur auf SharedPreferences,
/// damit der Hintergrund-Isolate (Workmanager) ohne Riverpod darauf zugreifen kann.
class AutoUploadSettings {
  const AutoUploadSettings({
    required this.enabled,
    required this.familyId,
    required this.wifiOnly,
    required this.includeVideos,
    required this.since,
    required this.lastRunAt,
    required this.lastRunSummary,
    required this.uploadedCount,
  });

  final bool enabled;
  /// Zielfamilie
  final String? familyId;
  final bool wifiOnly;
  final bool includeVideos;
  /// Nur Aufnahmen ab diesem Zeitpunkt (Standard: Zeitpunkt des Einschaltens)
  final DateTime? since;
  final DateTime? lastRunAt;
  final String? lastRunSummary;
  final int uploadedCount;

  static const empty = AutoUploadSettings(
    enabled: false,
    familyId: null,
    wifiOnly: true,
    includeVideos: true,
    since: null,
    lastRunAt: null,
    lastRunSummary: null,
    uploadedCount: 0,
  );

  AutoUploadSettings copyWith({
    bool? enabled,
    String? familyId,
    bool? wifiOnly,
    bool? includeVideos,
    DateTime? since,
    DateTime? lastRunAt,
    String? lastRunSummary,
    int? uploadedCount,
  }) => AutoUploadSettings(
    enabled: enabled ?? this.enabled,
    familyId: familyId ?? this.familyId,
    wifiOnly: wifiOnly ?? this.wifiOnly,
    includeVideos: includeVideos ?? this.includeVideos,
    since: since ?? this.since,
    lastRunAt: lastRunAt ?? this.lastRunAt,
    lastRunSummary: lastRunSummary ?? this.lastRunSummary,
    uploadedCount: uploadedCount ?? this.uploadedCount,
  );
}

class AutoUploadStore {
  AutoUploadStore(this._prefs);
  final SharedPreferences _prefs;

  static const _kEnabled = 'au.enabled';
  static const _kFamily = 'au.familyId';
  static const _kWifi = 'au.wifiOnly';
  static const _kVideos = 'au.includeVideos';
  static const _kSince = 'au.since';
  static const _kLastRun = 'au.lastRunAt';
  static const _kSummary = 'au.lastRunSummary';
  static const _kCount = 'au.uploadedCount';
  static const _kDone = 'au.doneAssetIds';

  AutoUploadSettings read() => AutoUploadSettings(
    enabled: _prefs.getBool(_kEnabled) ?? false,
    familyId: _prefs.getString(_kFamily),
    wifiOnly: _prefs.getBool(_kWifi) ?? true,
    includeVideos: _prefs.getBool(_kVideos) ?? true,
    since: _date(_kSince),
    lastRunAt: _date(_kLastRun),
    lastRunSummary: _prefs.getString(_kSummary),
    uploadedCount: _prefs.getInt(_kCount) ?? 0,
  );

  DateTime? _date(String key) {
    final ms = _prefs.getInt(key);
    return ms == null ? null : DateTime.fromMillisecondsSinceEpoch(ms);
  }

  Future<void> write(AutoUploadSettings s) async {
    await _prefs.setBool(_kEnabled, s.enabled);
    await _prefs.setBool(_kWifi, s.wifiOnly);
    await _prefs.setBool(_kVideos, s.includeVideos);
    await _prefs.setInt(_kCount, s.uploadedCount);
    await _setOrRemove(_kFamily, s.familyId);
    await _setOrRemove(_kSummary, s.lastRunSummary);
    await _setOrRemoveDate(_kSince, s.since);
    await _setOrRemoveDate(_kLastRun, s.lastRunAt);
  }

  Future<void> _setOrRemove(String key, String? value) => value == null ? _prefs.remove(key) : _prefs.setString(key, value);
  Future<void> _setOrRemoveDate(String key, DateTime? value) =>
      value == null ? _prefs.remove(key) : _prefs.setInt(key, value.millisecondsSinceEpoch);

  /// Bereits verarbeitete Galerie-Assets (hochgeladen oder als Duplikat erkannt).
  Set<String> doneAssetIds() => (_prefs.getStringList(_kDone) ?? const []).toSet();

  Future<void> markDone(Iterable<String> ids) async {
    final all = doneAssetIds()..addAll(ids);
    // Liste begrenzen – der Server dedupliziert ohnehin per SHA-256
    final list = all.toList();
    await _prefs.setStringList(_kDone, list.length > 5000 ? list.sublist(list.length - 5000) : list);
  }

  Future<void> reset() async {
    for (final k in [_kEnabled, _kFamily, _kWifi, _kVideos, _kSince, _kLastRun, _kSummary, _kCount, _kDone]) {
      await _prefs.remove(k);
    }
  }
}
