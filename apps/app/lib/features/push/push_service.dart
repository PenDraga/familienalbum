import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import '../comments/comments_repository.dart';

/// Firebase-Konfiguration per --dart-define (Werte aus der Firebase-Konsole, App-Einstellungen).
/// Fehlt sie, bleibt Push aus und die App pollt (Web/Windows ohnehin).
abstract final class PushConfig {
  static const apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const appId = String.fromEnvironment('FIREBASE_APP_ID');
  static const projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const senderId = String.fromEnvironment('FIREBASE_SENDER_ID');

  static bool get configured => apiKey.isNotEmpty && appId.isNotEmpty && projectId.isNotEmpty && senderId.isNotEmpty;

  static bool get platformSupported =>
      !kIsWeb && (defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS);

  static bool get enabled => configured && platformSupported;
}

/// Eingehende Nachricht, reduziert auf das, was die App braucht.
class PushEvent {
  const PushEvent({required this.type, this.familyId, this.mediaId, this.title, this.body, required this.openedFromNotification});
  final String type; // media | comment
  final String? familyId;
  final String? mediaId;
  final String? title;
  final String? body;
  final bool openedFromNotification;
}

class PushService {
  PushService(this._ref);
  final Ref _ref;

  final _events = StreamController<PushEvent>.broadcast();
  Stream<PushEvent> get events => _events.stream;

  bool _initialized = false;
  String? _token;
  StreamSubscription<String>? _tokenSub;

  String get _platform => defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';

  /// Nach erfolgreicher Anmeldung aufrufen. Ohne Firebase-Konfiguration passiert nichts.
  Future<void> onLogin() async {
    if (!PushConfig.enabled) return;
    try {
      if (!_initialized) {
        await Firebase.initializeApp(
          options: const FirebaseOptions(
            apiKey: PushConfig.apiKey,
            appId: PushConfig.appId,
            messagingSenderId: PushConfig.senderId,
            projectId: PushConfig.projectId,
          ),
        );
        final messaging = FirebaseMessaging.instance;
        await messaging.requestPermission(alert: true, badge: true, sound: true);
        FirebaseMessaging.onMessage.listen((m) => _emit(m, opened: false));
        FirebaseMessaging.onMessageOpenedApp.listen((m) => _emit(m, opened: true));
        final initial = await messaging.getInitialMessage();
        if (initial != null) _emit(initial, opened: true);
        _tokenSub = messaging.onTokenRefresh.listen((t) {
          _token = t;
          _register();
        });
        _initialized = true;
      }
      _token = await FirebaseMessaging.instance.getToken();
      await _register();
    } catch (e, st) {
      debugPrint('Push nicht verfügbar: $e\n$st');
    }
  }

  /// Vor dem Abmelden aufrufen (braucht noch ein gültiges Access-Token).
  Future<void> onLogout() async {
    final t = _token;
    if (t == null) return;
    try {
      await _ref.read(commentsRepositoryProvider).unregisterDevice(t);
    } catch (_) {
      // Token bleibt serverseitig, wird beim nächsten Login umgehängt
    }
  }

  Future<void> _register() async {
    final t = _token;
    if (t == null) return;
    try {
      await _ref.read(commentsRepositoryProvider).registerDevice(t, _platform);
    } catch (e) {
      debugPrint('Push-Token konnte nicht registriert werden: $e');
    }
  }

  void _emit(RemoteMessage m, {required bool opened}) {
    final d = m.data;
    _events.add(
      PushEvent(
        type: (d['type'] as String?) ?? 'unknown',
        familyId: d['familyId'] as String?,
        mediaId: d['mediaId'] as String?,
        title: m.notification?.title,
        body: m.notification?.body,
        openedFromNotification: opened,
      ),
    );
  }

  void dispose() {
    _tokenSub?.cancel();
    _events.close();
  }
}

final pushServiceProvider = Provider<PushService>((ref) {
  final service = PushService(ref);
  ref.onDispose(service.dispose);
  // Bei Anmeldung registrieren
  ref.listen(authControllerProvider, (prev, next) {
    final wasAuthed = prev?.whenOrNull(data: (s) => s) is Authenticated;
    final isAuthed = next.whenOrNull(data: (s) => s) is Authenticated;
    if (isAuthed && !wasAuthed) service.onLogin();
  });
  // Bereits angemeldet beim App-Start
  if (ref.read(authControllerProvider).whenOrNull(data: (s) => s) is Authenticated) service.onLogin();
  return service;
});

final pushEventsProvider = StreamProvider<PushEvent>((ref) => ref.watch(pushServiceProvider).events);
