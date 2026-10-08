import '../../l10n/l10n.dart';
import '../timeline/media_model.dart';

enum RecapKind { month, year, seconds }

RecapKind recapKindFromJson(String s) => switch (s) {
  'YEAR' => RecapKind.year,
  'SECONDS' => RecapKind.seconds,
  _ => RecapKind.month,
};

extension RecapKindLabel on RecapKind {
  String get apiValue => switch (this) {
    RecapKind.month => 'MONTH',
    RecapKind.year => 'YEAR',
    RecapKind.seconds => 'SECONDS',
  };

  String label(AppLocalizations l10n) => switch (this) {
    RecapKind.month => l10n.recapKindMonth,
    RecapKind.year => l10n.recapKindYear,
    RecapKind.seconds => l10n.recapKindSeconds,
  };
}

/// Rückblick-Video (Monat, Jahr, Sekunden-Film).
class RecapItem {
  const RecapItem({
    required this.id,
    required this.familyId,
    required this.kind,
    required this.period,
    required this.title,
    required this.status,
    required this.mediaCount,
    required this.createdAt,
    this.error,
    this.durationSec,
    this.musicTrack,
    this.videoUrl,
    this.posterUrl,
  });

  final String id;
  final String familyId;
  final RecapKind kind;
  final String period;
  final String title;
  final String status; // PROCESSING | READY | FAILED
  final String? error;
  final double? durationSec;
  final int mediaCount;
  final String? musicTrack;
  final DateTime createdAt;
  final String? videoUrl;
  final String? posterUrl;

  bool get isReady => status == 'READY';
  bool get isFailed => status == 'FAILED';

  factory RecapItem.fromJson(Map<String, dynamic> j, String Function(String) absolute) {
    final urls = j['urls'] as Map<String, dynamic>;
    return RecapItem(
      id: j['id'] as String,
      familyId: j['familyId'] as String,
      kind: recapKindFromJson(j['kind'] as String),
      period: j['period'] as String,
      title: j['title'] as String,
      status: j['status'] as String,
      error: j['error'] as String?,
      durationSec: (j['durationSec'] as num?)?.toDouble(),
      mediaCount: j['mediaCount'] as int,
      musicTrack: j['musicTrack'] as String?,
      createdAt: DateTime.parse(j['createdAt'] as String),
      videoUrl: urls['video'] == null ? null : absolute(urls['video'] as String),
      posterUrl: urls['poster'] == null ? null : absolute(urls['poster'] as String),
    );
  }
}

/// «An diesem Tag»: eine Gruppe pro früherem Datum.
class OnThisDayGroup {
  const OnThisDayGroup({required this.label, required this.date, required this.monthsAgo, required this.items});
  final String label;
  final String date;
  final int monthsAgo;
  final List<MediaItem> items;

  factory OnThisDayGroup.fromJson(Map<String, dynamic> j, String Function(String) absolute) => OnThisDayGroup(
    label: j['label'] as String,
    date: j['date'] as String,
    monthsAgo: j['monthsAgo'] as int,
    items: (j['items'] as List<dynamic>).map((e) => MediaItem.fromJson(e as Map<String, dynamic>, absolute)).toList(),
  );
}
