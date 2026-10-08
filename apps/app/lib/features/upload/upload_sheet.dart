import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app.dart' show rootMessengerKey;
import '../../l10n/l10n.dart';
import '../../theme/app_theme.dart';
import '../../widgets/glass.dart';
import 'upload_controller.dart';
import 'upload_service.dart';

/// Dateien wählen und in die Upload-Warteschlange stellen.
Future<void> pickAndUpload(BuildContext context, WidgetRef ref, String familyId) async {
  // FileType.media → accept="image/*,video/*": iOS Safari zeigt damit die Fotomediathek an und wandelt
  // HEIC beim Auswählen automatisch in JPEG um. Eine Endungsliste würde beides verhindern.
  // Der Server prüft den Typ ohnehin (415 bei nicht unterstützten Formaten).
  final l10n = context.l10n;
  final files = await FilePicker.pickFiles(dialogTitle: l10n.uploadPickTitle, type: FileType.media);
  if (files.isEmpty) return;
  ref.read(uploadControllerProvider.notifier).enqueue(familyId, files);
  // Sofortige Rückmeldung – auf iOS Safari kommt die Seite manchmal erst verzögert zurück,
  // dann ist der ursprüngliche Kontext nicht mehr gültig und das Sheet bliebe aus.
  rootMessengerKey.currentState?.showSnackBar(
    SnackBar(content: Text(l10n.uploadStarted(files.length))),
  );
  final ctx = context.mounted ? context : rootMessengerKey.currentContext;
  if (ctx != null && ctx.mounted) showUploadSheet(ctx);
}

void showUploadSheet(BuildContext context) {
  showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (_) => const _UploadSheet());
}

/// Fortschrittskarte oberhalb der Timeline, solange Uploads laufen oder Fehler offen sind.
class UploadProgressBar extends ConsumerWidget {
  const UploadProgressBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasks = ref.watch(uploadControllerProvider);
    final active = tasks.where((t) => t.status == UploadStatus.queued || t.status == UploadStatus.running).toList();
    final failed = tasks.where((t) => t.status == UploadStatus.failed).length;
    if (active.isEmpty && failed == 0) return const SizedBox.shrink();

    final scheme = Theme.of(context).colorScheme;
    final running = active.where((t) => t.status == UploadStatus.running).firstOrNull;
    final done = tasks.length - active.length;
    return Glass(
      borderRadius: BorderRadius.circular(AppTokens.radiusM),
      border: true,
      tint: active.isEmpty ? scheme.errorContainer.withValues(alpha: 0.85) : scheme.surface.withValues(alpha: 0.75),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => showUploadSheet(context),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
            child: Row(
              children: [
                Icon(active.isEmpty ? Icons.error_outline : Icons.cloud_upload_outlined, color: active.isEmpty ? scheme.onErrorContainer : scheme.primary),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        active.isEmpty
                            ? context.l10n.uploadFailedCount(failed)
                            : context.l10n.uploadProgressOf(done + 1, tasks.length, running?.fileName ?? '…'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                      ),
                      if (active.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: LinearProgressIndicator(value: running?.progress ?? 0, minHeight: 6),
                        ),
                        const SizedBox(height: 4),
                        Text(running?.phase ?? context.l10n.uploadPhaseWaiting, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant)),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                const Icon(Icons.expand_less),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _UploadSheet extends ConsumerWidget {
  const _UploadSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasks = ref.watch(uploadControllerProvider);
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.55,
      minChildSize: 0.3,
      builder: (_, controller) => Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 12, 4),
            child: Row(
              children: [
                Text(context.l10n.uploadsTitle, style: Theme.of(context).textTheme.titleLarge),
                const Spacer(),
                if (tasks.any((t) => t.status == UploadStatus.failed))
                  TextButton(
                    onPressed: () => ref.read(uploadControllerProvider.notifier).retryAllFailed(),
                    child: Text(context.l10n.uploadRetryAll),
                  ),
                if (tasks.any((t) => t.status == UploadStatus.failed))
                  TextButton(
                    onPressed: () => ref.read(uploadControllerProvider.notifier).retryAllFailed(),
                    child: Text(context.l10n.uploadRetryAll),
                  ),
                TextButton(
                  onPressed: () => ref.read(uploadControllerProvider.notifier).clearFinished(),
                  child: Text(context.l10n.uploadHideFinished),
                ),
              ],
            ),
          ),
          Expanded(
            child: tasks.isEmpty
                ? Center(child: Text(context.l10n.uploadNone, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)))
                : ListView.separated(
                    controller: controller,
                    padding: const EdgeInsets.fromLTRB(8, 0, 8, 24),
                    itemCount: tasks.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 2),
                    itemBuilder: (_, i) => _TaskTile(task: tasks[i]),
                  ),
          ),
        ],
      ),
    );
  }
}

class _TaskTile extends ConsumerWidget {
  const _TaskTile({required this.task});
  final UploadTask task;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final (icon, color) = switch (task.status) {
      UploadStatus.done => (Icons.check_circle, scheme.secondary),
      UploadStatus.duplicate => (Icons.copy_all, scheme.tertiary),
      UploadStatus.failed => (Icons.error, scheme.error),
      UploadStatus.cancelled => (Icons.cancel, scheme.outline),
      UploadStatus.running => (Icons.cloud_upload, scheme.primary),
      UploadStatus.queued => (Icons.schedule, scheme.outline),
    };
    return ListTile(
      leading: Icon(icon, color: color),
      title: Text(task.fileName, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${prettyBytes(task.sizeBytes)} · ${task.error ?? task.phase}', maxLines: 2, overflow: TextOverflow.ellipsis),
          if (task.status == UploadStatus.running) ...[
            const SizedBox(height: 6),
            ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: task.progress, minHeight: 5)),
          ],
        ],
      ),
      trailing: switch (task.status) {
        UploadStatus.running || UploadStatus.queued => IconButton(
          icon: const Icon(Icons.close),
          tooltip: context.l10n.commonCancel,
          onPressed: () => ref.read(uploadControllerProvider.notifier).cancel(task.id),
        ),
        UploadStatus.failed || UploadStatus.cancelled => IconButton(
          icon: const Icon(Icons.refresh),
          tooltip: context.l10n.commonRetry,
          onPressed: () => ref.read(uploadControllerProvider.notifier).retry(task.id),
        ),
        _ => null,
      },
    );
  }
}
