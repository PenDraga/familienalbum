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
import 'features/auth/login_screen.dart';
import 'features/media/media_detail_screen.dart';
import 'features/push/push_service.dart';
import 'features/timeline/timeline_controller.dart';
import 'features/settings/settings_screen.dart';
import 'features/timeline/timeline_screen.dart';
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
        builder: (_, state) => InviteScreen(initialCode: state.uri.queryParameters['code']),
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
      if (event.openedFromNotification && event.mediaId != null) {
        ref.read(routerProvider).go('/media/${event.mediaId}');
      } else if (event.openedFromNotification) {
        ref.read(routerProvider).go('/activity');
      } else if (event.title != null) {
        rootMessengerKey.currentState?.showSnackBar(SnackBar(content: Text('${event.title}: ${event.body ?? ''}')));
      }
    });

    const locales = [Locale('de', 'CH'), Locale('de')];
    const delegates = [
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
        locale: locales.first,
        supportedLocales: locales,
        localizationsDelegates: delegates,
        home: const Scaffold(body: Center(child: AppLogo(size: 96))),
      );
    }

    return MaterialApp.router(
      scaffoldMessengerKey: rootMessengerKey,
      title: 'Familienalbum',
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: themeMode,
      locale: locales.first,
      supportedLocales: locales,
      localizationsDelegates: delegates,
      routerConfig: ref.watch(routerProvider),
    );
  }
}
