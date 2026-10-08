import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../l10n/l10n.dart';
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
    final l10n = context.l10n;
    final localeTag = context.localeTag;
    final fmt = DateFormat.yMd(localeTag).add_Hm();
    final allowed = AutoUploadController.uploadableFamilies(me);
    final mayUpload = allowed.isNotEmpty;
    // Der gespeicherte Lauf-Text kann in einer anderen Sprache entstanden sein als der aktuellen
    final offPrefixes = AppLocalizations.supportedLocales.map((l) => lookupAppLocalizations(l).autoUploadOffPrefix);

    return Card(
      child: Column(
        children: [
          SwitchListTile(
            title: Text(l10n.autoUploadToggleTitle),
            subtitle: Text(
              !mayUpload
                  ? l10n.autoUploadNeedsRight
                  : s.enabled
                  ? l10n.autoUploadEnabledSince(s.since == null ? l10n.autoUploadNow : DateFormat.yMd(localeTag).format(s.since!))
                  : l10n.autoUploadDisabledHint,
            ),
            value: s.enabled && mayUpload,
            onChanged: me == null || !mayUpload ? null : (v) => ctrl.setEnabled(v),
          ),
          if (!mayUpload && s.lastRunSummary != null && offPrefixes.any(s.lastRunSummary!.startsWith))
            ListTile(leading: Icon(Icons.info_outline, color: scheme.onSurfaceVariant), title: Text(s.lastRunSummary!, style: text.bodySmall)),
          if (s.enabled && mayUpload) ...[
            if (allowed.length > 1)
              ListTile(
                leading: const Icon(Icons.photo_album_outlined),
                title: Text(l10n.autoUploadTargetAlbum),
                trailing: DropdownButton<String>(
                  value: allowed.any((f) => f.id == s.familyId) ? s.familyId : allowed.first.id,
                  underline: const SizedBox.shrink(),
                  items: [for (final f in allowed) DropdownMenuItem(value: f.id, child: Text(f.name))],
                  onChanged: (id) => id == null ? null : ctrl.setFamily(id),
                ),
              ),
            SwitchListTile(
              secondary: const Icon(Icons.wifi),
              title: Text(l10n.autoUploadWifiOnly),
              value: s.wifiOnly,
              onChanged: (v) => ctrl.setWifiOnly(v),
            ),
            SwitchListTile(
              secondary: const Icon(Icons.videocam_outlined),
              title: Text(l10n.autoUploadIncludeVideos),
              value: s.includeVideos,
              onChanged: (v) => ctrl.setIncludeVideos(v),
            ),
            ListTile(
              leading: const Icon(Icons.history),
              title: Text(l10n.autoUploadBackfillSince),
              subtitle: Text(s.since == null ? '–' : DateFormat.yMd(localeTag).format(s.since!)),
              onTap: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: s.since ?? DateTime.now(),
                  firstDate: DateTime(2000),
                  lastDate: DateTime.now(),
                  locale: Localizations.localeOf(context),
                );
                if (picked != null) await ctrl.setSince(picked);
              },
            ),
            const Divider(height: 1),
            ListTile(
              leading: state.running
                  ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2))
                  : Icon(state.lastError != null ? Icons.error_outline : Icons.cloud_done_outlined, color: state.lastError != null ? scheme.error : null),
              title: Text(state.running ? l10n.autoUploadSyncing : (state.lastError ?? s.lastRunSummary ?? l10n.autoUploadNotRunYet)),
              subtitle: Text(
                [
                  if (s.lastRunAt != null) l10n.autoUploadLastRun(fmt.format(s.lastRunAt!)),
                  if (s.uploadedCount > 0) l10n.autoUploadTotalUploaded(s.uploadedCount),
                ].join(' · '),
                style: text.bodySmall,
              ),
              trailing: TextButton(onPressed: state.running ? null : () => ctrl.runNow(), child: Text(l10n.autoUploadRunNow)),
            ),
          ],
        ],
      ),
    );
  }
}
