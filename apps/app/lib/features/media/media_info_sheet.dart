import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_exception.dart';
import '../../l10n/l10n.dart';
import '../timeline/media_model.dart';
import '../timeline/timeline_controller.dart';
import '../timeline/timeline_screen.dart' show formatDuration;
import 'media_info.dart';
import 'taken_at_dialog.dart';

/// Info-Sheet zu einem Medium: Aufnahmezeit (änderbar), Kamera/Belichtung, Ort, Datei.
/// Liefert das aktualisierte Medium zurück, falls das Aufnahmedatum geändert wurde.
Future<MediaItem?> showMediaInfoSheet(BuildContext context, MediaItem item) {
  return showModalBottomSheet<MediaItem?>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (_) => _MediaInfoSheet(item: item),
  );
}

class _MediaInfoSheet extends ConsumerStatefulWidget {
  const _MediaInfoSheet({required this.item});
  final MediaItem item;

  @override
  ConsumerState<_MediaInfoSheet> createState() => _MediaInfoSheetState();
}

class _MediaInfoSheetState extends ConsumerState<_MediaInfoSheet> {
  late MediaItem _item = widget.item;
  MediaInfo? _info;
  String? _error;
  bool _saving = false;
  bool _changed = false;

  @override
  void initState() {
    super.initState();
    ref.read(timelineRepositoryProvider).info(_item.id).then((i) {
      if (mounted) setState(() => _info = i);
    }).catchError((Object e) {
      if (mounted) setState(() => _error = errorMessage(e));
    });
  }

  Future<void> _changeDate() async {
    final change = await showTakenAtDialog(context, samples: [_item.takenAt]);
    if (change == null || !mounted) return;
    setState(() => _saving = true);
    try {
      final updated = await ref.read(timelineRepositoryProvider).updateTakenAt(_item.id, change.apply(_item.takenAt));
      ref.read(timelineControllerProvider.notifier).replaceItem(updated);
      if (mounted) {
        setState(() {
          _item = updated;
          _changed = true;
        });
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(e))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _openMap(ExifInfo exif) {
    final uri = Uri.parse('https://www.openstreetmap.org/?mlat=${exif.gpsLat}&mlon=${exif.gpsLon}#map=16/${exif.gpsLat}/${exif.gpsLon}');
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final l10n = context.l10n;
    final locale = context.localeTag;
    final date = DateFormat.yMMMMEEEEd(locale);
    final time = DateFormat.Hm(locale);
    final full = DateFormat.yMd(locale).addPattern('Hm', ', ');
    final item = _item;
    final info = _info;
    final exif = info?.exif;
    final local = item.takenAt.toLocal();
    final originalDiffers =
        exif?.originalDateTime != null && (exif!.originalDateTime!.difference(item.takenAt).abs() > const Duration(minutes: 1));

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.pop(context, _changed ? _item : null);
      },
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.62,
        minChildSize: 0.35,
        maxChildSize: 0.95,
        builder: (_, scroll) => ListView(
          controller: scroll,
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          children: [
            // Aufnahmezeit – prominent, mit Bearbeiten
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(date.format(local), style: text.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 2),
                      Text(time.format(local), style: text.titleMedium?.copyWith(color: scheme.onSurfaceVariant)),
                      if (originalDiffers)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text(
                            l10n.mediaInfoFromFile(full.format(exif.originalDateTime!.toLocal())),
                            style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                          ),
                        ),
                    ],
                  ),
                ),
                if (item.canEdit)
                  _saving
                      ? const Padding(padding: EdgeInsets.all(12), child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)))
                      : FilledButton.tonalIcon(
                          onPressed: _changeDate,
                          // Das Theme macht FilledButtons volle Breite; hier kompakt neben dem Datum
                          style: FilledButton.styleFrom(minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: 14)),
                          icon: const Icon(Icons.edit_calendar_outlined),
                          label: Text(l10n.mediaInfoChange),
                        ),
              ],
            ),
            if (item.canEdit)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(l10n.mediaInfoDateHint, style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
              ),
            const SizedBox(height: 20),

            if (info == null && _error == null) const Padding(padding: EdgeInsets.symmetric(vertical: 24), child: Center(child: CircularProgressIndicator())),
            if (_error != null) Text(_error!, style: TextStyle(color: scheme.error)),

            if (exif != null) ...[
              if (exif.hasCamera || exif.lens != null || exif.hasExposure) ...[
                _Section(
                  icon: item.isVideo ? Icons.videocam_outlined : Icons.photo_camera_outlined,
                  title: exif.cameraName ?? l10n.mediaInfoCamera,
                  subtitle: exif.lens,
                  children: [
                    if (exif.hasExposure)
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          if (exif.apertureLabel != null) _Chip(label: exif.apertureLabel!),
                          if (exif.exposureLabel != null) _Chip(label: exif.exposureLabel!),
                          if (exif.iso != null) _Chip(label: 'ISO ${exif.iso}'),
                          if (exif.focalLabel != null) _Chip(label: exif.focalLabel!),
                        ],
                      ),
                    if (exif.software != null) _Row(label: l10n.mediaInfoSoftware, value: exif.software!),
                  ],
                ),
                const SizedBox(height: 16),
              ],
              if (exif.hasGps) ...[
                _Section(
                  icon: Icons.place_outlined,
                  title: l10n.mediaInfoLocation,
                  subtitle:
                      '${exif.gpsLat!.toStringAsFixed(5)}, ${exif.gpsLon!.toStringAsFixed(5)}'
                      '${exif.gpsAlt != null ? ' · ${l10n.mediaInfoAltitude(exif.gpsAlt!.round())}' : ''}',
                  trailing: TextButton.icon(onPressed: () => _openMap(exif), icon: const Icon(Icons.map_outlined), label: Text(l10n.mediaInfoMap)),
                ),
                const SizedBox(height: 16),
              ],
              if (exif.isEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(l10n.mediaInfoNoMetadata, style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)),
                ),
            ],

            // Datei
            _Section(
              icon: item.isVideo ? Icons.movie_outlined : Icons.image_outlined,
              title: item.originalName,
              children: [
                _Row(
                  label: l10n.mediaInfoType,
                  value: [
                    item.isVideo ? l10n.mediaInfoVideo : l10n.mediaInfoPhoto,
                    ?info?.mimeType,
                  ].join(' · '),
                ),
                _Row(
                  label: l10n.mediaInfoSize,
                  value: [
                    formatBytes(item.sizeBytes),
                    if (item.width != null) '${item.width} × ${item.height} px',
                    if (item.durationSec != null) formatDuration(item.durationSec!),
                  ].join(' · '),
                ),
                _Row(label: l10n.mediaInfoUploaded, value: l10n.mediaInfoUploadedBy(full.format(item.uploadedAt.toLocal()), item.uploaderName)),
                if (info != null)
                  _Row(
                    label: 'SHA-256',
                    value: '${info.sha256.substring(0, 16)}…',
                    onTap: () {
                      Clipboard.setData(ClipboardData(text: info.sha256));
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.mediaInfoChecksumCopied)));
                    },
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

String formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
  if (bytes < 1024 * 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
}

class _Section extends StatelessWidget {
  const _Section({required this.icon, required this.title, this.subtitle, this.trailing, this.children = const []});
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: scheme.surfaceContainerHigh.withValues(alpha: 0.6), borderRadius: BorderRadius.circular(16)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: scheme.primary),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: text.titleSmall?.copyWith(fontWeight: FontWeight.w600), maxLines: 2, overflow: TextOverflow.ellipsis),
                    if (subtitle != null) Text(subtitle!, style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
                  ],
                ),
              ),
              ?trailing,
            ],
          ),
          if (children.isNotEmpty) ...[const SizedBox(height: 12), ...children],
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value, this.onTap});
  final String label;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 96, child: Text(label, style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant))),
            Expanded(child: Text(value, style: text.bodyMedium)),
            if (onTap != null) Icon(Icons.copy_outlined, size: 16, color: scheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: scheme.surface, borderRadius: BorderRadius.circular(8)),
      child: Text(label, style: Theme.of(context).textTheme.labelLarge),
    );
  }
}
