import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/api_exception.dart';
import '../../l10n/l10n.dart';
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
  final l10n = context.l10n;
  final monthName = DateFormat.MMMM(context.localeTag);

  final result = await showDialog<(RecapKind, String)>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) => AlertDialog(
        title: Text(l10n.recapCreateTitle),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SegmentedButton<RecapKind>(
              segments: [
                ButtonSegment(value: RecapKind.month, label: Text(l10n.recapMonth)),
                ButtonSegment(value: RecapKind.year, label: Text(l10n.recapYear)),
                ButtonSegment(value: RecapKind.seconds, label: Text(l10n.recapSeconds)),
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
                      decoration: InputDecoration(labelText: l10n.recapMonth),
                      items: [for (var i = 1; i <= 12; i++) DropdownMenuItem(value: i, child: Text(monthName.format(DateTime(2000, i))))],
                      onChanged: (v) => setState(() => month = v ?? month),
                    ),
                  ),
                  const SizedBox(width: 12),
                ],
                SizedBox(
                  width: kind == RecapKind.year ? 160 : 100,
                  child: DropdownButtonFormField<int>(
                    initialValue: year,
                    decoration: InputDecoration(labelText: l10n.recapYear),
                    items: [for (var y = now.year; y >= now.year - 30; y--) DropdownMenuItem(value: y, child: Text('$y'))],
                    onChanged: (v) => setState(() => year = v ?? year),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              switch (kind) {
                RecapKind.month => l10n.recapDescMonth,
                RecapKind.year => l10n.recapDescYear,
                RecapKind.seconds => l10n.recapDescSeconds,
              },
              style: Theme.of(ctx).textTheme.bodySmall?.copyWith(color: Theme.of(ctx).colorScheme.onSurfaceVariant),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(l10n.commonCancel)),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, (kind, kind == RecapKind.year ? '$year' : '$year-${month.toString().padLeft(2, '0')}')),
            child: Text(l10n.commonCreate),
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
    messenger.showSnackBar(SnackBar(content: Text(l10n.recapCreateStarted(recap.title))));
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(errorMessage(e))));
  }
}
