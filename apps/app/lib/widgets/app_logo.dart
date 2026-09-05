import 'package:flutter/material.dart';

/// Das App-Icon als Logo, abgerundet.
class AppLogo extends StatelessWidget {
  const AppLogo({super.key, this.size = 72});
  final double size;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(size * 0.22),
      child: Image.asset('assets/branding/icon.png', width: size, height: size, filterQuality: FilterQuality.medium),
    );
  }
}
