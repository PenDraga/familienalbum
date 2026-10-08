import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_web_plugins/url_strategy.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'core/providers.dart';
import 'features/autoupload/auto_upload_background.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Saubere URLs im Web (/media/:id statt /#/media/:id); Caddy liefert dafür index.html per try_files.
  usePathUrlStrategy();
  // Pfad samt Query, damit z.B. /invite?code=… beim Start erhalten bleibt.
  if (kIsWeb) initialDeepLink = Uri.base.hasQuery ? '${Uri.base.path}?${Uri.base.query}' : Uri.base.path;
  await initializeDateFormatting('de_CH');
  await initializeDateFormatting('en');
  final prefs = await SharedPreferences.getInstance();
  await AutoUploadBackground.initialize();

  runApp(
    ProviderScope(
      overrides: [sharedPreferencesProvider.overrideWithValue(prefs)],
      child: const FamilienalbumApp(),
    ),
  );
}
