import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/providers.dart';

/// Profilbild oder Initiale in einem weich gerundeten Quadrat (Richtung «Kinderbuch»).
/// [avatarUrl] ist der signierte, relative Link aus den DTOs (null = kein Bild).
class UserAvatar extends ConsumerWidget {
  const UserAvatar({super.key, required this.name, this.avatarUrl, this.size = 40, this.color, this.foregroundColor, this.radius});
  final String name;
  final String? avatarUrl;
  final double size;
  final Color? color;
  final Color? foregroundColor;
  final double? radius;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final bg = color ?? scheme.primary;
    final fg = foregroundColor ?? scheme.onPrimary;
    final r = radius ?? size * 0.36;
    final initial = name.trim().isEmpty ? '?' : name.trim()[0].toUpperCase();
    final url = avatarUrl;
    return ClipRRect(
      borderRadius: BorderRadius.circular(r),
      child: SizedBox(
        width: size,
        height: size,
        child: url == null
            ? ColoredBox(
                color: bg,
                child: Center(
                  child: Text(
                    initial,
                    style: TextStyle(color: fg, fontFamily: 'Baloo 2', fontWeight: FontWeight.w700, fontSize: size * 0.46, height: 1),
                  ),
                ),
              )
            : Image.network(
                ref.read(apiClientProvider).absolute(url),
                fit: BoxFit.cover,
                gaplessPlayback: true,
                errorBuilder: (_, _, _) => ColoredBox(
                  color: bg,
                  child: Center(child: Text(initial, style: TextStyle(color: fg, fontFamily: 'Baloo 2', fontWeight: FontWeight.w700, fontSize: size * 0.46, height: 1))),
                ),
              ),
      ),
    );
  }
}
