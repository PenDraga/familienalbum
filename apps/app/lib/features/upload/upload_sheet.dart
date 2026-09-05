import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../theme/app_theme.dart';
import 'upload_controller.dart';
import 'upload_service.dart';

/// Dateien wählen und in die Upload-Warteschlange stellen.
Future<void> pickAndUpload(BuildContext context, WidgetRef ref, String familyId) async {
  // FileType.media → accept="image/*,video/*": iOS Safari zeigt damit die Fotomediathek an und wandelt
  // HEIC beim Auswählen automatisch in JPEG um. Eine Endungsliste würde beides verhindern.
  // Der Server prüft den Typ ohnehin (415 bei nicht unterstützten Formaten).
  final files = await FilePicker.pickFiles(dialogTitle: 'Fotos und Videos auswählen', type: FileType.media);
  if (files.isEmpty) return;
  ref.read(uploadControllerProvider.notifier).enqueue(familyId, files);
  if (context.mounted) showUploadSheet(context);
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
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Material(
        color: active.isEmpty ? scheme.errorContainer : scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(AppTokens.radiusM),
        clipBehavior: Clip.antiAlias,
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
                            ? '$failed Upload${failed == 1 ? '' : 's'} fehlgeschlagen'
                            : '${done + 1} von ${tasks.length}: ${running?.fileName ?? '…'}',
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
                        Text(running?.phase ?? 'Wartet', style: Theme.of(context).textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant)),
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
                Text('Uploads', style: Theme.of(context).textTheme.titleLarge),
                const Spacer(),
                if (tasks.any((t) => t.status == UploadStatus.failed))
                  TextButton(
                    onPressed: () => ref.read(uploadControllerProvider.notifier).retryAllFailed(),
                    child: const Text('Alle wiederholen'),
                  ),
                if (tasks.any((t) => t.status == UploadStatus.failed))
                  TextButton(
                    onPressed: () => ref.read(uploadControllerProvider.notifier).retryAllFailed(),
                    child: const Text('Alle wiederholen'),
                  ),
                TextButton(
                  onPressed: () => ref.read(uploadControllerProvider.notifier).clearFinished(),
                  child: const Text('Erledigte ausblenden'),
                ),
              ],
            ),
          ),
          Expanded(
            child: tasks.isEmpty
                ? Center(child: Text('Keine Uploads', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)))
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
          tooltip: 'Abbrechen',
          onPressed: () => ref.read(uploadControllerProvider.notifier).cancel(task.id),
        ),
        UploadStatus.failed || UploadStatus.cancelled => IconButton(
          icon: const Icon(Icons.refresh),
          tooltip: 'Erneut versuchen',
          onPressed: () => ref.read(uploadControllerProvider.notifier).retry(task.id),
        ),
        _ => null,
      },
    );
  }
}
