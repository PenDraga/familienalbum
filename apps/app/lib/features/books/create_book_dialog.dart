import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/api_exception.dart';
import '../../l10n/l10n.dart';
import 'book_models.dart';
import 'books_repository.dart';

/// Was der Dialog zurückgibt; der Aufrufer schickt es an den Server.
class BookRequest {
  const BookRequest({required this.months, required this.format, required this.textMode, required this.onlyCommented, required this.title});
  final List<String> months;
  final BookFormat format;
  final BookTextMode textMode;
  final bool onlyCommented;
  final String? title;
}

/// Fotobuch erstellen: Jahr und Monate, Format, Texte. Der Server macht den Layoutvorschlag und rendert das PDF.
Future<void> showCreateBookDialog(BuildContext context, WidgetRef ref, String familyId) async {
  final l10n = context.l10n;
  final request = await showDialog<BookRequest>(context: context, builder: (_) => const CreateBookDialog());
  if (request == null || !context.mounted) return;
  final messenger = ScaffoldMessenger.of(context);
  try {
    final book = await ref.read(booksRepositoryProvider).create(familyId, months: request.months, format: request.format, textMode: request.textMode, onlyCommented: request.onlyCommented, title: request.title);
    ref.invalidate(booksProvider);
    messenger.showSnackBar(SnackBar(content: Text(l10n.bookCreateStarted(book.title, book.pageCount))));
    if (context.mounted) context.push('/books/${book.id}');
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(errorMessage(e))));
  }
}

class CreateBookDialog extends StatefulWidget {
  const CreateBookDialog({super.key});

  @override
  State<CreateBookDialog> createState() => _CreateBookDialogState();
}

class _CreateBookDialogState extends State<CreateBookDialog> {
  final _now = DateTime.now();
  late int _year;
  final _selected = <int>{};
  var _format = BookFormat.square21;
  var _textMode = BookTextMode.captions;
  var _onlyCommented = false;
  final _title = TextEditingController();

  @override
  void initState() {
    super.initState();
    // Vorgabe: alle Monate des Jahres bis zum Vormonat; im Januar das ganze Vorjahr
    _year = _now.month == 1 ? _now.year - 1 : _now.year;
    _selectDefaultMonths();
  }

  void _selectDefaultMonths() {
    _selected
      ..clear()
      ..addAll([for (var m = 1; m <= 12; m++) if (_year < _now.year || m < _now.month) m]);
  }

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final monthName = DateFormat.MMM(context.localeTag);
    return AlertDialog(
      title: Text(l10n.bookCreateTitle),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(l10n.bookPeriod, style: text.labelLarge),
                  const Spacer(),
                  DropdownButton<int>(
                    value: _year,
                    underline: const SizedBox.shrink(),
                    items: [for (var y = _now.year; y >= _now.year - 30; y--) DropdownMenuItem(value: y, child: Text('$y'))],
                    onChanged: (v) => setState(() {
                      _year = v ?? _year;
                      _selectDefaultMonths();
                    }),
                  ),
                ],
              ),
              Wrap(
                spacing: 6,
                runSpacing: 2,
                children: [
                  for (var m = 1; m <= 12; m++)
                    FilterChip(
                      label: Text(monthName.format(DateTime(2000, m))),
                      selected: _selected.contains(m),
                      visualDensity: VisualDensity.compact,
                      onSelected: (on) => setState(() => on ? _selected.add(m) : _selected.remove(m)),
                    ),
                ],
              ),
              const SizedBox(height: 14),
              Text(l10n.bookFormat, style: text.labelLarge),
              const SizedBox(height: 4),
              Wrap(
                spacing: 6,
                runSpacing: 2,
                children: [
                  for (final f in BookFormat.values)
                    ChoiceChip(label: Text(f.label(l10n)), selected: _format == f, visualDensity: VisualDensity.compact, onSelected: (_) => setState(() => _format = f)),
                ],
              ),
              const SizedBox(height: 14),
              Text(l10n.bookTexts, style: text.labelLarge),
              const SizedBox(height: 4),
              Wrap(
                spacing: 6,
                runSpacing: 2,
                children: [
                  for (final t in BookTextMode.values)
                    ChoiceChip(label: Text(t.label(l10n)), selected: _textMode == t, visualDensity: VisualDensity.compact, onSelected: (_) => setState(() => _textMode = t)),
                ],
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(l10n.bookOnlyCommented),
                value: _onlyCommented,
                onChanged: (v) => setState(() => _onlyCommented = v),
              ),
              TextField(
                controller: _title,
                decoration: InputDecoration(labelText: l10n.bookTitleLabel, hintText: l10n.bookTitleHint),
                textCapitalization: TextCapitalization.sentences,
                maxLength: 80,
              ),
              Text(l10n.bookCreateHint, style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(l10n.commonCancel)),
        FilledButton(
          onPressed: _selected.isEmpty
              ? null
              : () => Navigator.pop(
                  context,
                  BookRequest(
                    months: (_selected.toList()..sort()).map((m) => '$_year-${m.toString().padLeft(2, '0')}').toList(),
                    format: _format,
                    textMode: _textMode,
                    onlyCommented: _onlyCommented,
                    title: _title.text.trim().isEmpty ? null : _title.text.trim(),
                  ),
                ),
          child: Text(l10n.commonCreate),
        ),
      ],
    );
  }
}
