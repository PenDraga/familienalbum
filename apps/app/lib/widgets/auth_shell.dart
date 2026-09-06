import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'app_logo.dart';

/// Gemeinsamer Rahmen für Login und Einladung: warmer Verlauf oben, Karte mit Inhalt.
class AuthShell extends StatelessWidget {
  const AuthShell({super.key, required this.title, required this.subtitle, required this.child, this.onBack});

  final String title;
  final String subtitle;
  final Widget child;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(child: ColoredBox(color: scheme.surface)),
          // Weiche Farbblasen (Richtung «Kinderbuch»)
          Positioned(left: -70, bottom: -90, child: _Blob(color: scheme.secondaryContainer, size: 260)),
          Positioned(right: -60, bottom: 90, child: _Blob(color: scheme.tertiaryContainer, size: 190)),
          Positioned(right: -40, top: 60, child: _Blob(color: scheme.primaryContainer.withValues(alpha: 0.7), size: 150)),
          if (onBack != null)
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: IconButton.filledTonal(onPressed: onBack, icon: const Icon(Icons.arrow_back)),
              ),
            ),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 48, 20, 32),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 440),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const AppLogo(size: 104),
                      const SizedBox(height: 20),
                      Text(title, textAlign: TextAlign.center, style: text.headlineMedium),
                      const SizedBox(height: 6),
                      Text(
                        subtitle,
                        textAlign: TextAlign.center,
                        style: text.bodyLarge?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                      const SizedBox(height: 28),
                      Card(
                        color: scheme.surfaceContainerLowest,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTokens.radiusXL)),
                        child: Padding(padding: const EdgeInsets.all(24), child: child),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Fehlermeldung in einem dezenten Kasten.
class ErrorBanner extends StatelessWidget {
  const ErrorBanner(this.message, {super.key});
  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(AppTokens.radiusM),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, color: scheme.onErrorContainer, size: 20),
          const SizedBox(width: 10),
          Expanded(child: Text(message, style: TextStyle(color: scheme.onErrorContainer))),
        ],
      ),
    );
  }
}

class _Blob extends StatelessWidget {
  const _Blob({required this.color, required this.size});
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(width: size, height: size, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
    );
  }
}
