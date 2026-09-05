import 'dart:async';
import 'dart:ui';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:cached_network_image_platform_interface/cached_network_image_platform_interface.dart' show ImageRenderMethodForWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/glass.dart';
import '../auth/auth_controller.dart';
import '../auth/auth_models.dart';
import '../comments/comments_repository.dart';
import '../upload/upload_controller.dart';
import '../upload/upload_sheet.dart';
import 'justified_layout.dart';
import 'media_model.dart';
import 'timeline_controller.dart';

class TimelineScreen extends ConsumerStatefulWidget {
  const TimelineScreen({super.key});

  @override
  ConsumerState<TimelineScreen> createState() => _TimelineScreenState();
}

class _TimelineScreenState extends ConsumerState<TimelineScreen> {
  final _scroll = ScrollController();
  Timer? _poll;
  Timer? _activity;
  DateTime _since = DateTime.now();

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    // Web/Windows haben keinen Push: jede Minute nachfragen, ob es Neues von anderen gibt.
    _activity = Timer.periodic(const Duration(seconds: 60), (_) => _checkActivity());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _activity?.cancel();
    _scroll.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 800) {
      ref.read(timelineControllerProvider.notifier).loadMore();
    }
  }

  Future<void> _checkActivity() async {
    final family = ref.read(selectedFamilyProvider);
    if (family == null) return;
    try {
      final a = await ref.read(commentsRepositoryProvider).activity(family.id, _since);
      _since = a.serverTime;
      if (!a.hasNews || !mounted) return;
      await ref.read(timelineControllerProvider.notifier).refresh();
      final parts = <String>[
        if (a.newMedia > 0) a.newMedia == 1 ? '1 neues Medium' : '${a.newMedia} neue Medien',
        if (a.newComments > 0) a.newComments == 1 ? '1 neuer Kommentar' : '${a.newComments} neue Kommentare',
      ];
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(parts.join(' · '))));
    } catch (_) {
      // Netzwerkfehler beim Polling still ignorieren
    }
  }

  /// Solange Medien in Verarbeitung sind, alle 5 s nachladen.
  void _syncPolling(TimelineState? state) {
    final needed = state?.hasProcessing ?? false;
    if (needed && _poll == null) {
      _poll = Timer.periodic(const Duration(seconds: 5), (_) => ref.read(timelineControllerProvider.notifier).refresh());
    } else if (!needed && _poll != null) {
      _poll!.cancel();
      _poll = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(meProvider);
    final family = ref.watch(selectedFamilyProvider);
    final timeline = ref.watch(timelineControllerProvider);
    _syncPolling(timeline.whenOrNull(data: (s) => s));

    ref.listen(uploadControllerProvider, (prev, next) {
      final before = prev?.where((t) => t.status == UploadStatus.done).length ?? 0;
      final after = next.where((t) => t.status == UploadStatus.done).length;
      if (after > before) ref.read(timelineControllerProvider.notifier).refresh();
    });

    if (me == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));

    final actions = <Widget>[
      if (family?.membership.isFamilyAdmin ?? false)
        GlassIconButton(icon: Icons.person_add_alt_1_outlined, tooltip: 'Einladen', onPressed: () => _showInviteDialog(context, family!)),
      const SizedBox(width: 8),
      GlassIconButton(icon: Icons.settings_outlined, tooltip: 'Einstellungen', onPressed: () => context.go('/settings')),
      const SizedBox(width: 12),
    ];

    if (family == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Familienalbum'), actions: actions),
        body: const EmptyHint(
          icon: Icons.family_restroom,
          title: 'Noch keine Familie',
          text: 'Du bist noch in keiner Familie. Löse einen Einladungscode ein oder bitte einen Admin, dich hinzuzufügen.',
        ),
      );
    }

    return Scaffold(
      extendBodyBehindAppBar: true,
      floatingActionButton: family.membership.canUpload
          ? _GlassFab(onPressed: () => pickAndUpload(context, ref, family.id))
          : null,
      body: timeline.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _ErrorView(message: errorMessage(e), onRetry: () => ref.invalidate(timelineControllerProvider)),
        data: (state) => RefreshIndicator(
          edgeOffset: 120,
          onRefresh: () => ref.read(timelineControllerProvider.notifier).refresh(),
          child: _ImmersiveTimeline(state: state, family: family, me: me, actions: actions, controller: _scroll),
        ),
      ),
    );
  }

  Future<void> _showInviteDialog(BuildContext context, Family family) async {
    var canUpload = true;
    var canDownload = false;
    Map<String, dynamic>? invite;
    String? error;

    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: Text(invite == null ? 'Einladung erstellen' : 'Einladungscode'),
          content: SizedBox(
            width: 380,
            child: invite == null
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('Wer den Code einlöst, wird Mitglied von „${family.name}“.', style: Theme.of(ctx).textTheme.bodyMedium),
                      const SizedBox(height: 12),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Darf hochladen'),
                        value: canUpload,
                        onChanged: (v) => setState(() => canUpload = v),
                      ),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Darf Originale herunterladen'),
                        value: canDownload,
                        onChanged: (v) => setState(() => canDownload = v),
                      ),
                      if (error != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(error!, style: TextStyle(color: Theme.of(ctx).colorScheme.error)),
                        ),
                    ],
                  )
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(vertical: 18),
                        decoration: BoxDecoration(
                          color: Theme.of(ctx).colorScheme.primaryContainer.withValues(alpha: 0.6),
                          borderRadius: BorderRadius.circular(AppTokens.radiusM),
                        ),
                        child: SelectableText(
                          invite!['code'] as String,
                          textAlign: TextAlign.center,
                          style: Theme.of(ctx).textTheme.headlineMedium?.copyWith(letterSpacing: 4),
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        '7 Tage gültig, eine Nutzung. Die Person gibt den Code in der App unter „Ich habe einen Einladungscode“ ein.',
                        style: Theme.of(ctx).textTheme.bodySmall,
                      ),
                    ],
                  ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Schliessen')),
            if (invite == null)
              FilledButton(
                onPressed: () async {
                  try {
                    final res = await ref.read(timelineRepositoryProvider).createInvite(family.id, canUpload: canUpload, canDownload: canDownload);
                    setState(() => invite = res);
                  } catch (e) {
                    setState(() => error = errorMessage(e));
                  }
                },
                child: const Text('Erstellen'),
              )
            else
              FilledButton.icon(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: invite!['code'] as String));
                  Navigator.of(ctx).pop();
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Code kopiert')));
                },
                icon: const Icon(Icons.copy),
                label: const Text('Kopieren'),
              ),
          ],
        ),
      ),
    );
  }
}

/// Hero-Kopf mit dem neusten Foto, darunter Monatsabschnitte als bündiges Mosaik.
class _ImmersiveTimeline extends ConsumerWidget {
  const _ImmersiveTimeline({required this.state, required this.family, required this.me, required this.actions, required this.controller});

  final TimelineState state;
  final Family family;
  final Me me;
  final List<Widget> actions;
  final ScrollController controller;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final width = MediaQuery.sizeOf(context).width;
    final heroHeight = (MediaQuery.sizeOf(context).height * 0.42).clamp(240.0, 440.0);
    final newest = state.items.where((m) => m.isReady && m.urls.thumb1600 != null).firstOrNull;
    final monthFormat = DateFormat.yMMMM('de_CH');
    final targetHeight = targetRowHeightFor(width);
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return CustomScrollView(
      controller: controller,
      physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
      slivers: [
        SliverAppBar(
          pinned: true,
          stretch: true,
          expandedHeight: heroHeight,
          automaticallyImplyLeading: false,
          backgroundColor: Colors.transparent,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          titleSpacing: 16,
          title: _CollapsedTitle(me: me, family: family),
          actions: actions,
          flexibleSpace: _HeroHeader(
            family: family,
            newest: newest,
            count: state.items.length,
            hasMore: state.hasMore,
            oldestMonth: state.items.isEmpty ? null : state.items.last.monthKey,
          ),
        ),
        if (state.items.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyHint(
              icon: Icons.photo_outlined,
              title: 'Noch keine Fotos',
              text: family.membership.canUpload
                  ? 'Lade das erste Foto oder Video hoch – es erscheint hier nach Aufnahmedatum sortiert.'
                  : 'Sobald jemand aus der Familie etwas hochlädt, erscheint es hier.',
            ),
          ),
        for (final (month, items) in state.groups)
          SliverMainAxisGroup(
            slivers: [
              SliverPersistentHeader(
                pinned: true,
                delegate: _MonthHeaderDelegate(
                  label: monthFormat.format(DateTime.utc(int.parse(month.substring(0, 4)), int.parse(month.substring(5)))),
                  count: items.length,
                ),
              ),
              _MosaicSliver(rows: computeJustifiedRows(items, width: width, targetHeight: targetHeight)),
            ],
          ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 28, 16, 120),
            child: Center(
              child: state.loadingMore
                  ? const SizedBox(height: 24, width: 24, child: CircularProgressIndicator(strokeWidth: 2.5))
                  : state.loadMoreError != null
                  ? Text(state.loadMoreError!, style: TextStyle(color: scheme.error))
                  : state.hasMore || state.items.isEmpty
                  ? const SizedBox.shrink()
                  : Text('${state.items.length} Medien', style: text.bodySmall?.copyWith(color: scheme.outline)),
            ),
          ),
        ),
      ],
    );
  }
}

class _CollapsedTitle extends ConsumerWidget {
  const _CollapsedTitle({required this.me, required this.family});
  final Me me;
  final Family family;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = context.dependOnInheritedWidgetOfExactType<FlexibleSpaceBarSettings>();
    final t = settings == null ? 1.0 : (1 - (settings.currentExtent - settings.minExtent) / (settings.maxExtent - settings.minExtent)).clamp(0.0, 1.0);
    final child = me.families.length == 1
        ? Text(family.name)
        : PopupMenuButton<String>(
            tooltip: 'Familie wechseln',
            onSelected: (id) => ref.read(settingsProvider.notifier).selectFamily(id),
            itemBuilder: (_) => [
              for (final f in me.families)
                PopupMenuItem(
                  value: f.id,
                  child: Row(
                    children: [
                      SizedBox(width: 18, child: f.id == family.id ? const Icon(Icons.check, size: 18) : null),
                      const SizedBox(width: 8),
                      Text(f.name),
                    ],
                  ),
                ),
            ],
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [Flexible(child: Text(family.name, overflow: TextOverflow.ellipsis)), const Icon(Icons.expand_more)],
            ),
          );
    // Erst einblenden, wenn der grosse Titel im Hero praktisch weg ist
    final o = ((t - 0.65) / 0.35).clamp(0.0, 1.0);
    return IgnorePointer(ignoring: o < 0.5, child: Opacity(opacity: o, child: child));
  }
}

/// Hintergrund des SliverAppBar: neustes Foto mit Verlauf, beim Einklappen zu Milchglas.
class _HeroHeader extends StatelessWidget {
  const _HeroHeader({required this.family, required this.newest, required this.count, required this.hasMore, required this.oldestMonth});

  final Family family;
  final MediaItem? newest;
  final int count;
  final bool hasMore;
  final String? oldestMonth;

  @override
  Widget build(BuildContext context) {
    final settings = context.dependOnInheritedWidgetOfExactType<FlexibleSpaceBarSettings>()!;
    final range = settings.maxExtent - settings.minExtent;
    final t = range <= 0 ? 1.0 : (1 - (settings.currentExtent - settings.minExtent) / range).clamp(0.0, 1.0);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final blur = Curves.easeIn.transform(t) * 24;
    final fmt = DateFormat.yMMM('de_CH');
    final subtitle = [
      count == 1 ? '1 Medium' : '$count${hasMore ? '+' : ''} Medien',
      if (oldestMonth != null) 'seit ${fmt.format(DateTime.utc(int.parse(oldestMonth!.substring(0, 4)), int.parse(oldestMonth!.substring(5))))}',
    ].join(' · ');

    return ClipRect(
      child: Stack(
        fit: StackFit.expand,
        children: [
          // Foto mit leichtem Parallax (bewegt sich langsamer als der Inhalt)
          if (newest != null)
            Transform.translate(
              offset: Offset(0, -t * 40),
              child: Transform.scale(
                scale: 1 + (1 - t) * 0.04 + (settings.currentExtent > settings.maxExtent ? (settings.currentExtent / settings.maxExtent - 1) : 0),
                child: CachedNetworkImage(
                  imageRenderMethodForWeb: ImageRenderMethodForWeb.HttpGet,
                  imageUrl: newest!.urls.thumb1600!,
                  fit: BoxFit.cover,
                  alignment: Alignment.center,
                  fadeInDuration: const Duration(milliseconds: 300),
                  placeholder: (_, _) => Container(color: scheme.surfaceContainerHigh),
                  errorWidget: (_, _, _) => Container(color: scheme.surfaceContainerHigh),
                ),
              ),
            )
          else
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [scheme.primaryContainer, scheme.surface]),
              ),
            ),
          // Verlauf, damit Titel und Buttons lesbar sind
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                stops: const [0, 0.35, 0.7, 1],
                colors: [Colors.black.withValues(alpha: 0.35), Colors.transparent, Colors.transparent, Colors.black.withValues(alpha: 0.55)],
              ),
            ),
          ),
          // Beim Einklappen: Milchglas
          if (t > 0.02)
            BackdropFilter(
              filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
              child: DecoratedBox(
                decoration: BoxDecoration(color: scheme.surface.withValues(alpha: t * (isDark ? 0.6 : 0.68))),
              ),
            ),
          // Grosser Titel unten links, blendet beim Einklappen aus
          Positioned(
            left: 20,
            right: 20,
            bottom: 18,
            child: Opacity(
              opacity: (1 - t * 1.6).clamp(0.0, 1.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    family.name,
                    style: text.headlineMedium?.copyWith(color: Colors.white, shadows: const [Shadow(blurRadius: 12, color: Colors.black45)]),
                  ),
                  const SizedBox(height: 4),
                  Text(subtitle, style: text.bodyMedium?.copyWith(color: Colors.white.withValues(alpha: 0.85))),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Angehefteter Monatskopf als Glas-Pille; hängt unter der eingeklappten App-Leiste.
class _MonthHeaderDelegate extends SliverPersistentHeaderDelegate {
  _MonthHeaderDelegate({required this.label, required this.count});
  final String label;
  final int count;

  @override
  double get minExtent => 52;
  @override
  double get maxExtent => 52;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    return Align(
      alignment: Alignment.centerLeft,
      child: Padding(
        padding: const EdgeInsets.only(left: 10, top: 6, bottom: 6),
        child: GlassPill(
          padding: const EdgeInsets.fromLTRB(14, 7, 12, 7),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(label, style: text.titleMedium?.copyWith(color: scheme.onSurface)),
              const SizedBox(width: 8),
              Text('$count', style: text.labelMedium?.copyWith(color: scheme.onSurfaceVariant)),
            ],
          ),
        ),
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _MonthHeaderDelegate old) => old.label != label || old.count != count;
}

class _MosaicSliver extends StatelessWidget {
  const _MosaicSliver({required this.rows});
  final List<JustifiedRow> rows;

  @override
  Widget build(BuildContext context) {
    return SliverList.builder(
      itemCount: rows.length,
      itemBuilder: (_, i) {
        final row = rows[i];
        return Padding(
          padding: const EdgeInsets.only(bottom: 2),
          child: SizedBox(
            height: row.height,
            child: Row(
              children: [
                for (var c = 0; c < row.cells.length; c++) ...[
                  if (c > 0) const SizedBox(width: 2),
                  SizedBox(width: row.cells[c].width, child: MediaTile(item: row.cells[c].item)),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

class MediaTile extends StatelessWidget {
  const MediaTile({super.key, required this.item});
  final MediaItem item;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surfaceContainerHigh,
      child: InkWell(
        onTap: item.isReady ? () => context.go('/media/${item.id}') : null,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (item.urls.thumb400 != null)
              Hero(
                tag: 'media-${item.id}',
                child: CachedNetworkImage(
                  imageRenderMethodForWeb: ImageRenderMethodForWeb.HttpGet,
                  imageUrl: item.urls.thumb400!,
                  fit: BoxFit.cover,
                  fadeInDuration: const Duration(milliseconds: 200),
                  placeholder: (_, _) => const SizedBox.shrink(),
                  errorWidget: (_, _, _) => Icon(Icons.broken_image_outlined, color: scheme.outline),
                ),
              )
            else
              _PendingTile(item: item),
            if (item.commentCount > 0)
              Positioned(
                left: 6,
                bottom: 6,
                child: _Badge(icon: Icons.chat_bubble, text: '${item.commentCount}'),
              ),
            if (item.isVideo)
              Positioned(
                right: 6,
                bottom: 6,
                child: _Badge(icon: Icons.play_arrow_rounded, text: item.durationSec != null ? formatDuration(item.durationSec!) : null),
              ),
          ],
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.icon, this.text});
  final IconData icon;
  final String? text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(8)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: Colors.white),
          if (text != null) ...[
            const SizedBox(width: 2),
            Text(text!, style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600)),
          ],
        ],
      ),
    );
  }
}

class _PendingTile extends StatelessWidget {
  const _PendingTile({required this.item});
  final MediaItem item;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final failed = item.status == MediaStatus.failed;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (failed)
            Icon(Icons.error_outline, color: scheme.error)
          else
            const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)),
          const SizedBox(height: 8),
          Text(
            failed ? 'Fehlgeschlagen' : 'Wird verarbeitet',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: failed ? scheme.error : scheme.onSurfaceVariant),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

/// Glas-FAB unten rechts.
class _GlassFab extends StatelessWidget {
  const _GlassFab({required this.onPressed});
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Glass(
      blur: 18,
      borderRadius: BorderRadius.circular(999),
      tint: scheme.primary.withValues(alpha: 0.88),
      child: SizedBox(
        height: 54,
        child: TextButton.icon(
          onPressed: onPressed,
          style: TextButton.styleFrom(
            foregroundColor: scheme.onPrimary,
            padding: const EdgeInsets.symmetric(horizontal: 20),
            shape: const StadiumBorder(),
          ),
          icon: const Icon(Icons.add_photo_alternate_outlined),
          label: const Text('Hochladen'),
        ),
      ),
    );
  }
}

String formatDuration(double seconds) {
  final d = Duration(seconds: seconds.round());
  final m = d.inMinutes.remainder(60).toString();
  final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
  return d.inHours > 0 ? '${d.inHours}:${m.padLeft(2, '0')}:$s' : '$m:$s';
}

class EmptyHint extends StatelessWidget {
  const EmptyHint({super.key, required this.icon, required this.title, required this.text});
  final IconData icon;
  final String title;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(32),
      children: [
        const SizedBox(height: 60),
        Center(
          child: Container(
            width: 96,
            height: 96,
            decoration: BoxDecoration(color: theme.colorScheme.primaryContainer.withValues(alpha: 0.6), shape: BoxShape.circle),
            child: Icon(icon, size: 44, color: theme.colorScheme.primary),
          ),
        ),
        const SizedBox(height: 20),
        Text(title, textAlign: TextAlign.center, style: theme.textTheme.titleLarge),
        const SizedBox(height: 8),
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 360),
            child: Text(text, textAlign: TextAlign.center, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ),
        ),
      ],
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off_outlined, size: 56, color: Theme.of(context).colorScheme.error),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton.tonal(onPressed: onRetry, child: const Text('Nochmals versuchen')),
          ],
        ),
      ),
    );
  }
}
