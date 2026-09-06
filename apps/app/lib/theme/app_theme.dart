import 'package:flutter/material.dart';

/// Design-Tokens: warme, ruhige Palette – die Fotos sollen im Vordergrund stehen.
/// Design-Tokens – Richtung «Kinderbuch»: warme Vanille, Koralle für Aktionen, Lagune für Bestätigungen,
/// Sonne und Heidelbeere als Akzente. Rund, weich, freundlich – die Fotos bleiben das Bunteste.
abstract final class AppTokens {
  static const accent = Color(0xFFFF7A59); // Koralle
  static const accentDark = Color(0xFFFF9A80);
  static const lagoon = Color(0xFF2BB3A3);
  static const sun = Color(0xFFFFC93C);
  static const berry = Color(0xFF6C63FF);
  static const vanilla = Color(0xFFFFF8E7);
  static const ink = Color(0xFF2E2A3A);

  // Kompatibilität für bestehende Aufrufer
  static const sage = lagoon;
  static const amber = sun;

  static const radiusS = 14.0;
  static const radiusM = 20.0;
  static const radiusL = 24.0;
  static const radiusXL = 32.0;

  static const gap = 8.0;
  static const pagePadding = EdgeInsets.symmetric(horizontal: 16);

  static const displayFont = 'Baloo 2';
  static const bodyFont = 'Nunito';
}

abstract final class AppTheme {
  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ColorScheme _scheme(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    return ColorScheme.fromSeed(
      seedColor: AppTokens.accent,
      brightness: brightness,
      primary: isDark ? AppTokens.accentDark : AppTokens.accent,
      onPrimary: isDark ? const Color(0xFF3E1408) : Colors.white,
      primaryContainer: isDark ? const Color(0xFF7A3520) : const Color(0xFFFFD6C9),
      onPrimaryContainer: isDark ? const Color(0xFFFFD6C9) : const Color(0xFF5A2414),
      secondary: isDark ? const Color(0xFF6ED4C7) : AppTokens.lagoon,
      onSecondary: isDark ? const Color(0xFF0B3A35) : Colors.white,
      secondaryContainer: isDark ? const Color(0xFF1F5C55) : const Color(0xFFBFE9E3),
      onSecondaryContainer: isDark ? const Color(0xFFBFE9E3) : const Color(0xFF0F3F39),
      tertiary: isDark ? const Color(0xFFFFD873) : AppTokens.sun,
      onTertiary: isDark ? const Color(0xFF3F2E00) : const Color(0xFF3F2E00),
      tertiaryContainer: isDark ? const Color(0xFF6B5210) : const Color(0xFFFFECB3),
      onTertiaryContainer: isDark ? const Color(0xFFFFECB3) : const Color(0xFF3F2E00),
      surface: isDark ? const Color(0xFF1E1B2A) : AppTokens.vanilla,
      onSurface: isDark ? const Color(0xFFF3EEFF) : AppTokens.ink,
      onSurfaceVariant: isDark ? const Color(0xFFB7B0CC) : const Color(0xFF7C7689),
      surfaceContainerLowest: isDark ? const Color(0xFF17151F) : Colors.white,
      surfaceContainerLow: isDark ? const Color(0xFF262233) : const Color(0xFFFFFDF7),
      surfaceContainer: isDark ? const Color(0xFF2C283A) : const Color(0xFFFFF3D9),
      surfaceContainerHigh: isDark ? const Color(0xFF342F44) : const Color(0xFFFFEDC8),
      surfaceContainerHighest: isDark ? const Color(0xFF3D374E) : const Color(0xFFFFE6B8),
      outline: isDark ? const Color(0xFF8A839E) : const Color(0xFFB9B3C6),
      outlineVariant: isDark ? const Color(0xFF3F3A50) : const Color(0xFFEFE7D6),
      inverseSurface: isDark ? const Color(0xFFF3EEFF) : AppTokens.ink,
      onInverseSurface: isDark ? AppTokens.ink : const Color(0xFFFFF8E7),
    );
  }

  static ThemeData _build(Brightness brightness) {
    final scheme = _scheme(brightness);
    final base = ThemeData(colorScheme: scheme, useMaterial3: true, brightness: brightness, fontFamily: AppTokens.bodyFont);
    TextStyle? display(TextStyle? s, {FontWeight weight = FontWeight.w700, double? size}) =>
        s?.copyWith(fontFamily: AppTokens.displayFont, fontWeight: weight, fontSize: size, letterSpacing: 0, height: 1.1);
    final text = base.textTheme.copyWith(
      displaySmall: display(base.textTheme.displaySmall, weight: FontWeight.w800),
      headlineMedium: display(base.textTheme.headlineMedium, weight: FontWeight.w800),
      headlineSmall: display(base.textTheme.headlineSmall),
      titleLarge: display(base.textTheme.titleLarge, size: 24),
      titleMedium: display(base.textTheme.titleMedium, size: 18),
      titleSmall: base.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
      labelLarge: base.textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.1),
      bodyLarge: base.textTheme.bodyLarge?.copyWith(height: 1.4),
      bodyMedium: base.textTheme.bodyMedium?.copyWith(height: 1.4),
    );

    RoundedRectangleBorder rounded(double r) => RoundedRectangleBorder(borderRadius: BorderRadius.circular(r));

    return base.copyWith(
      textTheme: text,
      scaffoldBackgroundColor: scheme.surface,
      splashFactory: InkSparkle.splashFactory,
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        surfaceTintColor: Colors.transparent,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: text.titleLarge?.copyWith(color: scheme.onSurface, fontSize: 21),
        toolbarHeight: 60,
      ),
      cardTheme: CardThemeData(
        color: scheme.surfaceContainerLowest,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: rounded(AppTokens.radiusL),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainer,
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 17),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppTokens.radiusM), borderSide: BorderSide.none),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(AppTokens.radiusM), borderSide: BorderSide.none),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppTokens.radiusM),
          borderSide: BorderSide(color: scheme.primary, width: 1.6),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppTokens.radiusM),
          borderSide: BorderSide(color: scheme.error, width: 1.2),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppTokens.radiusM),
          borderSide: BorderSide(color: scheme.error, width: 1.6),
        ),
        prefixIconColor: scheme.onSurfaceVariant,
        suffixIconColor: scheme.onSurfaceVariant,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(56),
          shape: rounded(AppTokens.radiusM),
          textStyle: text.labelLarge?.copyWith(fontSize: 17, fontFamily: AppTokens.displayFont, fontWeight: FontWeight.w700),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          shape: rounded(AppTokens.radiusM),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(shape: rounded(AppTokens.radiusS))),
      iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(foregroundColor: scheme.onSurfaceVariant)),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: scheme.primary,
        foregroundColor: scheme.onPrimary,
        elevation: 4,
        highlightElevation: 6,
        shape: rounded(22),
        extendedTextStyle: text.labelLarge?.copyWith(fontSize: 15),
      ),
      chipTheme: ChipThemeData(
        shape: rounded(999),
        side: BorderSide.none,
        backgroundColor: scheme.tertiaryContainer,
        labelStyle: text.labelMedium?.copyWith(color: scheme.onTertiaryContainer, fontWeight: FontWeight.w700),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      ),
      dialogTheme: DialogThemeData(
        shape: rounded(AppTokens.radiusXL),
        backgroundColor: scheme.surfaceContainerLow,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: text.titleLarge?.copyWith(color: scheme.onSurface),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: scheme.surfaceContainerLow,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppTokens.radiusXL))),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: rounded(AppTokens.radiusM),
        backgroundColor: scheme.inverseSurface,
        contentTextStyle: text.bodyMedium?.copyWith(color: scheme.onInverseSurface),
      ),
      listTileTheme: ListTileThemeData(
        shape: rounded(AppTokens.radiusM),
        iconColor: scheme.onSurfaceVariant,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
      ),
      dividerTheme: DividerThemeData(color: scheme.outlineVariant, space: 1, thickness: 1),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: SegmentedButton.styleFrom(
          shape: rounded(AppTokens.radiusM),
          side: BorderSide(color: scheme.outlineVariant),
          selectedBackgroundColor: scheme.primaryContainer,
          selectedForegroundColor: scheme.onPrimaryContainer,
        ),
      ),
      popupMenuTheme: PopupMenuThemeData(shape: rounded(AppTokens.radiusM), surfaceTintColor: Colors.transparent),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: scheme.primary,
        linearTrackColor: scheme.surfaceContainerHighest,
        circularTrackColor: Colors.transparent,
      ),
      dropdownMenuTheme: DropdownMenuThemeData(textStyle: text.titleLarge),
    );
  }
}
