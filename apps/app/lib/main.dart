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
  await initializeDateFormatting('de_CH');
  final prefs = await SharedPreferences.getInstance();
  await AutoUploadBackground.initialize();

  runApp(
    ProviderScope(
      overrides: [sharedPreferencesProvider.overrideWithValue(prefs)],
      child: const FamilienalbumApp(),
    ),
  );
}
