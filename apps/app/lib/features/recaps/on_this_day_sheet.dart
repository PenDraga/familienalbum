import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../theme/app_theme.dart';
import '../timeline/media_model.dart';
import 'recap_models.dart';

/// «An diesem Tag»: Gruppen nach Abstand, Kacheln öffnen das Medium.
Future<void> showOnThisDaySheet(BuildContext context, List<OnThisDayGroup> groups) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (ctx) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      minChildSize: 0.4,
      maxChildSize: 0.95,
      builder: (ctx, controller) {
        final text = Theme.of(ctx).textTheme;
        final scheme = Theme.of(ctx).colorScheme;
        return CustomScrollView(
          controller: controller,
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 8, 4),
                child: Row(
                  children: [
                    Icon(Icons.auto_awesome, color: scheme.secondary),
                    const SizedBox(width: 8),
                    Text('An diesem Tag', style: text.titleLarge),
                    const Spacer(),
                    IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.of(ctx).pop()),
                  ],
                ),
              ),
            ),
            for (final g in groups) ...[
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 14, 20, 8),
                  child: Row(
                    children: [
                      Text(g.label, style: text.titleMedium),
                      const SizedBox(width: 8),
                      Text(_formatDate(g.date), style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
                    ],
                  ),
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                sliver: SliverGrid(
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, mainAxisSpacing: 6, crossAxisSpacing: 6),
                  delegate: SliverChildBuilderDelegate((_, i) => _Thumb(item: g.items[i], onTap: () {
                        Navigator.of(ctx).pop();
                        context.push('/media/${g.items[i].id}');
                      }), childCount: g.items.length),
                ),
              ),
            ],
            const SliverToBoxAdapter(child: SizedBox(height: 24)),
          ],
        );
      },
    ),
  );
}

String _formatDate(String iso) {
  final parts = iso.split('-');
  return parts.length == 3 ? '${int.parse(parts[2])}.${int.parse(parts[1])}.${parts[0]}' : iso;
}

class _Thumb extends StatelessWidget {
  const _Thumb({required this.item, required this.onTap});
  final MediaItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final url = item.urls.thumb400;
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppTokens.radiusS),
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (url != null) Image.network(url, fit: BoxFit.cover) else ColoredBox(color: scheme.surfaceContainerHigh),
          if (item.isVideo)
            const Positioned(right: 6, bottom: 6, child: Icon(Icons.play_circle_fill, color: Colors.white, size: 22)),
          Material(color: Colors.transparent, child: InkWell(onTap: onTap)),
        ],
      ),
    );
  }
}
