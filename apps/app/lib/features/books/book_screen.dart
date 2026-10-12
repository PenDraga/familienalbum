import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../../l10n/l10n.dart';
import '../../theme/app_theme.dart';
import '../../widgets/app_image.dart';
import '../media/original/original_saver.dart';
import 'book_models.dart';
import 'books_repository.dart';

/// Fotobuch: Seitenvorschau, PDF teilen oder laden, umbenennen, nochmals rendern, löschen.
class BookScreen extends ConsumerStatefulWidget {
  const BookScreen({super.key, required this.bookId});
  final String bookId;

  @override
  ConsumerState<BookScreen> createState() => _BookScreenState();
}

class _BookScreenState extends ConsumerState<BookScreen> {
  bool _busy = false;

  void _refresh() {
    ref.invalidate(bookDetailProvider(widget.bookId));
    ref.invalidate(booksProvider);
  }

  Future<void> _share(BookItem book) async {
    final url = book.pdfUrl;
    if (url == null) return;
    if (kIsWeb) {
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      return;
    }
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final prepared = await prepareOriginal(
        ref.read(apiClientProvider).dio,
        url: url,
        fileName: '${book.title}.pdf',
        mimeType: 'application/pdf',
        isVideo: false,
        onProgress: (_) {},
      );
      try {
        await prepared.share();
      } finally {
        await prepared.dispose();
      }
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _rename(BookItem book) async {
    final l10n = context.l10n;
    final title = await showDialog<String>(context: context, builder: (_) => _RenameDialog(initial: book.title));
    if (title == null || title.isEmpty || title == book.title || !mounted) return;
    await _run(() => ref.read(booksRepositoryProvider).rename(book.id, title), l10n.bookRerendering);
  }

  Future<void> _rerender(BookItem book) => _run(() => ref.read(booksRepositoryProvider).rerender(book.id), context.l10n.bookRerendering);

  Future<void> _run(Future<void> Function() action, String message) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await action();
      _refresh();
      messenger.showSnackBar(SnackBar(content: Text(message)));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e))));
    }
  }

  Future<void> _delete(BookItem book) async {
    final l10n = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.bookDeleteTitle(book.title)),
        content: Text(l10n.bookDeleteText),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l10n.commonCancel)),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l10n.commonDelete)),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await ref.read(booksRepositoryProvider).delete(book.id);
      ref.invalidate(booksProvider);
      if (mounted) context.pop();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final scheme = Theme.of(context).colorScheme;
    final detail = ref.watch(bookDetailProvider(widget.bookId));
    final book = detail.value;

    return Scaffold(
      appBar: AppBar(
        title: Text(book?.title ?? l10n.bookTitle),
        actions: [
          if (book != null && book.isReady)
            IconButton(
              tooltip: kIsWeb ? l10n.bookDownloadPdf : l10n.bookSharePdf,
              onPressed: _busy ? null : () => _share(book),
              icon: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Icon(kIsWeb ? Icons.download_outlined : Icons.ios_share),
            ),
          if (book != null && book.canEdit)
            PopupMenuButton<String>(
              onSelected: (v) => switch (v) {
                'rename' => _rename(book),
                'rerender' => _rerender(book),
                _ => _delete(book),
              },
              itemBuilder: (_) => [
                PopupMenuItem(value: 'rename', child: Text(l10n.bookRenameTitle)),
                if (book.isFailed) PopupMenuItem(value: 'rerender', child: Text(l10n.bookRerender)),
                PopupMenuItem(value: 'delete', child: Text(l10n.commonDelete)),
              ],
            ),
        ],
      ),
      body: book == null
          ? Center(child: detail.isLoading ? const CircularProgressIndicator() : Text(detail.hasError ? errorMessage(detail.error!) : l10n.bookNotFound))
          : RefreshIndicator(
              onRefresh: () async => _refresh(),
              child: CustomScrollView(
                slivers: [
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                      child: _Header(book: book),
                    ),
                  ),
                  if (!book.isReady)
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                        child: Card(
                          color: book.isFailed ? scheme.errorContainer : scheme.surfaceContainerHigh,
                          child: ListTile(
                            leading: book.isFailed ? Icon(Icons.error_outline, color: scheme.onErrorContainer) : const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2.5)),
                            title: Text(book.isFailed ? l10n.bookFailedText : l10n.bookRenderingText),
                            subtitle: Text(book.isFailed ? (book.error ?? '') : l10n.bookRenderingHint),
                            trailing: book.isFailed && book.canEdit ? TextButton(onPressed: () => _rerender(book), child: Text(l10n.commonRetry)) : null,
                          ),
                        ),
                      ),
                    ),
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                    sliver: SliverGrid(
                      gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 180, mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: book.format.aspectRatio / 1.18),
                      delegate: SliverChildBuilderDelegate((context, i) => _PageTile(page: book.pages[i], format: book.format), childCount: book.pages.length),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.book});
  final BookItem book;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final mb = book.pdfBytes == null ? null : (book.pdfBytes! / (1024 * 1024)).toStringAsFixed(1);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            Chip(avatar: const Icon(Icons.crop_square_outlined, size: 16), label: Text(book.format.label(l10n)), visualDensity: VisualDensity.compact),
            Chip(avatar: const Icon(Icons.dashboard_outlined, size: 16), label: Text(book.layout.label(l10n)), visualDensity: VisualDensity.compact),
            Chip(avatar: const Icon(Icons.notes_outlined, size: 16), label: Text(book.textMode.label(l10n)), visualDensity: VisualDensity.compact),
            Chip(avatar: const Icon(Icons.auto_stories_outlined, size: 16), label: Text(l10n.bookPages(book.pageCount)), visualDensity: VisualDensity.compact),
            Chip(avatar: const Icon(Icons.photo_outlined, size: 16), label: Text(l10n.bookPhotos(book.mediaCount)), visualDensity: VisualDensity.compact),
            if (mb != null) Chip(avatar: const Icon(Icons.picture_as_pdf_outlined, size: 16), label: Text('$mb MB'), visualDensity: VisualDensity.compact),
          ],
        ),
        const SizedBox(height: 8),
        Text(l10n.bookCreatedBy(book.createdByName), style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
        if (book.isReady) ...[
          const SizedBox(height: 6),
          Text(l10n.bookOrderHint, style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
        ],
      ],
    );
  }
}

class _PageTile extends StatelessWidget {
  const _PageTile({required this.page, required this.format});
  final BookPageView page;
  final BookFormat format;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final label = switch (page.type) {
      'cover' => l10n.bookPageCover,
      'chapter' => page.title ?? l10n.bookPageChapter,
      _ => l10n.bookPhotos(page.mediaCount),
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppTokens.radiusM),
            child: AspectRatio(
              aspectRatio: format.aspectRatio,
              child: page.previewUrl != null
                  ? AppImage(url: page.previewUrl!, fit: BoxFit.cover)
                  : _Placeholder(page: page, scheme: scheme),
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text('${page.index + 1} · $label', maxLines: 1, overflow: TextOverflow.ellipsis, style: text.labelSmall?.copyWith(color: scheme.onSurfaceVariant)),
      ],
    );
  }
}

/// Solange das Buch rendert: Kachel aus den Foto-Thumbnails (oder Kapitelkarte).
class _Placeholder extends StatelessWidget {
  const _Placeholder({required this.page, required this.scheme});
  final BookPageView page;
  final ColorScheme scheme;

  @override
  Widget build(BuildContext context) {
    if (page.thumbs.isEmpty) {
      return ColoredBox(
        color: scheme.surfaceContainerHigh,
        child: Center(
          child: Text(page.title ?? '', textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.labelMedium),
        ),
      );
    }
    final cols = page.thumbs.length >= 3 ? 2 : page.thumbs.length;
    return ColoredBox(
      color: scheme.surfaceContainerHigh,
      child: GridView.count(
        crossAxisCount: cols,
        padding: const EdgeInsets.all(4),
        mainAxisSpacing: 3,
        crossAxisSpacing: 3,
        physics: const NeverScrollableScrollPhysics(),
        children: [for (final t in page.thumbs) AppImage(url: t, fit: BoxFit.cover)],
      ),
    );
  }
}

/// Eigener State, damit der Controller erst nach der Schliess-Animation freigegeben wird.
class _RenameDialog extends StatefulWidget {
  const _RenameDialog({required this.initial});
  final String initial;

  @override
  State<_RenameDialog> createState() => _RenameDialogState();
}

class _RenameDialogState extends State<_RenameDialog> {
  late final _controller = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AlertDialog(
      title: Text(l10n.bookRenameTitle),
      content: TextField(controller: _controller, autofocus: true, maxLength: 80, decoration: InputDecoration(labelText: l10n.bookTitleLabel)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(l10n.commonCancel)),
        FilledButton(onPressed: () => Navigator.pop(context, _controller.text.trim()), child: Text(l10n.commonSave)),
      ],
    );
  }
}
