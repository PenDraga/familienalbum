import 'package:flutter/material.dart';

/// Design-Tokens: warme, ruhige Palette – die Fotos sollen im Vordergrund stehen.
abstract final class AppTokens {
  static const accent = Color(0xFFB8552E); // Terracotta
  static const accentDark = Color(0xFFF0A07C);
  static const sage = Color(0xFF6B7F6A);
  static const amber = Color(0xFFC9963C);

  static const radiusS = 10.0;
  static const radiusM = 14.0;
  static const radiusL = 20.0;
  static const radiusXL = 28.0;

  static const gap = 8.0;
  static const pagePadding = EdgeInsets.symmetric(horizontal: 16);
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
      onPrimary: isDark ? const Color(0xFF4A1F0B) : Colors.white,
      primaryContainer: isDark ? const Color(0xFF7A3418) : const Color(0xFFFFDCCF),
      onPrimaryContainer: isDark ? const Color(0xFFFFDCCF) : const Color(0xFF3B1607),
      secondary: isDark ? const Color(0xFFA9BFA6) : AppTokens.sage,
      onSecondary: isDark ? const Color(0xFF1B2A1B) : Colors.white,
      secondaryContainer: isDark ? const Color(0xFF34473A) : const Color(0xFFD9E5D6),
      onSecondaryContainer: isDark ? const Color(0xFFD9E5D6) : const Color(0xFF18261A),
      tertiary: isDark ? const Color(0xFFE6B865) : AppTokens.amber,
      tertiaryContainer: isDark ? const Color(0xFF5C4210) : const Color(0xFFFBE7BD),
      onTertiaryContainer: isDark ? const Color(0xFFFBE7BD) : const Color(0xFF2E2000),
      surface: isDark ? const Color(0xFF171412) : const Color(0xFFFBF8F3),
      onSurface: isDark ? const Color(0xFFEDE6DF) : const Color(0xFF2B2622),
      onSurfaceVariant: isDark ? const Color(0xFFB9AEA4) : const Color(0xFF6E645C),
      surfaceContainerLowest: isDark ? const Color(0xFF110F0D) : Colors.white,
      surfaceContainerLow: isDark ? const Color(0xFF1E1A17) : const Color(0xFFF6F1EA),
      surfaceContainer: isDark ? const Color(0xFF241F1B) : const Color(0xFFF1EBE2),
      surfaceContainerHigh: isDark ? const Color(0xFF2B2521) : const Color(0xFFEBE4DA),
      surfaceContainerHighest: isDark ? const Color(0xFF332C27) : const Color(0xFFE5DDD2),
      outline: isDark ? const Color(0xFF85796F) : const Color(0xFF9C9086),
      outlineVariant: isDark ? const Color(0xFF3F3731) : const Color(0xFFE2D9CE),
      inverseSurface: isDark ? const Color(0xFFEDE6DF) : const Color(0xFF332C27),
      onInverseSurface: isDark ? const Color(0xFF2B2622) : const Color(0xFFF6F1EA),
    );
  }

  static ThemeData _build(Brightness brightness) {
    final scheme = _scheme(brightness);
    final base = ThemeData(colorScheme: scheme, useMaterial3: true, brightness: brightness);
    final text = base.textTheme.copyWith(
      displaySmall: base.textTheme.displaySmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: -0.5),
      headlineMedium: base.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700, letterSpacing: -0.4),
      headlineSmall: base.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w600, letterSpacing: -0.3),
      titleLarge: base.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600, letterSpacing: -0.2),
      titleMedium: base.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
      labelLarge: base.textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w600, letterSpacing: 0.2),
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
        color: scheme.surfaceContainerLow,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: rounded(AppTokens.radiusL),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerLow,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
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
          minimumSize: const Size.fromHeight(52),
          shape: rounded(AppTokens.radiusM),
          textStyle: text.labelLarge?.copyWith(fontSize: 16),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(48),
          shape: rounded(AppTokens.radiusM),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(shape: rounded(AppTokens.radiusS))),
      iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(foregroundColor: scheme.onSurfaceVariant)),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: scheme.primary,
        foregroundColor: scheme.onPrimary,
        elevation: 2,
        highlightElevation: 4,
        shape: rounded(AppTokens.radiusL),
        extendedTextStyle: text.labelLarge?.copyWith(fontSize: 15),
      ),
      chipTheme: ChipThemeData(
        shape: rounded(AppTokens.radiusS),
        side: BorderSide.none,
        backgroundColor: scheme.surfaceContainerHigh,
        labelStyle: text.labelMedium?.copyWith(color: scheme.onSurface),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
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
