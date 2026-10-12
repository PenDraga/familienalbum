import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/api_exception.dart';
import '../../l10n/l10n.dart';
import '../../theme/app_theme.dart';
import '../../widgets/app_image.dart';
import 'book_models.dart';
import 'books_repository.dart';

/// Öffnet den Fotobuch-Assistenten (Zeitraum → Fotos → Gestaltung).
Future<void> showCreateBookDialog(BuildContext context, WidgetRef ref, String familyId) async {
  await context.push('/books/new?family=$familyId');
}

/// Fotobuch-Assistent in drei Schritten. Zeigt nur Jahre und Monate, in denen es Fotos gibt; im zweiten
/// Schritt lassen sich einzelne Fotos abwählen; im dritten Anordnung, Format und Texte mit Seitenschätzung.
class BookWizardScreen extends ConsumerStatefulWidget {
  const BookWizardScreen({super.key, required this.familyId});
  final String familyId;

  @override
  ConsumerState<BookWizardScreen> createState() => _BookWizardScreenState();
}

class _BookWizardScreenState extends ConsumerState<BookWizardScreen> {
  int _step = 0;
  int? _year;
  final _months = <String>{};
  final _excluded = <String>{};
  var _layout = BookLayout.mixed;
  var _format = BookFormat.square21;
  var _textMode = BookTextMode.captions;
  final _title = TextEditingController();
  bool _creating = false;

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  List<String> get _sortedMonths => _months.toList()..sort();
  String get _photosKey => '${widget.familyId}|${_sortedMonths.join(',')}';

  BookRequest get _request => BookRequest(
    months: _sortedMonths,
    format: _format,
    textMode: _textMode,
    layout: _layout,
    excludeMediaIds: _excluded.toList()..sort(),
    title: _title.text,
  );

  /// Vorgabe beim ersten Laden: das neuste Jahr mit Fotos, alle seine Monate.
  void _initFrom(List<BookMonth> all) {
    if (_year != null || all.isEmpty) return;
    _year = all.first.year;
    _months.addAll(all.where((m) => m.year == _year).map((m) => m.month));
  }

  void _selectYear(int year, List<BookMonth> all) => setState(() {
    _year = year;
    _months
      ..clear()
      ..addAll(all.where((m) => m.year == year).map((m) => m.month));
    _excluded.clear();
  });

  Future<void> _create() async {
    final l10n = context.l10n;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _creating = true);
    try {
      final book = await ref.read(booksRepositoryProvider).create(widget.familyId, _request);
      ref.invalidate(booksProvider);
      messenger.showSnackBar(SnackBar(content: Text(l10n.bookCreateStarted(book.title, book.pageCount))));
      if (mounted) context.pushReplacement('/books/${book.id}');
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e))));
      if (mounted) setState(() => _creating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final months = ref.watch(bookMonthsProvider(widget.familyId));
    final steps = [l10n.bookStepPeriod, l10n.bookStepPhotos, l10n.bookStepDesign];

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.bookCreateTitle),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(36),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
            child: Row(
              children: [
                for (var i = 0; i < steps.length; i++) ...[
                  if (i > 0) const SizedBox(width: 8),
                  Expanded(child: _StepPill(label: steps[i], index: i, current: _step)),
                ],
              ],
            ),
          ),
        ),
      ),
      body: months.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(errorMessage(e), textAlign: TextAlign.center))),
        data: (all) {
          _initFrom(all);
          if (all.isEmpty) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(l10n.bookNoPhotos, textAlign: TextAlign.center)));
          return switch (_step) {
            0 => _PeriodStep(all: all, year: _year!, selected: _months, onYear: (y) => _selectYear(y, all), onToggle: (m) => setState(() => _months.contains(m) ? _months.remove(m) : _months.add(m))),
            1 => _PhotosStep(photosKey: _photosKey, excluded: _excluded, onChanged: () => setState(() {})),
            _ => _DesignStep(
              familyId: widget.familyId,
              request: _request,
              title: _title,
              onLayout: (v) => setState(() => _layout = v),
              onFormat: (v) => setState(() => _format = v),
              onTextMode: (v) => setState(() => _textMode = v),
            ),
          };
        },
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: Row(
            children: [
              if (_step > 0) ...[
                TextButton.icon(onPressed: () => setState(() => _step--), icon: const Icon(Icons.chevron_left), label: Text(l10n.bookBack)),
                const SizedBox(width: 12),
              ],
              // Das Theme macht gefüllte Knöpfe volle Breite – darum den Rest der Zeile füllen
              Expanded(
                child: _step < 2
                    ? FilledButton(onPressed: _months.isEmpty ? null : () => setState(() => _step++), child: Text(l10n.bookNext))
                    : FilledButton.icon(
                        onPressed: _creating ? null : _create,
                        icon: _creating ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.auto_stories_outlined),
                        label: Text(l10n.commonCreate),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StepPill extends StatelessWidget {
  const _StepPill({required this.label, required this.index, required this.current});
  final String label;
  final int index;
  final int current;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final active = index == current;
    final done = index < current;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 6),
      decoration: BoxDecoration(
        color: active ? scheme.primary : (done ? scheme.primaryContainer : scheme.surfaceContainerHigh),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        '${index + 1}  $label',
        textAlign: TextAlign.center,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(context).textTheme.labelMedium?.copyWith(color: active ? scheme.onPrimary : scheme.onSurfaceVariant, fontWeight: FontWeight.w700),
      ),
    );
  }
}

/// Schritt 1: nur Jahre und Monate mit Fotos.
class _PeriodStep extends StatelessWidget {
  const _PeriodStep({required this.all, required this.year, required this.selected, required this.onYear, required this.onToggle});
  final List<BookMonth> all;
  final int year;
  final Set<String> selected;
  final ValueChanged<int> onYear;
  final ValueChanged<String> onToggle;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final years = all.map((m) => m.year).toSet().toList()..sort((a, b) => b.compareTo(a));
    final inYear = all.where((m) => m.year == year).toList()..sort((a, b) => a.month.compareTo(b.month));
    final monthName = DateFormat.MMMM(context.localeTag);
    final count = all.where((m) => selected.contains(m.month)).fold<int>(0, (n, m) => n + m.count);
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: [
        Text(l10n.bookYear, style: text.titleSmall),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [for (final y in years) ChoiceChip(label: Text('$y'), selected: y == year, onSelected: (_) => onYear(y))],
        ),
        const SizedBox(height: 20),
        Text(l10n.bookMonths, style: text.titleSmall),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            for (final m in inYear)
              FilterChip(
                label: Text('${monthName.format(DateTime(2000, m.monthNumber))} · ${m.count}'),
                selected: selected.contains(m.month),
                onSelected: (_) => onToggle(m.month),
              ),
          ],
        ),
        const SizedBox(height: 16),
        Text(l10n.bookPhotos(count), style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)),
      ],
    );
  }
}

/// Schritt 2: Fotos der gewählten Monate; Tippen nimmt ein Foto aus dem Buch.
class _PhotosStep extends ConsumerWidget {
  const _PhotosStep({required this.photosKey, required this.excluded, required this.onChanged});
  final String photosKey;
  final Set<String> excluded;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final photos = ref.watch(bookPhotosProvider(photosKey));
    final monthName = DateFormat.yMMMM(context.localeTag);
    return photos.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text(errorMessage(e))),
      data: (list) {
        final selected = list.where((p) => !excluded.contains(p.id)).length;
        final groups = <String, List<BookPhoto>>{};
        for (final p in list) {
          groups.putIfAbsent(p.month, () => []).add(p);
        }
        return CustomScrollView(
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(child: Text(l10n.bookSelectedCount(selected, list.length), style: text.titleSmall)),
                        TextButton(
                          onPressed: () {
                            excluded.clear();
                            onChanged();
                          },
                          child: Text(l10n.bookSelectAll),
                        ),
                        TextButton(
                          onPressed: () {
                            excluded
                              ..clear()
                              ..addAll(list.where((p) => p.commentCount == 0).map((p) => p.id));
                            onChanged();
                          },
                          child: Text(l10n.bookSelectCommented),
                        ),
                      ],
                    ),
                    Text(l10n.bookPhotosHint, style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
                  ],
                ),
              ),
            ),
            for (final entry in groups.entries) ...[
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
                  child: Text(monthName.format(DateTime(int.parse(entry.key.substring(0, 4)), int.parse(entry.key.substring(5, 7)))), style: text.titleSmall),
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                sliver: SliverGrid(
                  gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 120, mainAxisSpacing: 4, crossAxisSpacing: 4),
                  delegate: SliverChildBuilderDelegate((context, i) {
                    final p = entry.value[i];
                    final off = excluded.contains(p.id);
                    return GestureDetector(
                      key: ValueKey('book-photo-${p.id}'),
                      // ganze Kachel tippbar, auch solange das Vorschaubild lädt
                      behavior: HitTestBehavior.opaque,
                      onTap: () {
                        off ? excluded.remove(p.id) : excluded.add(p.id);
                        onChanged();
                      },
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            Opacity(opacity: off ? 0.3 : 1, child: AppImage(url: p.thumbUrl, fit: BoxFit.cover)),
                            Positioned(
                              right: 6,
                              top: 6,
                              child: Icon(off ? Icons.radio_button_unchecked : Icons.check_circle, color: off ? Colors.white : scheme.primary, size: 22, shadows: const [Shadow(blurRadius: 4, color: Colors.black45)]),
                            ),
                            if (p.commentCount > 0)
                              Positioned(
                                left: 6,
                                bottom: 6,
                                child: Icon(Icons.chat_bubble, color: Colors.white.withValues(alpha: 0.9), size: 16, shadows: const [Shadow(blurRadius: 4, color: Colors.black45)]),
                              ),
                          ],
                        ),
                      ),
                    );
                  }, childCount: entry.value.length),
                ),
              ),
            ],
            const SliverToBoxAdapter(child: SizedBox(height: 24)),
          ],
        );
      },
    );
  }
}

/// Schritt 3: Anordnung, Format, Texte, Titel; laufende Seitenschätzung vom Server.
class _DesignStep extends ConsumerWidget {
  const _DesignStep({required this.familyId, required this.request, required this.title, required this.onLayout, required this.onFormat, required this.onTextMode});
  final String familyId;
  final BookRequest request;
  final TextEditingController title;
  final ValueChanged<BookLayout> onLayout;
  final ValueChanged<BookFormat> onFormat;
  final ValueChanged<BookTextMode> onTextMode;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final preview = ref.watch(bookPreviewProvider(BookPreviewArgs(familyId, request)));
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: [
        Text(l10n.bookLayout, style: text.titleSmall),
        const SizedBox(height: 8),
        for (final layout in BookLayout.values)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _LayoutCard(layout: layout, selected: request.layout == layout, onTap: () => onLayout(layout)),
          ),
        const SizedBox(height: 8),
        Text(l10n.bookFormat, style: text.titleSmall),
        const SizedBox(height: 6),
        Wrap(spacing: 8, runSpacing: 6, children: [for (final f in BookFormat.values) ChoiceChip(label: Text(f.label(l10n)), selected: request.format == f, onSelected: (_) => onFormat(f))]),
        const SizedBox(height: 16),
        Text(l10n.bookTexts, style: text.titleSmall),
        const SizedBox(height: 6),
        Wrap(spacing: 8, runSpacing: 6, children: [for (final t in BookTextMode.values) ChoiceChip(label: Text(t.label(l10n)), selected: request.textMode == t, onSelected: (_) => onTextMode(t))]),
        const SizedBox(height: 16),
        TextField(
          controller: title,
          decoration: InputDecoration(labelText: l10n.bookTitleLabel, hintText: l10n.bookTitleHint),
          textCapitalization: TextCapitalization.sentences,
          maxLength: 80,
        ),
        const SizedBox(height: 4),
        Card(
          color: scheme.surfaceContainerHigh,
          child: ListTile(
            leading: const Icon(Icons.auto_stories_outlined),
            title: preview.when(
              loading: () => Text(l10n.bookEstimating),
              error: (e, _) => Text(errorMessage(e)),
              data: (p) => Text(l10n.bookEstimate(p.pageCount, p.mediaCount)),
            ),
            subtitle: switch (preview.value) {
              final p? when p.pageCount > p.maxPages => Text(l10n.bookTooLarge(p.maxPages), style: TextStyle(color: scheme.error)),
              _ => Text(l10n.bookCreateHint),
            },
          ),
        ),
      ],
    );
  }
}

class _LayoutCard extends StatelessWidget {
  const _LayoutCard({required this.layout, required this.selected, required this.onTap});
  final BookLayout layout;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    return Material(
      color: selected ? scheme.primaryContainer : scheme.surfaceContainerLow,
      borderRadius: BorderRadius.circular(AppTokens.radiusM),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTokens.radiusM),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              _LayoutSketch(layout: layout, color: selected ? scheme.primary : scheme.outline),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(layout.label(l10n), style: text.titleSmall),
                    const SizedBox(height: 2),
                    Text(layout.description(l10n), style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
                  ],
                ),
              ),
              Icon(selected ? Icons.radio_button_checked : Icons.radio_button_unchecked, color: selected ? scheme.primary : scheme.outline),
            ],
          ),
        ),
      ),
    );
  }
}

/// Kleine Skizze der Anordnung (eine Seite).
class _LayoutSketch extends StatelessWidget {
  const _LayoutSketch({required this.layout, required this.color});
  final BookLayout layout;
  final Color color;

  @override
  Widget build(BuildContext context) {
    Widget box(double w, double h) => Container(width: w, height: h, decoration: BoxDecoration(color: color.withValues(alpha: 0.55), borderRadius: BorderRadius.circular(2)));
    final inner = switch (layout) {
      BookLayout.single => Center(child: box(30, 22)),
      BookLayout.mixed => Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [box(34, 16), const SizedBox(height: 3), Row(mainAxisAlignment: MainAxisAlignment.center, children: [box(15, 14), const SizedBox(width: 3), box(16, 14)])],
      ),
      BookLayout.collage => Wrap(
        spacing: 3,
        runSpacing: 3,
        alignment: WrapAlignment.center,
        children: [for (var i = 0; i < 6; i++) box(10, 10)],
      ),
    };
    return Container(
      width: 48,
      height: 48,
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4), border: Border.all(color: color.withValues(alpha: 0.4))),
      child: inner,
    );
  }
}
