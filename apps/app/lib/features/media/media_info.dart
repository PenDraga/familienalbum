/// Aufnahme-Metadaten (Auszug aus EXIF bzw. Video-Tags) und Dateiinfos eines Mediums.
class MediaInfo {
  const MediaInfo({
    required this.exif,
    required this.originalName,
    required this.mimeType,
    required this.sizeBytes,
    required this.sha256,
    required this.uploadedAt,
    required this.takenAt,
  });

  final ExifInfo exif;
  final String originalName;
  final String mimeType;
  final int sizeBytes;
  final String sha256;
  final DateTime uploadedAt;
  final DateTime takenAt;

  factory MediaInfo.fromJson(Map<String, dynamic> j) => MediaInfo(
    exif: ExifInfo.fromJson((j['exif'] as Map<String, dynamic>?) ?? const {}),
    originalName: j['originalName'] as String,
    mimeType: j['mimeType'] as String,
    sizeBytes: j['sizeBytes'] as int,
    sha256: j['sha256'] as String,
    uploadedAt: DateTime.parse(j['uploadedAt'] as String),
    takenAt: DateTime.parse(j['takenAt'] as String),
  );
}

class ExifInfo {
  const ExifInfo({
    this.make,
    this.model,
    this.lens,
    this.software,
    this.fNumber,
    this.exposureTime,
    this.iso,
    this.focalLength,
    this.focalLength35,
    this.originalDateTime,
    this.gpsLat,
    this.gpsLon,
    this.gpsAlt,
  });

  final String? make;
  final String? model;
  final String? lens;
  final String? software;
  final double? fNumber;
  final double? exposureTime;
  final int? iso;
  final double? focalLength;
  final double? focalLength35;
  final DateTime? originalDateTime;
  final double? gpsLat;
  final double? gpsLon;
  final double? gpsAlt;

  bool get hasCamera => make != null || model != null;
  bool get hasExposure => fNumber != null || exposureTime != null || iso != null || focalLength != null;
  bool get hasGps => gpsLat != null && gpsLon != null;
  bool get isEmpty => !hasCamera && !hasExposure && !hasGps && lens == null && software == null && originalDateTime == null;

  /// „Apple iPhone 15 Pro“ – Hersteller nur, wenn er nicht schon im Modell steckt.
  String? get cameraName {
    if (model == null) return make;
    if (make == null || model!.toLowerCase().contains(make!.toLowerCase())) return model;
    return '$make $model';
  }

  /// Belichtungszeit als Bruch: 1/250 s bzw. 2 s.
  String? get exposureLabel {
    final t = exposureTime;
    if (t == null || t <= 0) return null;
    if (t >= 1) return '${_trim(t)} s';
    return '1/${(1 / t).round()} s';
  }

  String? get apertureLabel => fNumber == null ? null : 'f/${_trim(fNumber!)}';

  String? get focalLabel {
    if (focalLength == null) return null;
    final base = '${_trim(focalLength!)} mm';
    if (focalLength35 != null && (focalLength35! - focalLength!).abs() > 0.5) return '$base (${_trim(focalLength35!)} mm KB)';
    return base;
  }

  static String _trim(double v) => v == v.roundToDouble() ? v.round().toString() : v.toStringAsFixed(v < 10 ? 1 : 0);

  factory ExifInfo.fromJson(Map<String, dynamic> j) {
    final gps = j['gps'] as Map<String, dynamic>?;
    DateTime? original;
    final raw = j['originalDateTime'];
    if (raw is String) original = DateTime.tryParse(raw);
    return ExifInfo(
      make: j['make'] as String?,
      model: j['model'] as String?,
      lens: j['lens'] as String?,
      software: j['software'] as String?,
      fNumber: (j['fNumber'] as num?)?.toDouble(),
      exposureTime: (j['exposureTime'] as num?)?.toDouble(),
      iso: (j['iso'] as num?)?.round(),
      focalLength: (j['focalLength'] as num?)?.toDouble(),
      focalLength35: (j['focalLength35'] as num?)?.toDouble(),
      originalDateTime: original,
      gpsLat: (gps?['lat'] as num?)?.toDouble(),
      gpsLon: (gps?['lon'] as num?)?.toDouble(),
      gpsAlt: (gps?['alt'] as num?)?.toDouble(),
    );
  }
}

/// Gewünschte Änderung des Aufnahmedatums: fester Zeitpunkt oder Verschiebung.
sealed class TakenAtChange {
  const TakenAtChange();

  DateTime apply(DateTime current) => switch (this) {
    TakenAtSet(:final value) => value,
    TakenAtShift(:final by) => current.add(by),
  };

  Map<String, dynamic> toJson() => switch (this) {
    TakenAtSet(:final value) => {'takenAt': value.toUtc().toIso8601String()},
    TakenAtShift(:final by) => {'shiftSeconds': by.inSeconds},
  };
}

class TakenAtSet extends TakenAtChange {
  const TakenAtSet(this.value);
  final DateTime value;
}

class TakenAtShift extends TakenAtChange {
  const TakenAtShift(this.by);
  final Duration by;
}

class BatchTakenAtResult {
  const BatchTakenAtResult({required this.updated, required this.skipped});
  final int updated;
  final List<String> skipped;

  factory BatchTakenAtResult.fromJson(Map<String, dynamic> j) =>
      BatchTakenAtResult(updated: j['updated'] as int, skipped: (j['skipped'] as List<dynamic>).cast<String>());
}
