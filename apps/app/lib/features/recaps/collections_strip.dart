import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../theme/app_theme.dart';
import '../auth/auth_models.dart';
import 'create_recap_dialog.dart';
import 'on_this_day_sheet.dart';
import 'recap_models.dart';
import 'recaps_repository.dart';

/// Waagrechte Leiste über der Timeline: «An diesem Tag», Rückblick-Videos, «Rückblick erstellen».
/// Zeigt nichts, wenn es weder Erinnerungen noch Rückblicke gibt und niemand welche erstellen darf.
class CollectionsStrip extends ConsumerWidget {
  const CollectionsStrip({super.key, required this.family});
  final Family family;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recaps = ref.watch(recapsProvider).value ?? const <RecapItem>[];
    final memories = ref.watch(onThisDayProvider).value ?? const <OnThisDayGroup>[];
    final canCreate = family.membership.canUpload;
    if (recaps.isEmpty && memories.isEmpty && !canCreate) return const SizedBox.shrink();

    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(top: 12, bottom: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Row(
              children: [
                Text('Sammlungen', style: text.titleMedium),
                if (memories.isNotEmpty) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(color: scheme.tertiaryContainer, borderRadius: BorderRadius.circular(999)),
                    child: Text('${memories.length}', style: text.labelMedium?.copyWith(color: scheme.onTertiaryContainer, fontWeight: FontWeight.w800)),
                  ),
                ],
              ],
            ),
          ),
          SizedBox(
            height: 150,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                if (memories.isNotEmpty) ...[
                  _MemoryCard(groups: memories, onTap: () => showOnThisDaySheet(context, memories)),
                  const SizedBox(width: 10),
                ],
                for (final r in recaps) ...[_RecapCard(recap: r), const SizedBox(width: 10)],
                if (canCreate) _CreateCard(onTap: () => showCreateRecapDialog(context, ref, family.id)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MemoryCard extends StatelessWidget {
  const _MemoryCard({required this.groups, required this.onTap});
  final List<OnThisDayGroup> groups;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final first = groups.first;
    final thumb = first.items.firstWhere((m) => m.urls.thumb400 != null, orElse: () => first.items.first).urls.thumb400;
    final count = groups.fold<int>(0, (n, g) => n + g.items.length);
    return _Card(
      onTap: onTap,
      background: thumb == null ? ColoredBox(color: scheme.secondaryContainer) : Image.network(thumb, fit: BoxFit.cover),
      badge: Icon(Icons.auto_awesome, color: scheme.onSecondary, size: 18),
      badgeColor: scheme.secondary,
      title: 'An diesem Tag',
      subtitle: count == 1 ? '${first.label} · 1 Foto' : '${first.label} · $count Medien',
      textStyle: text,
    );
  }
}

class _RecapCard extends ConsumerWidget {
  const _RecapCard({required this.recap});
  final RecapItem recap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final subtitle = recap.isReady
        ? '${recap.kind.label} · ${_duration(recap.durationSec)}'
        : recap.isFailed
        ? 'Fehlgeschlagen'
        : 'Wird erstellt …';
    return _Card(
      onTap: () => context.push('/recaps/${recap.id}'),
      background: recap.posterUrl != null
          ? Image.network(recap.posterUrl!, fit: BoxFit.cover)
          : ColoredBox(
              color: recap.isFailed ? scheme.errorContainer : scheme.primaryContainer,
              child: Center(
                child: recap.isReady || recap.isFailed
                    ? Icon(recap.isFailed ? Icons.error_outline : Icons.movie_outlined, color: scheme.onPrimaryContainer, size: 36)
                    : const SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 2.5)),
              ),
            ),
      badge: Icon(recap.isReady ? Icons.play_arrow_rounded : Icons.hourglass_top_rounded, color: scheme.onPrimary, size: 20),
      badgeColor: scheme.primary,
      title: recap.title,
      subtitle: subtitle,
      textStyle: text,
    );
  }

  static String _duration(double? s) {
    if (s == null) return '';
    final d = Duration(seconds: s.round());
    return '${d.inMinutes}:${(d.inSeconds % 60).toString().padLeft(2, '0')} min';
  }
}

class _CreateCard extends StatelessWidget {
  const _CreateCard({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    return SizedBox(
      width: 150,
      child: Material(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(AppTokens.radiusL),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppTokens.radiusL),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(color: scheme.tertiaryContainer, borderRadius: BorderRadius.circular(16)),
                  child: Icon(Icons.movie_creation_outlined, color: scheme.onTertiaryContainer),
                ),
                const SizedBox(height: 10),
                Text('Rückblick erstellen', textAlign: TextAlign.center, style: text.labelLarge),
                Text('Monat, Jahr oder Sekunden-Film', textAlign: TextAlign.center, style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.onTap, required this.background, required this.badge, required this.badgeColor, required this.title, required this.subtitle, required this.textStyle});
  final VoidCallback onTap;
  final Widget background;
  final Widget badge;
  final Color badgeColor;
  final String title;
  final String subtitle;
  final TextTheme textStyle;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 210,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTokens.radiusL),
        child: Stack(
          fit: StackFit.expand,
          children: [
            background,
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.transparent, Colors.black.withValues(alpha: 0.65)], stops: const [0.35, 1]),
              ),
            ),
            Positioned(
              left: 12,
              top: 12,
              child: Container(width: 34, height: 34, decoration: BoxDecoration(color: badgeColor, borderRadius: BorderRadius.circular(12)), child: Center(child: badge)),
            ),
            Positioned(
              left: 12,
              right: 12,
              bottom: 12,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: textStyle.titleMedium?.copyWith(color: Colors.white)),
                  Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: textStyle.bodySmall?.copyWith(color: Colors.white70)),
                ],
              ),
            ),
            Material(color: Colors.transparent, child: InkWell(onTap: onTap)),
          ],
        ),
      ),
    );
  }
}

/// Provider neu laden, z.B. nach Push «Rückblick fertig».
void refreshCollections(WidgetRef ref) {
  ref.invalidate(recapsProvider);
  ref.invalidate(onThisDayProvider);
}
