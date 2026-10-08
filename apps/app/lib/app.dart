import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/providers.dart';
import 'features/admin/families_screen.dart';
import 'features/admin/members_screen.dart';
import 'features/admin/users_screen.dart';
import 'features/activity/activity_controller.dart';
import 'features/activity/activity_screen.dart';
import 'features/auth/auth_controller.dart';
import 'features/autoupload/auto_upload_controller.dart';
import 'features/autoupload/auto_upload_service.dart';
import 'features/auth/invite_screen.dart';
import 'l10n/l10n.dart';
import 'features/auth/login_screen.dart';
import 'features/media/media_detail_screen.dart';
import 'features/push/push_service.dart';
import 'features/timeline/timeline_controller.dart';
import 'features/settings/settings_screen.dart';
import 'features/timeline/timeline_screen.dart';
import 'features/recaps/recap_screen.dart';
import 'features/recaps/recaps_repository.dart';
import 'theme/app_theme.dart';
import 'widgets/app_logo.dart';

/// Benachrichtigt den Router, wenn sich der Auth-Zustand ändert.
class _AuthRefresh extends ChangeNotifier {
  _AuthRefresh(Ref ref) {
    ref.listen(authControllerProvider, (_, _) => notifyListeners());
  }
}

/// Pfad aus der Adresszeile beim Start (nur Web), gesetzt in main().
String? initialDeepLink;

/// go_router/MaterialApp: Sprache aus der Systemliste wählen (siehe l10n.dart).
Locale resolveLocale(List<Locale>? preferred, Iterable<Locale> supported) => resolveAppLocale(preferred);

/// Für Snackbars aus Diensten ohne BuildContext (Push).
final rootMessengerKey = GlobalKey<ScaffoldMessengerState>();

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _AuthRefresh(ref);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    // Web: Deep-Link vom App-Start übernehmen – der Splash (eigene MaterialApp) setzt die Adresse
    // vorher auf '/' zurück, deshalb wird der Pfad in main() gesichert.
    initialLocation: (initialDeepLink?.length ?? 0) > 1 ? initialDeepLink! : '/',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      if (auth.isLoading) return null;
      final authed = auth.whenOrNull(data: (s) => s) is Authenticated;
      final loc = state.matchedLocation;
      final isLogin = loc == '/login';
      final isInvite = loc.startsWith('/invite');
      if (!authed && !isLogin && !isInvite) return '/login';
      if (authed && isLogin) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(
        path: '/invite',
        builder: (_, state) => InviteScreen(initialCode: state.uri.queryParameters['code'], initialServer: state.uri.queryParameters['server']),
      ),
      GoRoute(
        path: '/',
        builder: (_, _) => const TimelineScreen(),
        routes: [
          GoRoute(
            path: 'media/:id',
            pageBuilder: (_, state) => CustomTransitionPage(
              key: state.pageKey,
              // Nicht deckend: beim Wischen nach unten scheint die Timeline durch
              opaque: false,
              child: MediaDetailScreen(mediaId: state.pathParameters['id']!, openComments: state.uri.queryParameters['comments'] == '1'),
              transitionDuration: const Duration(milliseconds: 260),
              reverseTransitionDuration: const Duration(milliseconds: 220),
              transitionsBuilder: (_, animation, _, child) => FadeTransition(opacity: animation, child: child),
            ),
          ),
          GoRoute(path: 'activity', builder: (_, _) => const ActivityScreen()),
          GoRoute(path: 'recaps/:id', builder: (_, state) => RecapScreen(recapId: state.pathParameters['id']!)),
          GoRoute(
            path: 'settings',
            builder: (_, _) => const SettingsScreen(),
            routes: [
              GoRoute(path: 'members/:familyId', builder: (_, state) => MembersScreen(familyId: state.pathParameters['familyId']!)),
              GoRoute(path: 'users', builder: (_, _) => const UsersScreen()),
              GoRoute(path: 'families', builder: (_, _) => const FamiliesScreen()),
            ],
          ),
        ],
      ),
    ],
  );
});

class FamilienalbumApp extends ConsumerWidget {
  const FamilienalbumApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final themeMode = ref.watch(settingsProvider.select((s) => s.themeMode));

    // Push-Dienst starten (ohne Firebase-Konfiguration ein No-op) und Ereignisse verarbeiten
    ref.watch(pushServiceProvider);
    if (AutoUploadService.platformSupported) ref.watch(autoUploadControllerProvider);
    ref.listen(pushEventsProvider, (_, next) {
      final event = next.whenOrNull(data: (e) => e);
      if (event == null) return;
      ref.read(timelineControllerProvider.notifier).refresh();
      ref.read(unreadProvider.notifier).refresh();
      if (event.type == 'recap') ref.invalidate(recapsProvider);
      if (event.openedFromNotification && event.recapId != null) {
        ref.read(routerProvider).go('/recaps/${event.recapId}');
      } else if (event.openedFromNotification && event.mediaId != null) {
        ref.read(routerProvider).go('/media/${event.mediaId}');
      } else if (event.openedFromNotification) {
        ref.read(routerProvider).go('/activity');
      } else if (event.title != null) {
        rootMessengerKey.currentState?.showSnackBar(SnackBar(content: Text('${event.title}: ${event.body ?? ''}')));
      }
    });

    // Deutsch (Vorlage, Rückfall) und Englisch; die App folgt der Systemsprache des Geräts
    const locales = [Locale('de', 'CH'), Locale('de'), Locale('en')];
    const delegates = [
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ];

    // Beim allerersten Start warten wir auf die Session-Prüfung, damit der Router nicht flackert.
    if (auth.isLoading && !auth.hasValue) {
      return MaterialApp(
        title: 'Familienalbum',
        theme: AppTheme.light(),
        darkTheme: AppTheme.dark(),
        themeMode: themeMode,
        supportedLocales: locales,
        localeListResolutionCallback: resolveLocale,
        localizationsDelegates: delegates,
        home: const _StartupSplash(),
      );
    }

    return MaterialApp.router(
      scaffoldMessengerKey: rootMessengerKey,
      title: 'Familienalbum',
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: themeMode,
      supportedLocales: locales,
      localeListResolutionCallback: resolveLocale,
      localizationsDelegates: delegates,
      routerConfig: ref.watch(routerProvider),
    );
  }
}

/// Splash während der Session-Prüfung. Antwortet der Server nicht, erscheint nach kurzer Zeit
/// der Zielserver und ein Ausweg zum Login-Screen (dort lässt sich der Server ändern).
class _StartupSplash extends ConsumerStatefulWidget {
  const _StartupSplash();

  @override
  ConsumerState<_StartupSplash> createState() => _StartupSplashState();
}

class _StartupSplashState extends ConsumerState<_StartupSplash> {
  static const _hintAfter = Duration(seconds: 2);
  static const _escapeAfter = Duration(seconds: 5);
  Timer? _hintTimer;
  Timer? _escapeTimer;
  bool _showHint = false;
  bool _showEscape = false;

  @override
  void initState() {
    super.initState();
    _hintTimer = Timer(_hintAfter, () => setState(() => _showHint = true));
    _escapeTimer = Timer(_escapeAfter, () => setState(() => _showEscape = true));
  }

  @override
  void dispose() {
    _hintTimer?.cancel();
    _escapeTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final baseUrl = ref.watch(settingsProvider.select((s) => s.baseUrl));
    final host = Uri.tryParse(baseUrl)?.host ?? baseUrl;
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const AppLogo(size: 96),
            const SizedBox(height: 32),
            AnimatedOpacity(
              opacity: _showHint ? 1 : 0,
              duration: const Duration(milliseconds: 300),
              child: Column(
                children: [
                  const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                  const SizedBox(height: 12),
                  Text('Verbinde mit $host …', style: TextStyle(color: scheme.onSurfaceVariant)),
                ],
              ),
            ),
            const SizedBox(height: 8),
            AnimatedOpacity(
              opacity: _showEscape ? 1 : 0,
              duration: const Duration(milliseconds: 300),
              child: TextButton.icon(
                onPressed: _showEscape ? () => ref.read(authControllerProvider.notifier).abortStartup() : null,
                icon: const Icon(Icons.dns_outlined, size: 18),
                label: const Text('Server ändern oder neu anmelden'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
