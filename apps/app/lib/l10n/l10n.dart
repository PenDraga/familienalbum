import 'dart:ui' show PlatformDispatcher;

import 'package:flutter/widgets.dart';

import 'generated/app_localizations.dart';

export 'generated/app_localizations.dart';

/// Kurzform für Texte: `context.l10n.commonCancel`. Deutsch ist Vorlage und Rückfallsprache, Englisch die zweite.
extension L10nContext on BuildContext {
  AppLocalizations get l10n => AppLocalizations.of(this);

  /// Sprachkennung für intl-Formate (Datum, Zahlen), z.B. `de_CH` oder `en`.
  String get localeTag => Localizations.localeOf(this).toString();
}

/// Erste Systemsprache, die wir sprechen (de → de_CH, en → en); sonst Deutsch.
Locale resolveAppLocale(List<Locale>? preferred) {
  for (final l in preferred ?? const <Locale>[]) {
    if (l.languageCode == 'de') return const Locale('de', 'CH');
    if (l.languageCode == 'en') return const Locale('en');
  }
  return const Locale('de', 'CH');
}

/// Texte ausserhalb des Widget-Baums (Controller, Services, Hintergrund-Läufe): Systemsprache des Geräts.
AppLocalizations currentL10n() => lookupAppLocalizations(resolveAppLocale(PlatformDispatcher.instance.locales));

/// Sprachkennung ausserhalb des Widget-Baums, z.B. für DateFormat.
String currentLocaleTag() => resolveAppLocale(PlatformDispatcher.instance.locales).toString();
