import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:video_player/video_player.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../../widgets/app_image.dart';
import '../../widgets/glass.dart';
import '../comments/comments_sheet.dart';
import '../timeline/media_model.dart';
import '../timeline/timeline_controller.dart';
import '../timeline/timeline_screen.dart' show formatDuration;
import 'media_info_sheet.dart';
import 'original/original_saver.dart';
import 'taken_at_dialog.dart';

/// Vollbild-Ansicht: Wischen zwischen Medien, Zoom, Wischen nach unten zum Schliessen,
/// Glas-Leisten oben und unten, Hero-Übergang von der Kachel.
class MediaDetailScreen extends ConsumerStatefulWidget {
  const MediaDetailScreen({super.key, required this.mediaId, this.openComments = false});
  final String mediaId;
  /// Kommentar-Blatt sofort öffnen (Link aus dem Aktivitäts-Verlauf)
  final bool openComments;

  @override
  ConsumerState<MediaDetailScreen> createState() => _MediaDetailScreenState();
}

class _MediaDetailScreenState extends ConsumerState<MediaDetailScreen> {
  PageController? _pager;
  int _index = 0;
  String? _currentId; // bleibt stabil, auch wenn die Timeline umsortiert wird (Datum geändert)
  bool _chromeVisible = true;
  bool _zoomed = false;
  MediaItem? _single; // Deep-Link ohne geladene Timeline
  final Map<String, double?> _downloading = {}; // Original-Download: Fortschritt je Medium
  late bool _pendingComments = widget.openComments;

  List<MediaItem> _items(TimelineState? s) {
    final ready = s?.items.where((m) => m.isReady).toList() ?? const <MediaItem>[];
    if (ready.any((m) => m.id == widget.mediaId)) return ready;
    return _single != null ? [_single!] : ready;
  }

  @override
  void initState() {
    super.initState();
    final items = _items(ref.read(timelineControllerProvider).whenOrNull(data: (s) => s));
    final idx = items.indexWhere((m) => m.id == widget.mediaId);
    _currentId = widget.mediaId;
    if (idx >= 0) {
      _index = idx;
    } else {
      ref
          .read(timelineRepositoryProvider)
          .get(widget.mediaId)
          .then((m) {
            if (mounted) setState(() => _single = m);
          })
          .catchError((Object e) {
            if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(e))));
          });
    }
    _pager = PageController(initialPage: _index);
  }

  @override
  void dispose() {
    _pager?.dispose();
    super.dispose();
  }

  DateTime _lastWheel = DateTime.fromMillisecondsSinceEpoch(0);

  void _goTo(int delta, int count) {
    final target = (_index + delta).clamp(0, count - 1);
    if (target == _index) return;
    _pager?.animateToPage(target, duration: const Duration(milliseconds: 260), curve: Curves.easeOutCubic);
  }

  /// Desktop: Pfeiltasten blättern, Escape schliesst.
  KeyEventResult _onKey(FocusNode node, KeyEvent event, int count) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    if (event.logicalKey == LogicalKeyboardKey.arrowRight || event.logicalKey == LogicalKeyboardKey.pageDown) {
      _goTo(1, count);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowLeft || event.logicalKey == LogicalKeyboardKey.pageUp) {
      _goTo(-1, count);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.escape) {
      _close();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  /// Mausrad / Trackpad: ein Schritt pro Geste (entprellt), nicht wenn gezoomt.
  void _onPointerSignal(PointerSignalEvent e, int count) {
    if (e is! PointerScrollEvent || _zoomed) return;
    final now = DateTime.now();
    if (now.difference(_lastWheel).inMilliseconds < 350) return;
    final delta = e.scrollDelta.dx.abs() > e.scrollDelta.dy.abs() ? e.scrollDelta.dx : e.scrollDelta.dy;
    if (delta.abs() < 4) return;
    _lastWheel = now;
    _goTo(delta > 0 ? 1 : -1, count);
  }

  void _close() {
    if (context.canPop()) {
      context.pop();
    } else {
      context.go('/');
    }
  }

  Future<void> _openComments(MediaItem item) async {
    final count = await showCommentsSheet(context, item);
    if (count == null || !mounted) return;
    await _reload(item.id);
  }

  Future<void> _reload(String id) async {
    try {
      final updated = await ref.read(timelineRepositoryProvider).get(id);
      ref.read(timelineControllerProvider.notifier).replaceItem(updated);
      if (_single != null && mounted) setState(() => _single = updated);
    } catch (_) {
      // beim nächsten Laden aktualisiert
    }
  }

  /// Original in der App laden und dann sichern/teilen – ohne Browser-Wechsel.
  Future<void> _saveOriginal(MediaItem item) async {
    final url = item.urls.original;
    if (url == null || _downloading.containsKey(item.id)) return;
    setState(() => _downloading[item.id] = 0);
    final messenger = ScaffoldMessenger.of(context);
    PreparedOriginal? prepared;
    try {
      prepared = await prepareOriginal(
        ref.read(apiClientProvider).dio,
        url: url,
        fileName: item.originalName,
        mimeType: item.mimeType,
        isVideo: item.isVideo,
        onProgress: (f) {
          if (mounted) setState(() => _downloading[item.id] = f);
        },
      );
      if (!mounted) return;
      setState(() => _downloading.remove(item.id));

      final actions = <_OriginalAction>[
        if (prepared.canSaveToPhotos) const _OriginalAction(Icons.photo_library_outlined, 'In Fotos sichern', _OriginalActionKind.photos),
        if (prepared.canShare) const _OriginalAction(Icons.ios_share, 'Teilen …', _OriginalActionKind.share),
        if (prepared.canDownload) const _OriginalAction(Icons.download_outlined, 'Als Datei herunterladen', _OriginalActionKind.download),
      ];
      // Nur eine Möglichkeit (Desktop-Browser): direkt ausführen, sonst fragen.
      // Das Teilen-Blatt im Browser braucht eine frische Nutzergeste, deshalb erst nach dem Download fragen.
      final choice = actions.length == 1 ? actions.single.kind : await _askOriginalAction(item, actions);
      if (choice == null) return;
      switch (choice) {
        case _OriginalActionKind.photos:
          await prepared.saveToPhotos();
          messenger.showSnackBar(const SnackBar(content: Text('In Fotos gesichert')));
        case _OriginalActionKind.share:
          await prepared.share();
        case _OriginalActionKind.download:
          await prepared.download();
          messenger.showSnackBar(SnackBar(content: Text('„${item.originalName}“ heruntergeladen')));
      }
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e is OriginalSaveException ? e.message : errorMessage(e))));
    } finally {
      if (mounted) setState(() => _downloading.remove(item.id));
      await prepared?.dispose();
    }
  }

  Future<_OriginalActionKind?> _askOriginalAction(MediaItem item, List<_OriginalAction> actions) {
    return showModalBottomSheet<_OriginalActionKind>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
              child: Row(
                children: [
                  Icon(item.isVideo ? Icons.movie_outlined : Icons.image_outlined, color: Theme.of(ctx).colorScheme.primary),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Original bereit', style: Theme.of(ctx).textTheme.titleMedium),
                        Text(
                          '${item.originalName} · ${formatBytes(item.sizeBytes)}',
                          style: Theme.of(ctx).textTheme.bodySmall?.copyWith(color: Theme.of(ctx).colorScheme.onSurfaceVariant),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            for (final a in actions)
              ListTile(leading: Icon(a.icon), title: Text(a.label), onTap: () => Navigator.pop(ctx, a.kind)),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Future<void> _showInfo(MediaItem item) async {
    final updated = await showMediaInfoSheet(context, item);
    if (updated != null && _single != null && mounted) setState(() => _single = updated);
  }

  Future<void> _editDate(MediaItem item) async {
    final change = await showTakenAtDialog(context, samples: [item.takenAt]);
    if (change == null || !mounted) return;
    try {
      final updated = await ref.read(timelineRepositoryProvider).updateTakenAt(item.id, change.apply(item.takenAt));
      ref.read(timelineControllerProvider.notifier).replaceItem(updated);
      if (_single != null) setState(() => _single = updated);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(e))));
    }
  }

  Future<void> _editCaption(MediaItem item) async {
    final controller = TextEditingController(text: item.caption ?? '');
    final result = await showDialog<String?>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Beschreibung'),
        content: TextField(
          controller: controller,
          maxLines: 3,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'Was ist hier zu sehen?'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Abbrechen')),
          FilledButton(onPressed: () => Navigator.pop(ctx, controller.text), child: const Text('Speichern')),
        ],
      ),
    );
    if (result == null) return;
    try {
      final updated = await ref.read(timelineRepositoryProvider).updateCaption(item.id, result.trim().isEmpty ? null : result.trim());
      ref.read(timelineControllerProvider.notifier).replaceItem(updated);
      if (_single != null) setState(() => _single = updated);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(e))));
    }
  }

  Future<void> _delete(MediaItem item) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Löschen?'),
        content: Text('„${item.originalName}“ wird aus dem Album entfernt.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Abbrechen')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Löschen'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(timelineRepositoryProvider).delete(item.id);
      ref.read(timelineControllerProvider.notifier).removeItem(item.id);
      if (mounted) _close();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items(ref.watch(timelineControllerProvider).whenOrNull(data: (s) => s));
    if (items.isEmpty) {
      return Scaffold(
        backgroundColor: Colors.black,
        body: Center(child: CircularProgressIndicator(color: Colors.white.withValues(alpha: 0.7))),
      );
    }
    var index = _index.clamp(0, items.length - 1);
    // Nach einer Datumsänderung kann das Medium an anderer Stelle liegen: Position nachführen
    final byId = _currentId == null ? -1 : items.indexWhere((m) => m.id == _currentId);
    if (byId >= 0 && byId != index) {
      index = byId;
      _index = byId;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _pager?.hasClients == true && _pager!.page?.round() != byId) _pager!.jumpToPage(byId);
      });
    }
    final item = items[index];
    if (_pendingComments && item.id == widget.mediaId) {
      _pendingComments = false;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _openComments(item);
      });
    }
    final dateFormat = DateFormat.yMMMMEEEEd('de_CH');
    final timeFormat = DateFormat.Hm('de_CH');
    final padding = MediaQuery.paddingOf(context);

    final wide = MediaQuery.sizeOf(context).width >= 700;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Focus(
        autofocus: true,
        onKeyEvent: (node, event) => _onKey(node, event, items.length),
        child: _SwipeToDismiss(
          enabled: !_zoomed,
          onDismiss: _close,
          child: Stack(
            children: [
              Positioned.fill(
                child: Listener(
                  onPointerSignal: (e) => _onPointerSignal(e, items.length),
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () => setState(() => _chromeVisible = !_chromeVisible),
                    // Auch mit der Maus blättern (Flutter Web lässt standardmässig nur Touch zu)
                    child: ScrollConfiguration(
                      behavior: ScrollConfiguration.of(context).copyWith(
                        dragDevices: {
                          PointerDeviceKind.touch,
                          PointerDeviceKind.mouse,
                          PointerDeviceKind.trackpad,
                          PointerDeviceKind.stylus,
                        },
                        scrollbars: false,
                        overscroll: false,
                      ),
                      child: PageView.builder(
                        controller: _pager,
                        physics: _zoomed ? const NeverScrollableScrollPhysics() : const PageScrollPhysics(),
                        itemCount: items.length,
                        onPageChanged: (i) => setState(() {
                          _index = i;
                          _currentId = i < items.length ? items[i].id : _currentId;
                          _zoomed = false;
                        }),
                        itemBuilder: (_, i) => items[i].isVideo
                            ? _VideoView(item: items[i], active: i == index)
                            : _PhotoView(
                                item: items[i],
                                hero: i == index,
                                onZoomChanged: (z) {
                                  if (i == index && z != _zoomed) setState(() => _zoomed = z);
                                },
                              ),
                      ),
                    ),
                  ),
                ),
              ),
              // Pfeile für Maus-Nutzer auf breiten Bildschirmen
              if (wide && _chromeVisible && index > 0)
                Positioned(
                  left: 16,
                  top: 0,
                  bottom: 0,
                  child: Center(
                    child: GlassIconButton(
                      icon: Icons.chevron_left,
                      dark: true,
                      tooltip: 'Vorheriges',
                      onPressed: () => _goTo(-1, items.length),
                    ),
                  ),
                ),
              if (wide && _chromeVisible && index < items.length - 1)
                Positioned(
                  right: 16,
                  top: 0,
                  bottom: 0,
                  child: Center(
                    child: GlassIconButton(
                      icon: Icons.chevron_right,
                      dark: true,
                      tooltip: 'Nächstes',
                      onPressed: () => _goTo(1, items.length),
                    ),
                  ),
                ),
              // Obere Glas-Leiste
              AnimatedPositioned(
                duration: const Duration(milliseconds: 220),
                curve: Curves.easeOutCubic,
                top: _chromeVisible ? 0 : -(padding.top + 72),
                left: 0,
                right: 0,
                child: Glass(
                  blur: 20,
                  tint: Colors.black.withValues(alpha: 0.35),
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(8, padding.top + 8, 8, 10),
                    child: Row(
                      children: [
                        GlassIconButton(icon: Icons.arrow_back, dark: true, tooltip: 'Zurück', onPressed: _close),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                dateFormat.format(item.takenAt.toLocal()),
                                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 15),
                                overflow: TextOverflow.ellipsis,
                              ),
                              Text(
                                '${timeFormat.format(item.takenAt.toLocal())} · ${item.uploaderName}',
                                style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 12),
                              ),
                            ],
                          ),
                        ),
                        if (item.canEdit)
                          PopupMenuButton<String>(
                            iconColor: Colors.white,
                            onSelected: (v) => switch (v) {
                              'caption' => _editCaption(item),
                              'date' => _editDate(item),
                              _ => _delete(item),
                            },
                            itemBuilder: (_) => const [
                              PopupMenuItem(value: 'caption', child: ListTile(leading: Icon(Icons.notes), title: Text('Beschreibung bearbeiten'))),
                              PopupMenuItem(value: 'date', child: ListTile(leading: Icon(Icons.edit_calendar_outlined), title: Text('Datum und Uhrzeit ändern'))),
                              PopupMenuItem(value: 'delete', child: ListTile(leading: Icon(Icons.delete_outline), title: Text('Löschen'))),
                            ],
                          ),
                      ],
                    ),
                  ),
                ),
              ),
              // Untere Glas-Leiste mit Beschreibung und Aktionen
              AnimatedPositioned(
                duration: const Duration(milliseconds: 220),
                curve: Curves.easeOutCubic,
                bottom: _chromeVisible ? 0 : -(padding.bottom + 160),
                left: 0,
                right: 0,
                child: Glass(
                  blur: 20,
                  tint: Colors.black.withValues(alpha: 0.4),
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(16, 12, 16, padding.bottom + 12),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (item.caption != null && item.caption!.isNotEmpty) ...[
                          Text(
                            item.caption!,
                            style: const TextStyle(color: Colors.white, fontSize: 15, height: 1.35),
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 10),
                        ],
                        Row(
                          children: [
                            _BarButton(
                              icon: Icons.chat_bubble_outline,
                              label: item.commentCount == 0 ? 'Kommentieren' : commentLabel(item.commentCount),
                              onTap: () => _openComments(item),
                            ),
                            const SizedBox(width: 14),
                            _BarButton(icon: Icons.info_outline, label: 'Info', onTap: () => _showInfo(item)),
                            const SizedBox(width: 14),
                            if (item.urls.original != null)
                              _BarButton(
                                icon: Icons.download_outlined,
                                label: _downloading.containsKey(item.id)
                                    ? (_downloading[item.id] == null ? 'Lädt …' : '${(_downloading[item.id]! * 100).round()} %')
                                    : 'Original',
                                progress: _downloading.containsKey(item.id) ? _downloading[item.id] : null,
                                busy: _downloading.containsKey(item.id),
                                onTap: () => _saveOriginal(item),
                              ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                [
                                  if (item.width != null) '${item.width}×${item.height}',
                                  if (item.durationSec != null) formatDuration(item.durationSec!),
                                  '${index + 1}/${items.length}',
                                ].join(' · '),
                                textAlign: TextAlign.right,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 12),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String commentLabel(int count) {
  if (count == 0) return 'Kommentieren';
  return count == 1 ? '1 Kommentar' : '$count Kommentare';
}

enum _OriginalActionKind { photos, share, download }

class _OriginalAction {
  const _OriginalAction(this.icon, this.label, this.kind);
  final IconData icon;
  final String label;
  final _OriginalActionKind kind;
}

class _BarButton extends StatelessWidget {
  const _BarButton({required this.icon, required this.label, required this.onTap, this.progress, this.busy = false});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  /// Fortschritt 0..1 (null bei [busy] = unbestimmt)
  final double? progress;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: busy ? null : onTap,
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (busy)
              SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(value: progress, strokeWidth: 2.5, color: Colors.white, backgroundColor: Colors.white24),
              )
            else
              Icon(icon, color: Colors.white, size: 22),
            const SizedBox(width: 6),
            Text(
              label,
              style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ),
    );
  }
}

/// Nach unten wischen → Bild folgt dem Finger, Hintergrund wird durchsichtig, ab Schwelle schliessen.
class _SwipeToDismiss extends StatefulWidget {
  const _SwipeToDismiss({required this.child, required this.onDismiss, required this.enabled});
  final Widget child;
  final VoidCallback onDismiss;
  final bool enabled;

  @override
  State<_SwipeToDismiss> createState() => _SwipeToDismissState();
}

class _SwipeToDismissState extends State<_SwipeToDismiss> with SingleTickerProviderStateMixin {
  late final AnimationController _snap = AnimationController(vsync: this, duration: const Duration(milliseconds: 220));
  double _dy = 0;
  bool _dismissed = false;

  @override
  void initState() {
    super.initState();
    _snap.addListener(() => setState(() => _dy = _dy * (1 - _snap.value)));
  }

  @override
  void dispose() {
    _snap.dispose();
    super.dispose();
  }

  double _dxTotal = 0;

  void _onUpdate(DragUpdateDetails d) {
    if (!widget.enabled || _dismissed) return;
    _dxTotal += d.delta.dx.abs();
    if (_dy == 0 && _dxTotal > 24) return; // horizontaler Wischer → dem PageView überlassen
    setState(() => _dy = (_dy + d.delta.dy).clamp(0.0, 600.0));
  }

  void _onEnd(DragEndDetails d) {
    _dxTotal = 0;
    if (!widget.enabled || _dismissed) return;
    final velocity = d.velocity.pixelsPerSecond.dy;
    if (_dy > 140 || velocity > 900) {
      _dismissed = true;
      widget.onDismiss();
    } else {
      _snap.forward(from: 0);
    }
  }

  @override
  Widget build(BuildContext context) {
    final progress = (_dy / 400).clamp(0.0, 1.0);
    final scale = 1 - progress * 0.18;
    return RawGestureDetector(
      gestures: {
        // Eigener Recognizer, der sich nicht vom Zoom-Viewer aus der Arena drängen lässt
        _EagerVerticalDrag: GestureRecognizerFactoryWithHandlers<_EagerVerticalDrag>(
          _EagerVerticalDrag.new,
          (r) => r
            ..onUpdate = _onUpdate
            ..onEnd = _onEnd
            ..onCancel = () => _snap.forward(from: 0),
        ),
      },
      child: ColoredBox(
        color: Colors.black.withValues(alpha: 1 - progress * 0.9),
        child: Transform.translate(
          offset: Offset(0, _dy),
          child: Transform.scale(scale: scale, child: widget.child),
        ),
      ),
    );
  }
}

/// VerticalDrag, der eine Ablehnung durch andere Recognizer (InteractiveViewer, PageView) ignoriert.
/// Horizontale Wischer bleiben beim PageView, weil dieser Recognizer nur vertikale Bewegung zählt.
class _EagerVerticalDrag extends VerticalDragGestureRecognizer {
  @override
  void rejectGesture(int pointer) => acceptGesture(pointer);
}

class _PhotoView extends StatefulWidget {
  const _PhotoView({required this.item, required this.hero, required this.onZoomChanged});
  final MediaItem item;
  final bool hero;
  final ValueChanged<bool> onZoomChanged;

  @override
  State<_PhotoView> createState() => _PhotoViewState();
}

class _PhotoViewState extends State<_PhotoView> with SingleTickerProviderStateMixin {
  final _transform = TransformationController();
  late final AnimationController _reset = AnimationController(vsync: this, duration: const Duration(milliseconds: 200));
  Animation<Matrix4>? _resetAnim;
  bool _zoomed = false;

  @override
  void initState() {
    super.initState();
    _transform.addListener(() {
      final z = _transform.value.getMaxScaleOnAxis() > 1.02;
      if (z != _zoomed) setState(() => _zoomed = z);
      widget.onZoomChanged(z);
    });
    _reset.addListener(() {
      if (_resetAnim != null) _transform.value = _resetAnim!.value;
    });
  }

  @override
  void dispose() {
    _transform.dispose();
    _reset.dispose();
    super.dispose();
  }

  void _toggleZoom(TapDownDetails d) {
    final zoomed = _transform.value.getMaxScaleOnAxis() > 1.02;
    final Matrix4 target;
    if (zoomed) {
      target = Matrix4.identity();
    } else {
      final p = d.localPosition;
      target = Matrix4.identity()
        ..translateByDouble(-p.dx * 1.5, -p.dy * 1.5, 0, 1)
        ..scaleByDouble(2.5, 2.5, 1, 1);
    }
    _resetAnim = Matrix4Tween(begin: _transform.value, end: target).animate(CurvedAnimation(parent: _reset, curve: Curves.easeOutCubic));
    _reset.forward(from: 0);
  }

  @override
  Widget build(BuildContext context) {
    final url = widget.item.urls.thumb1600 ?? widget.item.urls.thumb400;
    if (url == null) return const Center(child: Icon(Icons.broken_image_outlined, color: Colors.white54, size: 64));

    Widget image = AppImage(
      url: url,
      fit: BoxFit.contain,
      fadeIn: Duration.zero,
      // Kleine Vorschau als Platzhalter, bis die grosse geladen ist
      placeholder: widget.item.urls.thumb400 != null
          ? AppImage(url: widget.item.urls.thumb400!, fit: BoxFit.contain, fadeIn: Duration.zero)
          : const Center(child: CircularProgressIndicator(color: Colors.white54)),
      errorWidget: const Icon(Icons.broken_image_outlined, color: Colors.white54, size: 64),
    );
    if (widget.hero && heroTransitionsSupported) image = Hero(tag: 'media-${widget.item.id}', child: image);

    return GestureDetector(
      onDoubleTapDown: _toggleZoom,
      onDoubleTap: () {},
      child: InteractiveViewer(
        transformationController: _transform,
        // Ohne Zoom soll das Bild nicht "greifen" – sonst schluckt es das Wischen nach unten
        panEnabled: _zoomed,
        minScale: 1,
        maxScale: 5,
        clipBehavior: Clip.none,
        child: SizedBox.expand(child: image),
      ),
    );
  }
}

class _VideoView extends StatefulWidget {
  const _VideoView({required this.item, required this.active});
  final MediaItem item;
  final bool active;

  @override
  State<_VideoView> createState() => _VideoViewState();
}

class _VideoViewState extends State<_VideoView> {
  VideoPlayerController? _controller;
  String? _error;

  @override
  void initState() {
    super.initState();
    final url = widget.item.urls.preview;
    if (url == null) {
      _error = 'Keine Video-Vorschau vorhanden.';
      return;
    }
    final c = VideoPlayerController.networkUrl(Uri.parse(url));
    _controller = c;
    c
        .initialize()
        .then((_) {
          if (!mounted) return;
          setState(() {});
          if (widget.active) c.play();
        })
        .catchError((Object e) {
          if (mounted) setState(() => _error = 'Video konnte nicht geladen werden: $e');
        });
  }

  @override
  void didUpdateWidget(covariant _VideoView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.active && oldWidget.active) _controller?.pause();
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = _controller;
    if (_error != null) {
      return Center(child: Text(_error!, style: const TextStyle(color: Colors.white70)));
    }
    if (c == null || !c.value.isInitialized) {
      return Stack(
        fit: StackFit.expand,
        children: [
          if (widget.item.urls.thumb1600 != null && heroTransitionsSupported)
            Hero(
              tag: 'media-${widget.item.id}',
              child: AppImage(url: widget.item.urls.thumb1600!, fit: BoxFit.contain),
            ),
          const Center(child: CircularProgressIndicator()),
        ],
      );
    }
    return Stack(
      alignment: Alignment.center,
      children: [
        Center(
          child: AspectRatio(aspectRatio: c.value.aspectRatio, child: VideoPlayer(c)),
        ),
        ValueListenableBuilder<VideoPlayerValue>(
          valueListenable: c,
          builder: (_, v, _) => AnimatedOpacity(
            opacity: v.isPlaying ? 0 : 1,
            duration: const Duration(milliseconds: 200),
            child: GlassIconButton(
              dark: true,
              icon: v.isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
              onPressed: () => v.isPlaying ? c.pause() : c.play(),
            ),
          ),
        ),
        Positioned(left: 12, right: 12, bottom: 132, child: _VideoControls(controller: c)),
      ],
    );
  }
}

/// Zeitleiste zum Spulen, Zeitangaben und ±10-Sekunden-Tasten. Liegt in einem eigenen Glas-Streifen,
/// damit die Gesten nicht mit Blättern (horizontal) oder Schliessen (vertikal) konkurrieren.
class _VideoControls extends StatefulWidget {
  const _VideoControls({required this.controller});
  final VideoPlayerController controller;

  @override
  State<_VideoControls> createState() => _VideoControlsState();
}

class _VideoControlsState extends State<_VideoControls> {
  double? _dragging; // Position in Sekunden während des Ziehens

  String _fmt(Duration d) {
    final m = d.inMinutes.remainder(60).toString().padLeft(d.inHours > 0 ? 2 : 1, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return d.inHours > 0 ? '${d.inHours}:$m:$s' : '$m:$s';
  }

  Future<void> _skip(int seconds) async {
    final c = widget.controller;
    final target = c.value.position + Duration(seconds: seconds);
    final clamped = target < Duration.zero ? Duration.zero : (target > c.value.duration ? c.value.duration : target);
    await c.seekTo(clamped);
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    return ValueListenableBuilder<VideoPlayerValue>(
      valueListenable: c,
      builder: (_, v, _) {
        final total = v.duration.inMilliseconds.toDouble().clamp(1.0, double.infinity);
        final pos = (_dragging ?? v.position.inMilliseconds / 1000).clamp(0.0, total / 1000);
        return GestureDetector(
          // Gesten hier bleiben hier (kein Blättern, kein Schliessen, kein Chrome-Toggle)
          behavior: HitTestBehavior.opaque,
          onTap: () {},
          onHorizontalDragStart: (_) {},
          onHorizontalDragUpdate: (_) {},
          onVerticalDragStart: (_) {},
          onVerticalDragUpdate: (_) {},
          child: Glass(
            borderRadius: BorderRadius.circular(16),
            tint: Colors.black.withValues(alpha: 0.45),
            border: true,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 4),
              child: Row(
                children: [
                  IconButton(color: Colors.white, tooltip: '10 s zurück', icon: const Icon(Icons.replay_10), onPressed: () => _skip(-10)),
                  IconButton(
                    color: Colors.white,
                    tooltip: v.isPlaying ? 'Pause' : 'Abspielen',
                    icon: Icon(v.isPlaying ? Icons.pause : Icons.play_arrow),
                    onPressed: () => v.isPlaying ? c.pause() : c.play(),
                  ),
                  IconButton(color: Colors.white, tooltip: '10 s vor', icon: const Icon(Icons.forward_10), onPressed: () => _skip(10)),
                  Text(_fmt(Duration(milliseconds: (pos * 1000).round())), style: const TextStyle(color: Colors.white, fontSize: 12)),
                  Expanded(
                    child: SliderTheme(
                      data: SliderTheme.of(context).copyWith(
                        trackHeight: 3,
                        thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 7),
                        overlayShape: const RoundSliderOverlayShape(overlayRadius: 14),
                        activeTrackColor: Colors.white,
                        inactiveTrackColor: Colors.white30,
                        thumbColor: Colors.white,
                      ),
                      child: Slider(
                        min: 0,
                        max: total / 1000,
                        value: pos,
                        onChangeStart: (x) => setState(() => _dragging = x),
                        onChanged: (x) => setState(() => _dragging = x),
                        onChangeEnd: (x) async {
                          await c.seekTo(Duration(milliseconds: (x * 1000).round()));
                          if (mounted) setState(() => _dragging = null);
                        },
                      ),
                    ),
                  ),
                  Text(_fmt(v.duration), style: const TextStyle(color: Colors.white70, fontSize: 12)),
                  const SizedBox(width: 6),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
