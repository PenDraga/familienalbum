import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../widgets/user_avatar.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/api_exception.dart';
import '../../l10n/l10n.dart';
import '../../widgets/app_image.dart';
import 'activity_controller.dart';
import 'activity_models.dart';

/// Verlauf: wer hat wann hochgeladen oder kommentiert. Öffnen markiert alles als gesehen.
class ActivityScreen extends ConsumerStatefulWidget {
  const ActivityScreen({super.key});

  @override
  ConsumerState<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends ConsumerState<ActivityScreen> {
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 600) ref.read(feedProvider.notifier).loadMore();
    });
    // Frisch laden und als gesehen markieren – die Ungelesen-Punkte in der Liste bleiben für diesen Besuch sichtbar
    Future<void>.microtask(() async {
      await ref.read(feedProvider.notifier).refresh();
      await ref.read(feedProvider.notifier).markSeen();
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _open(FeedItem item) {
    final id = item.targetMediaId;
    if (id == null) return;
    context.go(item.type == FeedType.comment ? '/media/$id?comments=1' : '/media/$id');
  }

  @override
  Widget build(BuildContext context) {
    final feed = ref.watch(feedProvider);
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text(context.l10n.activityTitle),
        leading: BackButton(onPressed: () => context.canPop() ? context.pop() : context.go('/')),
      ),
      body: feed.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _Message(icon: Icons.cloud_off_outlined, text: errorMessage(e), onRetry: () => ref.invalidate(feedProvider)),
        data: (state) {
          if (state.items.isEmpty) {
            return _Message(icon: Icons.notifications_none_outlined, text: context.l10n.activityEmpty);
          }
          final sections = _groupByDay(context, state.items);
          return RefreshIndicator(
            onRefresh: () => ref.read(feedProvider.notifier).refresh(),
            child: ListView.builder(
              controller: _scroll,
              padding: const EdgeInsets.only(bottom: 32),
              itemCount: sections.length + 1,
              itemBuilder: (context, i) {
                if (i == sections.length) {
                  if (state.loadingMore) return const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()));
                  if (state.error != null) {
                    return Padding(
                      padding: const EdgeInsets.all(16),
                      child: Center(child: TextButton(onPressed: () => ref.read(feedProvider.notifier).loadMore(), child: Text(context.l10n.activityLoadMoreError(state.error!)))),
                    );
                  }
                  return const SizedBox(height: 8);
                }
                final (label, items) = sections[i];
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 20, 20, 6),
                      child: Text(label, style: Theme.of(context).textTheme.labelLarge?.copyWith(color: scheme.onSurfaceVariant)),
                    ),
                    for (final item in items) _FeedTile(item: item, onTap: () => _open(item)),
                  ],
                );
              },
            ),
          );
        },
      ),
    );
  }

  static List<(String, List<FeedItem>)> _groupByDay(BuildContext context, List<FeedItem> items) {
    final out = <(String, List<FeedItem>)>[];
    for (final item in items) {
      final label = dayLabel(context, item.at);
      if (out.isEmpty || out.last.$1 != label) {
        out.add((label, [item]));
      } else {
        out.last.$2.add(item);
      }
    }
    return out;
  }
}

/// „Heute“, „Gestern“, sonst „Montag, 1. September“ (mit Jahr, wenn nicht aktuell).
String dayLabel(BuildContext context, DateTime at) {
  final d = at.toLocal();
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(d.year, d.month, d.day);
  final diff = today.difference(day).inDays;
  if (diff == 0) return context.l10n.activityToday;
  if (diff == 1) return context.l10n.activityYesterday;
  final locale = context.localeTag;
  return (d.year == now.year ? DateFormat.MMMMEEEEd(locale) : DateFormat.yMMMMEEEEd(locale)).format(d);
}

class _FeedTile extends StatelessWidget {
  const _FeedTile({required this.item, required this.onTap});
  final FeedItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final l10n = context.l10n;
    final time = DateFormat.Hm(context.localeTag);
    final who = item.mine ? l10n.activityYou : item.actorName;
    final mine = item.mine ? 'true' : 'false';
    final isComment = item.type == FeedType.comment;

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _Avatar(name: item.actorName, avatarUrl: item.actorAvatarUrl, unread: item.unread),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(text: who, style: const TextStyle(fontWeight: FontWeight.w700)),
                        TextSpan(text: ' ${isComment ? l10n.activityCommented(mine) : l10n.activityAdded(mine, item.mediaLabel(l10n))}'),
                      ],
                    ),
                    style: text.bodyMedium,
                  ),
                  const SizedBox(height: 2),
                  Text(time.format(item.at.toLocal()), style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
                  const SizedBox(height: 8),
                  if (isComment)
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            decoration: BoxDecoration(
                              color: scheme.surfaceContainerHigh.withValues(alpha: 0.7),
                              borderRadius: const BorderRadius.only(
                                topLeft: Radius.circular(4),
                                topRight: Radius.circular(14),
                                bottomLeft: Radius.circular(14),
                                bottomRight: Radius.circular(14),
                              ),
                            ),
                            child: Text(item.commentBody ?? '', style: text.bodyMedium, maxLines: 4, overflow: TextOverflow.ellipsis),
                          ),
                        ),
                        const SizedBox(width: 10),
                        if (item.media.isNotEmpty) _Thumb(ref: item.media.first, size: 56),
                      ],
                    )
                  else
                    _PreviewStrip(item: item),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Bis zu vier Vorschauen einer Serie; die letzte zeigt „+n“, wenn es mehr gibt.
class _PreviewStrip extends StatelessWidget {
  const _PreviewStrip({required this.item});
  final FeedItem item;

  @override
  Widget build(BuildContext context) {
    final more = item.count - item.media.length;
    return LayoutBuilder(
      builder: (context, c) {
        final n = item.media.length;
        final size = ((c.maxWidth - (n - 1) * 6) / 4).clamp(48.0, 96.0);
        return Row(
          children: [
            for (var i = 0; i < n; i++) ...[
              if (i > 0) const SizedBox(width: 6),
              _Thumb(ref: item.media[i], size: size, overlay: i == n - 1 && more > 0 ? '+$more' : null),
            ],
          ],
        );
      },
    );
  }
}

class _Thumb extends StatelessWidget {
  const _Thumb({required this.ref, required this.size, this.overlay});
  final FeedMediaRef ref;
  final double size;
  final String? overlay;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: SizedBox(
        width: size,
        height: size,
        child: Stack(
          fit: StackFit.expand,
          children: [
            AppImage(url: ref.thumb400, fit: BoxFit.cover),
            if (ref.isVideo && overlay == null)
              const Align(alignment: Alignment.bottomRight, child: Padding(padding: EdgeInsets.all(4), child: Icon(Icons.play_circle_fill, color: Colors.white, size: 18))),
            if (overlay != null)
              Container(
                color: Colors.black54,
                alignment: Alignment.center,
                child: Text(overlay!, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16)),
              ),
          ],
        ),
      ),
    );
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.name, this.avatarUrl, required this.unread});
  final String name;
  final String? avatarUrl;
  final bool unread;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        UserAvatar(name: name, avatarUrl: avatarUrl, size: 40, color: scheme.secondary, foregroundColor: scheme.onSecondary),
        if (unread)
          Positioned(
            right: -2,
            top: -2,
            child: Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(color: scheme.primary, shape: BoxShape.circle, border: Border.all(color: scheme.surface, width: 2)),
            ),
          ),
      ],
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.icon, required this.text, this.onRetry});
  final IconData icon;
  final String text;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 56, color: scheme.onSurfaceVariant),
            const SizedBox(height: 16),
            Text(text, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: scheme.onSurfaceVariant)),
            if (onRetry != null) ...[const SizedBox(height: 16), FilledButton.tonal(onPressed: onRetry, child: Text(context.l10n.commonRetry))],
          ],
        ),
      ),
    );
  }
}
