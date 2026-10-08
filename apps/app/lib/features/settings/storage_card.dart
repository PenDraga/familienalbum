import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../../l10n/l10n.dart';

/// Antwort von GET /families/:id/storage. `disk` ist nur für Familien-/globale Admins gesetzt.
class FamilyStorage {
  const FamilyStorage({required this.totalBytes, required this.photoBytes, required this.videoBytes, required this.photoCount, required this.videoCount, this.disk});

  final int totalBytes;
  final int photoBytes;
  final int videoBytes;
  final int photoCount;
  final int videoCount;
  final DiskSpace? disk;

  factory FamilyStorage.fromJson(Map<String, dynamic> j) => FamilyStorage(
    totalBytes: (j['totalBytes'] as num).toInt(),
    photoBytes: (j['photoBytes'] as num).toInt(),
    videoBytes: (j['videoBytes'] as num).toInt(),
    photoCount: j['photoCount'] as int,
    videoCount: j['videoCount'] as int,
    disk: j['disk'] == null ? null : DiskSpace.fromJson(j['disk'] as Map<String, dynamic>),
  );
}

class DiskSpace {
  const DiskSpace({required this.totalBytes, required this.freeBytes});
  final int totalBytes;
  final int freeBytes;
  int get usedBytes => totalBytes - freeBytes;
  double get usedFraction => totalBytes <= 0 ? 0 : (usedBytes / totalBytes).clamp(0, 1).toDouble();

  factory DiskSpace.fromJson(Map<String, dynamic> j) => DiskSpace(totalBytes: (j['totalBytes'] as num).toInt(), freeBytes: (j['freeBytes'] as num).toInt());
}

final familyStorageProvider = FutureProvider.family<FamilyStorage, String>((ref, familyId) async {
  final data = await ref.watch(apiClientProvider).dio.get<Map<String, dynamic>>('/families/$familyId/storage').unwrap();
  return FamilyStorage.fromJson(data);
});

/// Bytes lesbar auf Deutsch: «12,4 GB», «830 MB», «0 B».
String formatBytes(int bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var value = bytes.toDouble();
  var unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  final digits = unit == 0 ? 0 : (value < 10 ? 2 : value < 100 ? 1 : 0);
  return '${value.toStringAsFixed(digits).replaceAll('.', ',')} ${units[unit]}';
}

/// Einstellungen → «Speicherplatz»: Verbrauch des Albums (Fotos/Videos) und für Admins der freie Platz auf dem Server.
class StorageCard extends ConsumerWidget {
  const StorageCard({super.key, required this.familyId});
  final String familyId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final l10n = context.l10n;
    final storage = ref.watch(familyStorageProvider(familyId));
    return Card(
      child: storage.when(
        loading: () => const Padding(padding: EdgeInsets.all(20), child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)))),
        error: (e, _) => Padding(padding: const EdgeInsets.all(16), child: Text(errorMessage(e), style: TextStyle(color: scheme.error))),
        data: (s) {
          final photoShare = s.totalBytes == 0 ? 0.0 : s.photoBytes / s.totalBytes;
          final disk = s.disk;
          return Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(color: scheme.secondaryContainer, borderRadius: BorderRadius.circular(14)),
                      child: Icon(Icons.sd_storage_outlined, color: scheme.onSecondaryContainer),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(l10n.storageAlbumUses(formatBytes(s.totalBytes)), style: text.titleMedium),
                          Text(
                            '${l10n.commonPhotoCount(s.photoCount)} · ${l10n.commonVideoCount(s.videoCount)}',
                            style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                ClipRRect(
                  borderRadius: BorderRadius.circular(999),
                  child: SizedBox(
                    height: 12,
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Expanded(flex: (photoShare * 1000).round().clamp(s.photoBytes > 0 ? 1 : 0, 1000), child: ColoredBox(color: scheme.primary)),
                        Expanded(flex: ((1 - photoShare) * 1000).round().clamp(s.videoBytes > 0 ? 1 : 0, 1000), child: ColoredBox(color: scheme.tertiary)),
                        if (s.totalBytes == 0) Expanded(child: ColoredBox(color: scheme.surfaceContainerHighest)),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    _Legend(color: scheme.primary, label: l10n.storageLegendPhotos(formatBytes(s.photoBytes))),
                    const SizedBox(width: 16),
                    _Legend(color: scheme.tertiary, label: l10n.storageLegendVideos(formatBytes(s.videoBytes))),
                  ],
                ),
                if (disk != null) ...[
                  const SizedBox(height: 16),
                  Divider(height: 1, color: scheme.outlineVariant.withValues(alpha: 0.5)),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Icon(Icons.dns_outlined, size: 18, color: scheme.onSurfaceVariant),
                      const SizedBox(width: 8),
                      Expanded(child: Text(l10n.storageServerFree(formatBytes(disk.freeBytes), formatBytes(disk.totalBytes)), style: text.bodyMedium)),
                      Text(l10n.storagePercentUsed((disk.usedFraction * 100).round()), style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(999),
                    child: LinearProgressIndicator(
                      value: disk.usedFraction,
                      minHeight: 8,
                      backgroundColor: scheme.surfaceContainerHighest,
                      color: disk.usedFraction > 0.9 ? scheme.error : scheme.secondary,
                    ),
                  ),
                  if (disk.usedFraction > 0.9) ...[
                    const SizedBox(height: 8),
                    Text(l10n.storageAlmostFull, style: text.bodySmall?.copyWith(color: scheme.error)),
                  ],
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 6),
        Text(label, style: text.bodySmall),
      ],
    );
  }
}
