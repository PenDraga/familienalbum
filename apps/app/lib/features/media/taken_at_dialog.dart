import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'media_info.dart';

/// Dialog „Datum und Uhrzeit ändern“: entweder auf einen Zeitpunkt setzen oder um Tage/Stunden/Minuten verschieben.
/// [samples] sind Beispiel-Zeitpunkte (z.B. das aktuelle Medium oder das erste/letzte der Auswahl) für die Vorschau.
Future<TakenAtChange?> showTakenAtDialog(BuildContext context, {required List<DateTime> samples, int count = 1}) {
  return showDialog<TakenAtChange>(
    context: context,
    builder: (_) => _TakenAtDialog(samples: samples, count: count),
  );
}

class _TakenAtDialog extends StatefulWidget {
  const _TakenAtDialog({required this.samples, required this.count});
  final List<DateTime> samples;
  final int count;

  @override
  State<_TakenAtDialog> createState() => _TakenAtDialogState();
}

class _TakenAtDialogState extends State<_TakenAtDialog> {
  bool _shift = false;
  late DateTime _value = (widget.samples.firstOrNull ?? DateTime.now()).toLocal();
  bool _earlier = false;
  final _days = TextEditingController(text: '0');
  final _hours = TextEditingController(text: '0');
  final _minutes = TextEditingController(text: '0');

  static final _date = DateFormat.yMMMd('de_CH');
  static final _time = DateFormat.Hm('de_CH');
  static final _full = DateFormat('dd.MM.yyyy, HH:mm', 'de_CH');

  @override
  void dispose() {
    _days.dispose();
    _hours.dispose();
    _minutes.dispose();
    super.dispose();
  }

  Duration get _shiftBy {
    final d = int.tryParse(_days.text.trim()) ?? 0;
    final h = int.tryParse(_hours.text.trim()) ?? 0;
    final m = int.tryParse(_minutes.text.trim()) ?? 0;
    final total = Duration(days: d, hours: h, minutes: m);
    return _earlier ? -total : total;
  }

  TakenAtChange? get _result {
    if (_shift) {
      final by = _shiftBy;
      return by == Duration.zero ? null : TakenAtShift(by);
    }
    return TakenAtSet(_value);
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _value,
      firstDate: DateTime(1900),
      lastDate: DateTime.now().add(const Duration(days: 365)),
      locale: const Locale('de', 'CH'),
    );
    if (picked == null) return;
    setState(() => _value = DateTime(picked.year, picked.month, picked.day, _value.hour, _value.minute, _value.second));
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_value),
      builder: (ctx, child) => MediaQuery(data: MediaQuery.of(ctx).copyWith(alwaysUse24HourFormat: true), child: child!),
    );
    if (picked == null) return;
    setState(() => _value = DateTime(_value.year, _value.month, _value.day, picked.hour, picked.minute));
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final result = _result;
    final many = widget.count > 1;

    return AlertDialog(
      title: Text(many ? 'Datum für ${widget.count} Medien' : 'Datum und Uhrzeit'),
      content: SizedBox(
        width: 380,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SegmentedButton<bool>(
              segments: const [
                ButtonSegment(value: false, icon: Icon(Icons.event), label: Text('Setzen')),
                ButtonSegment(value: true, icon: Icon(Icons.update), label: Text('Verschieben')),
              ],
              selected: {_shift},
              onSelectionChanged: (s) => setState(() => _shift = s.first),
              showSelectedIcon: false,
            ),
            const SizedBox(height: 16),
            if (!_shift) ...[
              Row(
                children: [
                  Expanded(
                    child: _PickerField(icon: Icons.calendar_today_outlined, label: 'Datum', value: _date.format(_value), onTap: _pickDate),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _PickerField(icon: Icons.schedule_outlined, label: 'Uhrzeit', value: _time.format(_value), onTap: _pickTime),
                  ),
                ],
              ),
              if (many) ...[
                const SizedBox(height: 10),
                Text('Alle ausgewählten Medien erhalten denselben Zeitpunkt.', style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
              ],
            ] else ...[
              SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: false, icon: Icon(Icons.add), label: Text('Später')),
                  ButtonSegment(value: true, icon: Icon(Icons.remove), label: Text('Früher')),
                ],
                selected: {_earlier},
                onSelectionChanged: (s) => setState(() => _earlier = s.first),
                showSelectedIcon: false,
                style: const ButtonStyle(visualDensity: VisualDensity.compact),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: _NumberField(controller: _days, label: 'Tage', onChanged: () => setState(() {}))),
                  const SizedBox(width: 10),
                  Expanded(child: _NumberField(controller: _hours, label: 'Stunden', onChanged: () => setState(() {}))),
                  const SizedBox(width: 10),
                  Expanded(child: _NumberField(controller: _minutes, label: 'Minuten', onChanged: () => setState(() {}))),
                ],
              ),
              const SizedBox(height: 12),
              if (widget.samples.isNotEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(color: scheme.surfaceContainerHighest.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(10)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Vorschau', style: text.labelSmall?.copyWith(color: scheme.onSurfaceVariant)),
                      const SizedBox(height: 4),
                      for (final s in widget.samples.take(2))
                        Text(
                          '${_full.format(s.toLocal())}  →  ${_full.format(s.toLocal().add(_shiftBy))}',
                          style: text.bodySmall,
                        ),
                    ],
                  ),
                ),
              const SizedBox(height: 6),
              Text(
                'Praktisch bei falscher Zeitzone oder verstellter Kamera-Uhr: Die Abstände zwischen den Aufnahmen bleiben erhalten.',
                style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Abbrechen')),
        FilledButton(
          onPressed: result == null ? null : () => Navigator.pop(context, result),
          // Theme-Buttons sind volle Breite; im Dialog kompakt neben „Abbrechen“
          style: FilledButton.styleFrom(minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: 18)),
          child: const Text('Übernehmen'),
        ),
      ],
    );
  }
}

class _PickerField extends StatelessWidget {
  const _PickerField({required this.icon, required this.label, required this.value, required this.onTap});
  final IconData icon;
  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: InputDecorator(
        decoration: InputDecoration(labelText: label, prefixIcon: Icon(icon), border: const OutlineInputBorder()),
        child: Text(value),
      ),
    );
  }
}

class _NumberField extends StatelessWidget {
  const _NumberField({required this.controller, required this.label, required this.onChanged});
  final TextEditingController controller;
  final String label;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: TextInputType.number,
      textAlign: TextAlign.center,
      decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
      onChanged: (_) => onChanged(),
      onTap: () => controller.selection = TextSelection(baseOffset: 0, extentOffset: controller.text.length),
    );
  }
}
