import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_exception.dart';
import '../../l10n/l10n.dart';
import '../../theme/app_theme.dart';
import '../../widgets/app_image.dart';
import 'book_edit.dart';
import 'book_models.dart';
import 'books_repository.dart';

/// Kontroll-Assistent: jede Seite durchblättern, Ausschnitt und Zoom pro Foto, Fotos entfernen oder verschieben,
/// Text pro Seite ausblenden, Umschlagfoto und Titel. Jede Änderung zeigt sofort eine Vorschau der Seite vom
/// Server; «Speichern» ersetzt die Seitenliste und rendert das Buch neu.
class BookEditorScreen extends ConsumerStatefulWidget {
  const BookEditorScreen({super.key, required this.bookId, this.initialPage = 0});
  final String bookId;
  final int initialPage;

  @override
  ConsumerState<BookEditorScreen> createState() => _BookEditorScreenState();
}

class _BookEditorScreenState extends ConsumerState<BookEditorScreen> {
  List<BookPageJson>? _pages;
  Map<String, String> _thumbs = const {};
  /// Seitenverhältnis je Foto (aus den Fotoseiten; der Server setzt es beim Speichern)
  Map<String, double> _aspects = const {};
  BookFormat _format = BookFormat.square21;
  int _index = 0;
  bool _dirty = false;
  bool _saving = false;
  /// Seite, deren Vorschau gezeigt wird (verzögert nachgeführt, damit Regler nicht jede Bewegung schicken)
  BookPageJson? _shown;
  Timer? _debounce;
  Uint8List? _lastImage;
  /// Seitenverhältnis des Platzes je Foto, wie der Server die Seite zuletzt gesetzt hat
  final Map<String, double> _slots = {};

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  void _init(BookItem book) {
    if (_pages != null) return;
    _pages = copyPages([for (final p in book.pages) p.raw]);
    _format = book.format;
    _thumbs = {
      for (final p in book.pages)
        for (final (i, id) in pageMediaIds(p.raw).indexed)
          if (i < p.thumbs.length) id: p.thumbs[i],
    };
    _aspects = {
      for (final p in _pages!)
        for (final i in ((p['items'] as List<dynamic>?) ?? const []).cast<Map<String, dynamic>>())
          if (i['aspect'] is num) i['mediaId'] as String: (i['aspect'] as num).toDouble(),
    };
    _index = widget.initialPage.clamp(0, _pages!.length - 1);
    _shown = _pages![_index];
  }

  void _update(List<BookPageJson> pages, {bool immediate = false, int? index}) {
    setState(() {
      _pages = pages;
      _dirty = true;
      if (index != null) _index = index;
      _index = _index.clamp(0, pages.length - 1);
    });
    _schedulePreview(immediate: immediate);
  }

  void _schedulePreview({bool immediate = false}) {
    _debounce?.cancel();
    if (immediate) {
      setState(() => _shown = _pages![_index]);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (mounted) setState(() => _shown = _pages![_index]);
    });
  }

  void _go(int index) {
    setState(() => _index = index);
    _schedulePreview(immediate: true);
  }

  /// Speichern (falls geändert) und – mit [pdf] – gleich das PDF anfordern; danach zum Buch.
  Future<void> _save({bool pdf = false}) async {
    final l10n = context.l10n;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _saving = true);
    try {
      final repo = ref.read(booksRepositoryProvider);
      if (_dirty) await repo.savePages(widget.bookId, _pages!);
      if (pdf) await repo.requestPdf(widget.bookId);
      ref.invalidate(bookDetailProvider(widget.bookId));
      ref.invalidate(booksProvider);
      messenger.showSnackBar(SnackBar(content: Text(pdf ? l10n.bookPdfRequested : l10n.bookEditorSaved)));
      if (mounted) {
        setState(() => _dirty = false);
        // Zum Buch – auch wenn der Editor direkt aus dem Assistenten kam
        context.go('/books/${widget.bookId}');
      }
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e))));
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<bool> _confirmDiscard() async {
    final l10n = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.bookEditorDiscardTitle),
        content: Text(l10n.bookEditorDiscardText),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l10n.commonCancel)),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l10n.bookEditorDiscard)),
        ],
      ),
    );
    return ok == true;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final detail = ref.watch(bookDetailProvider(widget.bookId));
    final book = detail.value;
    if (book != null) _init(book);
    final pages = _pages;

    return PopScope(
      canPop: !_dirty,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _confirmDiscard() && context.mounted) {
          setState(() => _dirty = false);
          context.pop();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(pages == null ? l10n.bookReview : l10n.bookEditorPage(_index + 1, pages.length)),
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: TextButton(
                onPressed: _dirty && !_saving ? _save : null,
                child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l10n.bookEditorSave),
              ),
            ),
          ],
        ),
        body: pages == null
            ? Center(child: detail.hasError ? Text(errorMessage(detail.error!)) : const CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                children: [
                  // Vorschau höchstens halb so hoch wie der Bildschirm, damit die Werkzeuge sichtbar bleiben
                  Center(
                    child: ConstrainedBox(
                      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.5),
                      child: _Preview(bookId: widget.bookId, page: _shown ?? pages[_index], aspect: _format.aspectRatio, last: _lastImage, onImage: (p) {
                        _lastImage = p.bytes;
                        _slots.addAll(p.slots);
                      }),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      IconButton.filledTonal(key: const ValueKey('book-prev'), onPressed: _index > 0 ? () => _go(_index - 1) : null, icon: const Icon(Icons.chevron_left)),
                      Expanded(child: Text(l10n.bookEditorPage(_index + 1, pages.length), textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleSmall)),
                      IconButton.filledTonal(key: const ValueKey('book-next'), onPressed: _index < pages.length - 1 ? () => _go(_index + 1) : null, icon: const Icon(Icons.chevron_right)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  ..._controls(context, pages),
                ],
              ),
        bottomNavigationBar: pages == null
            ? null
            : SafeArea(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                  child: FilledButton.icon(
                    key: const ValueKey('book-editor-pdf'),
                    onPressed: _saving ? null : () => _save(pdf: true),
                    icon: const Icon(Icons.picture_as_pdf_outlined),
                    label: Text(l10n.bookCreatePdf),
                  ),
                ),
              ),
      ),
    );
  }

  List<Widget> _controls(BuildContext context, List<BookPageJson> pages) {
    final l10n = context.l10n;
    final page = pages[_index];
    switch (page['type']) {
      case 'cover':
        final id = page['mediaId'] as String?;
        return [
          _TextField(key: ValueKey('cover-title-$_index'), label: l10n.bookCoverTitle, value: page['title'] as String? ?? '', onChanged: (v) => _update(setText(pages, _index, 'title', v))),
          _TextField(key: ValueKey('cover-sub-$_index'), label: l10n.bookCoverSubtitle, value: page['subtitle'] as String? ?? '', onChanged: (v) => _update(setText(pages, _index, 'subtitle', v))),
          if (id != null)
            _PhotoRow(
              thumb: _thumbs[id],
              cropped: cropOf(page, id) != null,
              onCrop: () => _editCrop(id),
              actions: [
                // Das Theme macht umrandete Knöpfe volle Breite – in der Zeile braucht es eine eigene Mindestgrösse
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)),
                  onPressed: _chooseCover,
                  icon: const Icon(Icons.photo_library_outlined),
                  label: Text(l10n.bookCoverPhoto),
                ),
              ],
            ),
        ];
      case 'chapter':
        return [_TextField(key: ValueKey('chapter-$_index'), label: l10n.bookChapterTitle, value: page['title'] as String? ?? '', onChanged: (v) => _update(setText(pages, _index, 'title', v)))];
      default:
        return [
          if (pageHasText(page))
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(l10n.bookShowText),
              value: page['hideText'] != true,
              onChanged: (v) => _update(setHideText(pages, _index, !v), immediate: true),
            ),
          for (final id in pageMediaIds(page))
            _PhotoRow(
              key: ValueKey('book-photo-row-$id'),
              thumb: _thumbs[id],
              cropped: cropOf(page, id) != null,
              onCrop: () => _editCrop(id),
              actions: [
                IconButton(
                  key: ValueKey('book-swap-$id'),
                  tooltip: l10n.bookSwap,
                  onPressed: () => _swap(id),
                  icon: const Icon(Icons.swap_horiz),
                ),
                IconButton(
                  tooltip: l10n.bookMovePrev,
                  onPressed: neighbourPhotoPage(pages, _index, -1) == null ? null : () => _move(id, -1),
                  icon: const Icon(Icons.arrow_back),
                ),
                IconButton(
                  tooltip: l10n.bookMoveNext,
                  onPressed: neighbourPhotoPage(pages, _index, 1) == null ? null : () => _move(id, 1),
                  icon: const Icon(Icons.arrow_forward),
                ),
                IconButton(key: ValueKey('book-remove-$id'), tooltip: l10n.bookRemovePhoto, onPressed: () => _update(removeItem(pages, _index, id), immediate: true), icon: const Icon(Icons.delete_outline)),
              ],
            ),
        ];
    }
  }

  void _move(String id, int direction) {
    final moved = moveItem(_pages!, _index, id, direction);
    if (moved == null) return;
    // Der Seite folgen, auf der das Foto jetzt liegt
    final target = moved.indexWhere((p) => pageMediaIds(p).contains(id));
    _update(moved, immediate: true, index: target < 0 ? _index : target);
  }

  /// Foto mit einem anderen Foto des Buchs tauschen (Auswahl aus den Fotos im Buch, nach Seite geordnet).
  Future<void> _swap(String id) async {
    final l10n = context.l10n;
    final pages = _pages!;
    final candidates = [
      for (final (p, page) in pages.indexed)
        if (page['type'] == 'photos')
          for (final other in pageMediaIds(page))
            if (other != id) (id: other, page: p),
    ];
    final chosen = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(ctx).height * 0.6,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                child: Text(l10n.bookSwapTitle, style: Theme.of(ctx).textTheme.titleLarge),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                child: Text(l10n.bookSwapHint, style: Theme.of(ctx).textTheme.bodySmall?.copyWith(color: Theme.of(ctx).colorScheme.onSurfaceVariant)),
              ),
              Expanded(
                child: GridView.extent(
                  maxCrossAxisExtent: 110,
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                  mainAxisSpacing: 6,
                  crossAxisSpacing: 6,
                  children: [
                    for (final c in candidates)
                      GestureDetector(
                        key: ValueKey('book-swap-pick-${c.id}'),
                        behavior: HitTestBehavior.opaque,
                        onTap: () => Navigator.pop(ctx, c.id),
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            ClipRRect(borderRadius: BorderRadius.circular(8), child: _thumbs[c.id] == null ? const ColoredBox(color: Colors.black12) : AppImage(url: _thumbs[c.id]!, fit: BoxFit.cover)),
                            Positioned(
                              left: 4,
                              bottom: 4,
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(6)),
                                child: Text(l10n.bookPageShort(c.page + 1), style: const TextStyle(color: Colors.white, fontSize: 11)),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (chosen != null) _update(swapItems(_pages!, id, chosen), immediate: true);
  }

  Future<void> _chooseCover() async {
    final ids = _thumbs.keys.toList();
    final chosen = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(ctx).height * 0.6,
          child: GridView.extent(
            maxCrossAxisExtent: 110,
            padding: const EdgeInsets.all(12),
            mainAxisSpacing: 6,
            crossAxisSpacing: 6,
            children: [
              for (final id in ids)
                GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => Navigator.pop(ctx, id),
                  child: ClipRRect(borderRadius: BorderRadius.circular(8), child: AppImage(url: _thumbs[id]!, fit: BoxFit.cover)),
                ),
            ],
          ),
        ),
      ),
    );
    if (chosen != null) _update(setCoverPhoto(_pages!, chosen), immediate: true);
  }

  Future<void> _editCrop(String id) async {
    final page = _pages![_index];
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => _CropSheet(
        thumb: _thumbs[id],
        aspect: _aspects[id] ?? 1.5,
        slotAspect: _slots[id],
        initial: cropOf(page, id),
        onChanged: (crop) => _update(setCrop(_pages!, _index, id, crop)),
      ),
    );
  }
}

/// Seitenvorschau vom Server; zeigt beim Nachladen das letzte Bild weiter (kein Flackern).
class _Preview extends ConsumerWidget {
  const _Preview({required this.bookId, required this.page, required this.aspect, required this.last, required this.onImage});
  final String bookId;
  final BookPageJson page;
  final double aspect;
  final Uint8List? last;
  final ValueChanged<PagePreview> onImage;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final image = ref.watch(bookPagePreviewProvider(PagePreviewArgs(bookId, page)));
    final bytes = image.value?.bytes ?? last;
    if (image.value != null) onImage(image.value!);
    return AspectRatio(
      aspectRatio: aspect,
      child: DecoratedBox(
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4), border: Border.all(color: scheme.outlineVariant)),
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (bytes != null) Image.memory(bytes, fit: BoxFit.contain, gaplessPlayback: true),
            if (image.isLoading) const Positioned(right: 10, top: 10, child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))),
            if (image.hasError) Center(child: Padding(padding: const EdgeInsets.all(16), child: Text(errorMessage(image.error!), textAlign: TextAlign.center))),
          ],
        ),
      ),
    );
  }
}

class _PhotoRow extends StatelessWidget {
  const _PhotoRow({super.key, required this.thumb, required this.cropped, required this.onCrop, required this.actions});
  final String? thumb;
  final bool cropped;
  final VoidCallback onCrop;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppTokens.radiusM),
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: SizedBox(width: 56, height: 56, child: thumb == null ? ColoredBox(color: scheme.surfaceContainerHigh) : AppImage(url: thumb!, fit: BoxFit.cover)),
              ),
              const SizedBox(width: 4),
              // Auf schmalen Handys nur das Symbol, damit Tauschen, Verschieben und Entfernen Platz haben
              if (MediaQuery.sizeOf(context).width < 430)
                IconButton(tooltip: l10n.bookCrop, onPressed: onCrop, icon: Icon(cropped ? Icons.crop : Icons.crop_free))
              else
                TextButton.icon(
                  onPressed: onCrop,
                  icon: Icon(cropped ? Icons.crop : Icons.crop_free),
                  label: Text(l10n.bookCrop),
                ),
              const Spacer(),
              ...actions,
            ],
          ),
        ),
      ),
    );
  }
}

class _TextField extends StatefulWidget {
  const _TextField({super.key, required this.label, required this.value, required this.onChanged});
  final String label;
  final String value;
  final ValueChanged<String> onChanged;

  @override
  State<_TextField> createState() => _TextFieldState();
}

class _TextFieldState extends State<_TextField> {
  late final _controller = TextEditingController(text: widget.value);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: TextField(controller: _controller, maxLength: 120, decoration: InputDecoration(labelText: widget.label), onChanged: widget.onChanged),
  );
}

/// Ausschnitt wählen: auf den wichtigsten Bildteil tippen (Fokuspunkt), Zoom per Regler, «Automatisch» setzt zurück.
class _CropSheet extends StatefulWidget {
  const _CropSheet({required this.thumb, required this.aspect, required this.slotAspect, required this.initial, required this.onChanged});
  final String? thumb;
  final double aspect;
  /// Seitenverhältnis des Platzes auf der Seite (z. B. breites Band auf dem Umschlag); null = wie das Foto
  final double? slotAspect;
  final ({double x, double y, double zoom})? initial;
  final ValueChanged<({double x, double y, double zoom})?> onChanged;

  @override
  State<_CropSheet> createState() => _CropSheetState();
}

class _CropSheetState extends State<_CropSheet> {
  late double _x = widget.initial?.x ?? 0.5;
  late double _y = widget.initial?.y ?? 0.5;
  late double _zoom = widget.initial?.zoom ?? 1;
  late bool _auto = widget.initial == null;

  void _emit() => widget.onChanged(_auto ? null : (x: _x, y: _y, zoom: _zoom));

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.bookCrop, style: text.titleLarge),
            const SizedBox(height: 4),
            Text(l10n.bookCropHint, style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
            const SizedBox(height: 12),
            SizedBox(
              height: 260,
              child: Center(
                child: AspectRatio(
                  aspectRatio: widget.aspect,
                  child: LayoutBuilder(
                    builder: (context, box) => GestureDetector(
                      key: const ValueKey('book-crop-area'),
                      behavior: HitTestBehavior.opaque,
                      onTapDown: (d) {
                        setState(() {
                          _x = (d.localPosition.dx / box.maxWidth).clamp(0.0, 1.0);
                          _y = (d.localPosition.dy / box.maxHeight).clamp(0.0, 1.0);
                          _auto = false;
                        });
                        _emit();
                      },
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            widget.thumb == null ? ColoredBox(color: scheme.surfaceContainerHigh) : AppImage(url: widget.thumb!, fit: BoxFit.cover),
                            if (!_auto) IgnorePointer(child: CustomPaint(painter: _CropPainter(x: _x, y: _y, zoom: _zoom, slotAspect: widget.slotAspect))),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Text(l10n.bookZoom, style: text.labelLarge),
                Expanded(
                  child: Slider(
                    key: const ValueKey('book-zoom'),
                    value: _zoom,
                    min: 1,
                    max: 3,
                    divisions: 20,
                    label: '${_zoom.toStringAsFixed(1)}×',
                    onChanged: (v) {
                      setState(() {
                        _zoom = v;
                        _auto = false;
                      });
                      _emit();
                    },
                  ),
                ),
                Text('${_zoom.toStringAsFixed(1)}×', style: text.labelLarge),
              ],
            ),
            Row(
              children: [
                TextButton.icon(
                  onPressed: () {
                    setState(() {
                      _auto = true;
                      _x = 0.5;
                      _y = 0.5;
                      _zoom = 1;
                    });
                    _emit();
                  },
                  icon: const Icon(Icons.auto_fix_high),
                  label: Text(l10n.bookCropAuto),
                ),
                const Spacer(),
                SizedBox(width: 140, child: FilledButton(onPressed: () => Navigator.pop(context), child: Text(l10n.bookCropDone))),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Ausschnitt im angezeigten Foto – dieselbe Rechnung wie `cropBox` auf dem Server: grösster Rahmen im
/// Seitenverhältnis des Platzes, verkleinert um den Zoom, um den Fokuspunkt, innerhalb des Fotos.
Rect cropRect(Size photo, double slotAspect, ({double x, double y, double zoom}) crop) {
  final baseW = photo.width < photo.height * slotAspect ? photo.width : photo.height * slotAspect;
  final baseH = baseW / slotAspect;
  final zoom = crop.zoom.clamp(1.0, 4.0);
  final w = baseW / zoom;
  final h = baseH / zoom;
  final left = (crop.x * photo.width - w / 2).clamp(0.0, photo.width - w);
  final top = (crop.y * photo.height - h / 2).clamp(0.0, photo.height - h);
  return Rect.fromLTWH(left, top, w, h);
}

/// Dunkelt aussen ab, was wegfällt, und markiert den Fokuspunkt.
class _CropPainter extends CustomPainter {
  _CropPainter({required this.x, required this.y, required this.zoom, required this.slotAspect});
  final double x;
  final double y;
  final double zoom;
  final double? slotAspect;

  @override
  void paint(Canvas canvas, Size size) {
    final keep = cropRect(size, slotAspect ?? size.width / size.height, (x: x, y: y, zoom: zoom));
    final shade = Path()
      ..addRect(Offset.zero & size)
      ..addRect(keep)
      ..fillType = PathFillType.evenOdd;
    canvas.drawPath(shade, Paint()..color = Colors.black.withValues(alpha: 0.45));
    canvas.drawRect(keep, Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = Colors.white);
    final c = Offset(x * size.width, y * size.height);
    canvas.drawCircle(c, 12, Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..color = Colors.white);
  }

  @override
  bool shouldRepaint(_CropPainter old) => old.x != x || old.y != y || old.zoom != zoom || old.slotAspect != slotAspect;
}
