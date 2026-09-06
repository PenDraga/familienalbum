import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_exception.dart';
import 'recap_models.dart';
import 'recaps_repository.dart';

/// Rückblick erstellen: Art (Monat / Jahr / Sekunden-Film) und Zeitraum wählen.
Future<void> showCreateRecapDialog(BuildContext context, WidgetRef ref, String familyId) async {
  final now = DateTime.now();
  // Vorgabe: der Vormonat (der laufende ist meist noch unvollständig)
  final prev = DateTime(now.year, now.month - 1);
  var kind = RecapKind.month;
  var year = prev.year;
  var month = prev.month;
  const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  final result = await showDialog<(RecapKind, String)>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) => AlertDialog(
        title: const Text('Rückblick erstellen'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SegmentedButton<RecapKind>(
              segments: const [
                ButtonSegment(value: RecapKind.month, label: Text('Monat')),
                ButtonSegment(value: RecapKind.year, label: Text('Jahr')),
                ButtonSegment(value: RecapKind.seconds, label: Text('Sekunden')),
              ],
              selected: {kind},
              onSelectionChanged: (s) => setState(() => kind = s.first),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                if (kind != RecapKind.year) ...[
                  Expanded(
                    child: DropdownButtonFormField<int>(
                      initialValue: month,
                      decoration: const InputDecoration(labelText: 'Monat'),
                      items: [for (var i = 1; i <= 12; i++) DropdownMenuItem(value: i, child: Text(months[i - 1]))],
                      onChanged: (v) => setState(() => month = v ?? month),
                    ),
                  ),
                  const SizedBox(width: 12),
                ],
                SizedBox(
                  width: kind == RecapKind.year ? 160 : 100,
                  child: DropdownButtonFormField<int>(
                    initialValue: year,
                    decoration: const InputDecoration(labelText: 'Jahr'),
                    items: [for (var y = now.year; y >= now.year - 30; y--) DropdownMenuItem(value: y, child: Text('$y'))],
                    onChanged: (v) => setState(() => year = v ?? year),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              switch (kind) {
                RecapKind.month => 'Rund 30 Momente des Monats mit sanfter Kamerafahrt, Musik und Titelkarte. Etwa anderthalb Minuten.',
                RecapKind.year => 'Rund 60 Momente des Jahres, gleichmässig über die Wochen verteilt. Etwa zwei Minuten.',
                RecapKind.seconds => 'Ein Moment pro Tag, je eine Sekunde – der ganze Monat im Zeitraffer.',
              },
              style: Theme.of(ctx).textTheme.bodySmall?.copyWith(color: Theme.of(ctx).colorScheme.onSurfaceVariant),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Abbrechen')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, (kind, kind == RecapKind.year ? '$year' : '$year-${month.toString().padLeft(2, '0')}')),
            child: const Text('Erstellen'),
          ),
        ],
      ),
    ),
  );
  if (result == null || !context.mounted) return;
  final messenger = ScaffoldMessenger.of(context);
  try {
    final recap = await ref.read(recapsRepositoryProvider).create(familyId, result.$1, result.$2);
    ref.invalidate(recapsProvider);
    messenger.showSnackBar(SnackBar(content: Text('«${recap.title}» wird erstellt – du bekommst eine Mitteilung, sobald das Video fertig ist.')));
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(errorMessage(e))));
  }
}
