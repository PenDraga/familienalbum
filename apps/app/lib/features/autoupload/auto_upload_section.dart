import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../auth/auth_controller.dart';
import 'auto_upload_controller.dart';
import 'auto_upload_service.dart';

/// Einstellungs-Abschnitt „Automatischer Upload“ (nur Android/iOS).
class AutoUploadSection extends ConsumerWidget {
  const AutoUploadSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!AutoUploadService.platformSupported) return const SizedBox.shrink();
    final state = ref.watch(autoUploadControllerProvider);
    final ctrl = ref.read(autoUploadControllerProvider.notifier);
    final me = ref.watch(meProvider);
    final s = state.settings;
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final fmt = DateFormat.yMd('de_CH').add_Hm();

    return Card(
      child: Column(
        children: [
          SwitchListTile(
            title: const Text('Neue Fotos automatisch hochladen'),
            subtitle: Text(
              s.enabled
                  ? 'Aufnahmen ab ${s.since == null ? 'jetzt' : DateFormat.yMd('de_CH').format(s.since!)} werden im Hintergrund hochgeladen.'
                  : 'Lädt neue Aufnahmen aus der Galerie hoch, ohne dass du daran denken musst.',
            ),
            value: s.enabled,
            onChanged: me == null ? null : (v) => ctrl.setEnabled(v),
          ),
          if (s.enabled) ...[
            if (me != null && me.families.length > 1)
              ListTile(
                leading: const Icon(Icons.family_restroom),
                title: const Text('In diese Familie'),
                trailing: DropdownButton<String>(
                  value: me.families.any((f) => f.id == s.familyId) ? s.familyId : me.families.first.id,
                  underline: const SizedBox.shrink(),
                  items: [for (final f in me.families) DropdownMenuItem(value: f.id, child: Text(f.name))],
                  onChanged: (id) => id == null ? null : ctrl.setFamily(id),
                ),
              ),
            SwitchListTile(
              secondary: const Icon(Icons.wifi),
              title: const Text('Nur im WLAN'),
              value: s.wifiOnly,
              onChanged: (v) => ctrl.setWifiOnly(v),
            ),
            SwitchListTile(
              secondary: const Icon(Icons.videocam_outlined),
              title: const Text('Videos einschliessen'),
              value: s.includeVideos,
              onChanged: (v) => ctrl.setIncludeVideos(v),
            ),
            ListTile(
              leading: const Icon(Icons.history),
              title: const Text('Ältere Aufnahmen ab Datum nachladen'),
              subtitle: Text(s.since == null ? '–' : DateFormat.yMd('de_CH').format(s.since!)),
              onTap: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: s.since ?? DateTime.now(),
                  firstDate: DateTime(2000),
                  lastDate: DateTime.now(),
                  locale: const Locale('de', 'CH'),
                );
                if (picked != null) await ctrl.setSince(picked);
              },
            ),
            const Divider(height: 1),
            ListTile(
              leading: state.running
                  ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2))
                  : Icon(state.lastError != null ? Icons.error_outline : Icons.cloud_done_outlined, color: state.lastError != null ? scheme.error : null),
              title: Text(state.running ? 'Synchronisiert …' : (state.lastError ?? s.lastRunSummary ?? 'Noch nicht gelaufen')),
              subtitle: Text(
                [
                  if (s.lastRunAt != null) 'Zuletzt ${fmt.format(s.lastRunAt!)}',
                  if (s.uploadedCount > 0) '${s.uploadedCount} insgesamt hochgeladen',
                ].join(' · '),
                style: text.bodySmall,
              ),
              trailing: TextButton(onPressed: state.running ? null : () => ctrl.runNow(), child: const Text('Jetzt')),
            ),
          ],
        ],
      ),
    );
  }
}
