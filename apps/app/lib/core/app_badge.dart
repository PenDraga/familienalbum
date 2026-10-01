import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Zahl auf dem App-Symbol (iOS). Der Server setzt sie per Push auf die Anzahl ungelesener Einträge,
/// die App gleicht sie mit dem Ungelesen-Zähler ab und löscht sie beim Öffnen des Verlaufs.
/// Android zeigt Badges nur pro Mitteilung, dort passiert nichts.
class AppBadge {
  static const _channel = MethodChannel('ch.familienalbum/badge');

  static Future<void> set(int count) async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.iOS) return;
    try {
      await _channel.invokeMethod<void>('set', count < 0 ? 0 : count);
    } catch (_) {
      // Kein nativer Handler (z.B. Tests) – Badge ist nur Komfort
    }
  }
}
