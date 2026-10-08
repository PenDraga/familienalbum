import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/api_exception.dart';
import '../../l10n/l10n.dart';
import '../../theme/app_theme.dart';
import '../../widgets/emoji_text.dart';
import '../../widgets/user_avatar.dart';
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
  final _input = EmojiTextEditingController();
  final _inputFocus = FocusNode();
  final _scroll = ScrollController();
  final _sheet = DraggableScrollableController();
  List<CommentItem>? _comments;
  String? _error;
  bool _sending = false;
  int? _changedCount;

  /// Kommentar, der gerade im Eingabefeld bearbeitet wird (null = neuer Kommentar).
  CommentItem? _editing;

  @override
  void initState() {
    super.initState();
    // Beim Tippen das Sheet ausfahren, damit über der Tastatur genug Platz für die Liste bleibt
    _inputFocus.addListener(() {
      if (_inputFocus.hasFocus && _sheet.isAttached && _sheet.size < 0.9) {
        _sheet.animateTo(
          0.95,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
        );
      }
    });
    _load();
  }

  @override
  void dispose() {
    _input.dispose();
    _inputFocus.dispose();
    _scroll.dispose();
    _sheet.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final list = await ref
          .read(commentsRepositoryProvider)
          .list(widget.item.id);
      if (mounted) setState(() => _comments = list);
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(e));
    }
  }

  void _startEdit(CommentItem c) {
    setState(() {
      _editing = c;
      _input.text = c.body;
      _input.selection = TextSelection.collapsed(offset: c.body.length);
    });
    _inputFocus.requestFocus();
  }

  void _cancelEdit() {
    setState(() {
      _editing = null;
      _input.clear();
    });
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final editing = _editing;
      if (editing != null) {
        final updated = await ref
            .read(commentsRepositoryProvider)
            .update(editing.id, text);
        _input.clear();
        setState(() {
          _editing = null;
          _comments = _comments!
              .map((x) => x.id == updated.id ? updated : x)
              .toList();
        });
        return;
      }
      final c = await ref
          .read(commentsRepositoryProvider)
          .create(widget.item.id, text);
      _input.clear();
      setState(() {
        _comments = [...?_comments, c];
        _changedCount = _comments!.length;
      });
      await Future<void>.delayed(const Duration(milliseconds: 50));
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(errorMessage(e))));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _delete(CommentItem c) async {
    final l10n = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.commentsDeleteTitle),
        content: Text(c.body, maxLines: 4, overflow: TextOverflow.ellipsis),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(l10n.commonCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(l10n.commonDelete),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(commentsRepositoryProvider).delete(c.id);
      setState(() {
        if (_editing?.id == c.id) {
          _editing = null;
          _input.clear();
        }
        _comments = _comments!.where((x) => x.id != c.id).toList();
        _changedCount = _comments!.length;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(errorMessage(e))));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final l10n = context.l10n;
    final me = ref.watch(meProvider);
    final family = ref.watch(selectedFamilyProvider);
    final canComment = family?.membership.canComment ?? false;
    final comments = _comments;
    // Admins ohne canComment dürfen trotzdem bearbeiten – dann braucht es das Eingabefeld ebenfalls
    final showInput = canComment || _editing != null;

    // Die Tastatur verkleinert den Platz fürs ganze Sheet (statt nur das Eingabefeld zu verschieben),
    // sonst schiebt das Feld die Liste zusammen und rutscht hinter die Tastatur.
    return AnimatedPadding(
      duration: const Duration(milliseconds: 150),
      curve: Curves.easeOut,
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: DraggableScrollableSheet(
        controller: _sheet,
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
                  Text(l10n.commentsTitle, style: text.titleLarge),
                  if (comments != null && comments.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Text(
                      '${comments.length}',
                      style: text.labelLarge?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                  const Spacer(),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.of(context).pop(_changedCount),
                  ),
                ],
              ),
            ),
            const Divider(),
            Expanded(
              child: _error != null
                  ? Center(
                      child: Text(
                        _error!,
                        style: TextStyle(color: scheme.error),
                      ),
                    )
                  : comments == null
                  ? const Center(child: CircularProgressIndicator())
                  : comments.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(32),
                        child: Text(
                          canComment
                              ? l10n.commentsEmptyWrite
                              : l10n.commentsEmpty,
                          style: text.bodyMedium?.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
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
                        isEditing: _editing?.id == comments[i].id,
                        onEdit: comments[i].canEdit
                            ? () => _startEdit(comments[i])
                            : null,
                        onDelete: comments[i].canDelete
                            ? () => _delete(comments[i])
                            : null,
                      ),
                    ),
            ),
            if (showInput)
              Container(
                padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainer,
                  border: Border(top: BorderSide(color: scheme.outlineVariant)),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (_editing != null)
                      Padding(
                        padding: const EdgeInsets.only(left: 4, bottom: 4),
                        child: Row(
                          children: [
                            Icon(
                              Icons.edit_outlined,
                              size: 16,
                              color: scheme.primary,
                            ),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                l10n.commentsEditing(_editing!.authorName),
                                style: text.labelMedium?.copyWith(
                                  color: scheme.primary,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            TextButton(
                              onPressed: _sending ? null : _cancelEdit,
                              child: Text(l10n.commonCancel),
                            ),
                          ],
                        ),
                      ),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _input,
                            focusNode: _inputFocus,
                            minLines: 1,
                            maxLines: 4,
                            maxLength: 2000,
                            textCapitalization: TextCapitalization.sentences,
                            decoration: InputDecoration(
                              hintText: _editing != null
                                  ? l10n.commentsNewTextHint
                                  : l10n.commentsWriteHint,
                              counterText: '',
                              isDense: true,
                              fillColor: scheme.surfaceContainerLowest,
                              border: const OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(999)), borderSide: BorderSide.none),
                              enabledBorder: const OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(999)), borderSide: BorderSide.none),
                              focusedBorder: OutlineInputBorder(borderRadius: const BorderRadius.all(Radius.circular(999)), borderSide: BorderSide(color: scheme.secondary, width: 1.6)),
                            ),
                            onSubmitted: (_) => _send(),
                          ),
                        ),
                        const SizedBox(width: 6),
                        IconButton.filled(
                          onPressed: _sending ? null : _send,
                          style: IconButton.styleFrom(backgroundColor: scheme.secondary, foregroundColor: scheme.onSecondary, minimumSize: const Size(48, 48)),
                          tooltip: _editing != null ? l10n.commonSave : l10n.commentsSend,
                          icon: _sending
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : Icon(
                                  _editing != null
                                      ? Icons.check_rounded
                                      : Icons.send_rounded,
                                ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _CommentBubble extends StatelessWidget {
  const _CommentBubble({
    required this.comment,
    required this.isMine,
    this.isEditing = false,
    this.onEdit,
    this.onDelete,
  });
  final CommentItem comment;
  final bool isMine;
  final bool isEditing;
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final when = DateFormat.MMMd(context.localeTag)
        .add_Hm()
        .format(comment.createdAt.toLocal());

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          UserAvatar(
            name: comment.authorName,
            avatarUrl: comment.authorAvatarUrl,
            size: 36,
            color: isMine ? scheme.primary : scheme.secondary,
            foregroundColor: isMine ? scheme.onPrimary : scheme.onSecondary,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Container(
              padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
              decoration: BoxDecoration(
                color: isEditing ? scheme.primaryContainer.withValues(alpha: 0.5) : scheme.surfaceContainerLowest,
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(6),
                  topRight: Radius.circular(AppTokens.radiusL),
                  bottomLeft: Radius.circular(AppTokens.radiusL),
                  bottomRight: Radius.circular(AppTokens.radiusL),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: RichText(
                          text: TextSpan(
                            style: text.labelMedium?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                            children: [
                              TextSpan(
                                text: comment.authorName,
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                  color: scheme.onSurface,
                                ),
                              ),
                              TextSpan(text: '  $when'),
                              if (comment.editedAt != null)
                                TextSpan(text: ' · ${context.l10n.commentsEdited}'),
                            ],
                          ),
                        ),
                      ),
                      if (onEdit != null)
                        SizedBox(
                          height: 28,
                          width: 28,
                          child: IconButton(
                            padding: EdgeInsets.zero,
                            iconSize: 18,
                            tooltip: context.l10n.commentsEdit,
                            icon: const Icon(Icons.edit_outlined),
                            onPressed: onEdit,
                          ),
                        ),
                      if (onDelete != null)
                        SizedBox(
                          height: 28,
                          width: 28,
                          child: IconButton(
                            padding: EdgeInsets.zero,
                            iconSize: 18,
                            tooltip: context.l10n.commonDelete,
                            icon: const Icon(Icons.delete_outline),
                            onPressed: onDelete,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  EmojiText(comment.body, style: text.bodyMedium),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
