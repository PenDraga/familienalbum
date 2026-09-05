import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmanager/workmanager.dart';

import 'auto_upload_service.dart';
import 'auto_upload_settings.dart';

const autoUploadTaskName = 'ch.familienalbum.autoupload';
const _uniqueName = 'familienalbum-auto-upload';

/// Einstieg für den Hintergrund-Isolate (Android WorkManager / iOS BGTaskScheduler).
/// Läuft ohne Widget-Baum und ohne Riverpod – nur SharedPreferences, Secure Storage und HTTP.
@pragma('vm:entry-point')
void autoUploadDispatcher() {
  Workmanager().executeTask((taskName, inputData) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final baseUrl = prefs.getString('fa.baseUrl');
      if (baseUrl == null || baseUrl.isEmpty) return true;
      final result = await AutoUploadService(prefs: prefs, baseUrl: baseUrl).run();
      debugPrint('Auto-Upload (Hintergrund): ${result.summary}');
      return true;
    } catch (e, st) {
      debugPrint('Auto-Upload (Hintergrund) fehlgeschlagen: $e\n$st');
      // false → WorkManager versucht es mit Backoff erneut
      return false;
    }
  });
}

/// Registrierung der Hintergrundaufgabe – nur Android/iOS.
abstract final class AutoUploadBackground {
  static bool _initialized = false;

  static Future<void> initialize() async {
    if (!AutoUploadService.platformSupported || _initialized) return;
    await Workmanager().initialize(autoUploadDispatcher);
    _initialized = true;
  }

  /// Periodischen Job anlegen/aktualisieren (Android: min. 15 Minuten, iOS entscheidet das System).
  static Future<void> schedule(AutoUploadSettings settings) async {
    if (!AutoUploadService.platformSupported) return;
    await initialize();
    if (!settings.enabled) {
      await Workmanager().cancelByUniqueName(_uniqueName);
      return;
    }
    await Workmanager().registerPeriodicTask(
      _uniqueName,
      autoUploadTaskName,
      frequency: const Duration(minutes: 30),
      initialDelay: const Duration(minutes: 5),
      constraints: Constraints(
        networkType: settings.wifiOnly ? NetworkType.unmetered : NetworkType.connected,
        requiresBatteryNotLow: true,
        requiresStorageNotLow: true,
      ),
      existingWorkPolicy: ExistingPeriodicWorkPolicy.update,
      backoffPolicy: BackoffPolicy.exponential,
      backoffPolicyDelay: const Duration(minutes: 10),
    );
  }

  static Future<void> cancel() async {
    if (!AutoUploadService.platformSupported) return;
    await initialize();
    await Workmanager().cancelByUniqueName(_uniqueName);
  }
}
