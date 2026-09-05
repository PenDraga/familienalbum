import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Im Web (v.a. iOS Safari) verursacht BackdropFilter schwarze Flächen und hohe GPU-Last –
/// dort nur tönen, nicht weichzeichnen.
bool get glassBlurSupported => !kIsWeb;

/// Hero-Flüge mit Bildern lassen im Web-Renderer die Ausgangskachel nach der Rückkehr schwarz
/// (Bild wird während des Flugs freigegeben) – dort ohne Hero.
bool get heroTransitionsSupported => !kIsWeb;

/// Milchglas: Weichzeichner über dem Inhalt darunter plus leichte Tönung.
class Glass extends StatelessWidget {
  const Glass({
    super.key,
    required this.child,
    this.blur = 22,
    this.tint,
    this.borderRadius = BorderRadius.zero,
    this.border = false,
  });

  final Widget child;
  final double blur;
  /// Standard: Oberfläche der aktuellen Theme-Helligkeit, halbtransparent.
  final Color? tint;
  final BorderRadius borderRadius;
  final bool border;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    var color = tint ?? scheme.surface.withValues(alpha: isDark ? 0.55 : 0.62);
    // Ohne Blur braucht die Tönung mehr Deckkraft, damit Text lesbar bleibt
    if (!glassBlurSupported) color = color.withValues(alpha: (color.a + 0.25).clamp(0.0, 0.95));

    final box = DecoratedBox(
      decoration: BoxDecoration(
        color: color,
        borderRadius: borderRadius,
        border: border ? Border.all(color: Colors.white.withValues(alpha: isDark ? 0.08 : 0.35), width: 0.8) : null,
      ),
      child: child,
    );
    return ClipRRect(
      borderRadius: borderRadius,
      child: glassBlurSupported ? BackdropFilter(filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur), child: box) : box,
    );
  }
}

/// Runder Glas-Button (über Fotos lesbar, hell wie dunkel).
class GlassIconButton extends StatelessWidget {
  const GlassIconButton({super.key, required this.icon, required this.onPressed, this.tooltip, this.badge, this.dark = false});

  final IconData icon;
  final VoidCallback? onPressed;
  final String? tooltip;
  final String? badge;
  /// Auf dunklem Hintergrund (Detailansicht) immer helle Symbole.
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final isDark = dark || Theme.of(context).brightness == Brightness.dark;
    final fg = isDark ? Colors.white : Theme.of(context).colorScheme.onSurface;
    return Glass(
      blur: 16,
      borderRadius: BorderRadius.circular(22),
      tint: (isDark ? Colors.black : Colors.white).withValues(alpha: isDark ? 0.35 : 0.55),
      border: true,
      child: SizedBox(
        width: 44,
        height: 44,
        child: IconButton(
          tooltip: tooltip,
          onPressed: onPressed,
          color: fg,
          icon: badge == null ? Icon(icon) : Badge(label: Text(badge!), child: Icon(icon)),
        ),
      ),
    );
  }
}

/// Glas-Pille mit Text (Monatsköpfe, Zähler).
class GlassPill extends StatelessWidget {
  const GlassPill({super.key, required this.child, this.padding = const EdgeInsets.symmetric(horizontal: 14, vertical: 8), this.dark = false});
  final Widget child;
  final EdgeInsets padding;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final isDark = dark || Theme.of(context).brightness == Brightness.dark;
    return Glass(
      blur: 18,
      borderRadius: BorderRadius.circular(999),
      tint: (isDark ? Colors.black : Colors.white).withValues(alpha: isDark ? 0.4 : 0.6),
      border: true,
      child: Padding(padding: padding, child: child),
    );
  }
}
