import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/api_exception.dart';
import '../../theme/app_theme.dart';
import '../auth/auth_controller.dart';
import '../timeline/media_model.dart';
import 'comments_repository.dart';

/// Öffnet das Kommentar-Sheet. Liefert die neue Kommentaranzahl zurück (oder null, wenn unverändert).
Future<int?> showCommentsSheet(BuildContext context, MediaItem item) {
  return showModalBottomSheet<int?>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => _CommentsSheet(item: item),
  );
}

class _CommentsSheet extends ConsumerStatefulWidget {
  const _CommentsSheet({required this.item});
  final MediaItem item;

  @override
  ConsumerState<_CommentsSheet> createState() => _CommentsSheetState();
}

class _CommentsSheetState extends ConsumerState<_CommentsSheet> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  List<CommentItem>? _comments;
  String? _error;
  bool _sending = false;
  int? _changedCount;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final list = await ref.read(commentsRepositoryProvider).list(widget.item.id);
      if (mounted) setState(() => _comments = list);
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(e));
    }
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final c = await ref.read(commentsRepositoryProvider).create(widget.item.id, text);
      _input.clear();
      setState(() {
        _comments = [...?_comments, c];
        _changedCount = _comments!.length;
      });
      await Future<void>.delayed(const Duration(milliseconds: 50));
      if (_scroll.hasClients) {
        _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(e))));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _delete(CommentItem c) async {
    try {
      await ref.read(commentsRepositoryProvider).delete(c.id);
      setState(() {
        _comments = _comments!.where((x) => x.id != c.id).toList();
        _changedCount = _comments!.length;
      });
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final me = ref.watch(meProvider);
    final family = ref.watch(selectedFamilyProvider);
    final canComment = family?.membership.canComment ?? false;
    final comments = _comments;

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
      minChildSize: 0.35,
      maxChildSize: 0.95,
      builder: (_, scrollController) => Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 8, 4),
            child: Row(
              children: [
                Text('Kommentare', style: text.titleLarge),
                if (comments != null && comments.isNotEmpty) ...[
                  const SizedBox(width: 8),
                  Text('${comments.length}', style: text.labelLarge?.copyWith(color: scheme.onSurfaceVariant)),
                ],
                const Spacer(),
                IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.of(context).pop(_changedCount)),
              ],
            ),
          ),
          const Divider(),
          Expanded(
            child: _error != null
                ? Center(
                    child: Text(_error!, style: TextStyle(color: scheme.error)),
                  )
                : comments == null
                ? const Center(child: CircularProgressIndicator())
                : comments.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(32),
                      child: Text(
                        canComment ? 'Noch keine Kommentare. Schreib den ersten!' : 'Noch keine Kommentare.',
                        style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  )
                : ListView.builder(
                    controller: scrollController,
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                    itemCount: comments.length,
                    itemBuilder: (_, i) => _CommentBubble(
                      comment: comments[i],
                      isMine: comments[i].authorId == me?.id,
                      onDelete: comments[i].canDelete ? () => _delete(comments[i]) : null,
                    ),
                  ),
          ),
          if (canComment)
            Container(
              padding: EdgeInsets.fromLTRB(12, 8, 8, 8 + MediaQuery.viewInsetsOf(context).bottom),
              decoration: BoxDecoration(
                color: scheme.surfaceContainer,
                border: Border(top: BorderSide(color: scheme.outlineVariant)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _input,
                      minLines: 1,
                      maxLines: 4,
                      maxLength: 2000,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(hintText: 'Kommentar schreiben …', counterText: '', isDense: true),
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                  const SizedBox(width: 6),
                  IconButton.filled(
                    onPressed: _sending ? null : _send,
                    icon: _sending
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.send_rounded),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _CommentBubble extends StatelessWidget {
  const _CommentBubble({required this.comment, required this.isMine, this.onDelete});
  final CommentItem comment;
  final bool isMine;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final when = DateFormat.MMMd('de_CH').add_Hm().format(comment.createdAt.toLocal());

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 16,
            backgroundColor: isMine ? scheme.primaryContainer : scheme.secondaryContainer,
            foregroundColor: isMine ? scheme.onPrimaryContainer : scheme.onSecondaryContainer,
            child: Text(comment.authorName.isNotEmpty ? comment.authorName[0].toUpperCase() : '?', style: text.labelLarge),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Container(
              padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
              decoration: BoxDecoration(color: scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(AppTokens.radiusM)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: RichText(
                          text: TextSpan(
                            style: text.labelMedium?.copyWith(color: scheme.onSurfaceVariant),
                            children: [
                              TextSpan(
                                text: comment.authorName,
                                style: TextStyle(fontWeight: FontWeight.w700, color: scheme.onSurface),
                              ),
                              TextSpan(text: '  $when'),
                            ],
                          ),
                        ),
                      ),
                      if (onDelete != null)
                        SizedBox(
                          height: 28,
                          width: 28,
                          child: IconButton(
                            padding: EdgeInsets.zero,
                            iconSize: 18,
                            tooltip: 'Löschen',
                            icon: const Icon(Icons.delete_outline),
                            onPressed: onDelete,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(comment.body, style: text.bodyMedium),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
