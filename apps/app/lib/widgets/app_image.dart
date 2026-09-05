import 'package:cached_network_image/cached_network_image.dart';
import 'package:cached_network_image_platform_interface/cached_network_image_platform_interface.dart' show ImageRenderMethodForWeb;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Netzwerkbild mit Platzhalter und Fehleranzeige.
///
/// Web: Flutters eigenes `Image.network` – der Bild-Cache von cached_network_image gibt im Web-Renderer
/// dekodierte Bilder beim Neuaufbau frei (Theme-Wechsel, Rückkehr aus der Detailansicht), die Kacheln
/// werden dann schwarz. Der Browser-Cache übernimmt hier die Zwischenspeicherung (signierte URLs sind
/// 24 h stabil, Cache-Control ist gesetzt).
/// Nativ: cached_network_image mit Disk-Cache.
class AppImage extends StatelessWidget {
  const AppImage({
    super.key,
    required this.url,
    this.fit = BoxFit.cover,
    this.placeholder,
    this.errorWidget,
    this.fadeIn = const Duration(milliseconds: 200),
    this.alignment = Alignment.center,
  });

  final String url;
  final BoxFit fit;
  final Widget? placeholder;
  final Widget? errorWidget;
  final Duration fadeIn;
  final Alignment alignment;

  @override
  Widget build(BuildContext context) {
    final error = errorWidget ?? Icon(Icons.broken_image_outlined, color: Theme.of(context).colorScheme.outline);
    if (kIsWeb) {
      return Image.network(
        url,
        fit: fit,
        alignment: alignment,
        gaplessPlayback: true,
        frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
          if (wasSynchronouslyLoaded || fadeIn == Duration.zero) return child;
          return AnimatedOpacity(opacity: frame == null ? 0 : 1, duration: fadeIn, curve: Curves.easeOut, child: child);
        },
        loadingBuilder: (context, child, progress) => progress == null ? child : (placeholder ?? const SizedBox.shrink()),
        errorBuilder: (_, _, _) => error,
      );
    }
    return CachedNetworkImage(
      imageRenderMethodForWeb: ImageRenderMethodForWeb.HttpGet,
      imageUrl: url,
      fit: fit,
      alignment: alignment,
      fadeInDuration: fadeIn,
      placeholder: (_, _) => placeholder ?? const SizedBox.shrink(),
      errorWidget: (_, _, _) => error,
    );
  }
}
