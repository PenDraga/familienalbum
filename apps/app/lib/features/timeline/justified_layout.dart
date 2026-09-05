import 'media_model.dart';

/// Ein Element in einer bündigen Zeile: Medium plus berechnete Breite.
class JustifiedCell {
  const JustifiedCell(this.item, this.width);
  final MediaItem item;
  final double width;
}

class JustifiedRow {
  const JustifiedRow(this.cells, this.height);
  final List<JustifiedCell> cells;
  final double height;
}

/// Bündiges Mosaik (wie Google/Apple Fotos): Bilder behalten ihr Seitenverhältnis,
/// jede Zeile wird auf die volle Breite skaliert. Die letzte Zeile bleibt in Zielhöhe
/// und wird nicht aufgeblasen.
List<JustifiedRow> computeJustifiedRows(
  List<MediaItem> items, {
  required double width,
  required double targetHeight,
  double gap = 2,
  double minAspect = 0.55,
  double maxAspect = 2.4,
}) {
  final rows = <JustifiedRow>[];
  var current = <MediaItem>[];
  var aspectSum = 0.0;

  double aspectOf(MediaItem m) => m.aspectRatio.clamp(minAspect, maxAspect);

  void emit(List<MediaItem> group, double sum, {required bool stretch}) {
    if (group.isEmpty) return;
    final usable = width - gap * (group.length - 1);
    var height = usable / sum;
    if (!stretch && height > targetHeight) height = targetHeight;
    final cells = <JustifiedCell>[];
    var used = 0.0;
    for (var i = 0; i < group.length; i++) {
      var w = aspectOf(group[i]) * height;
      // Rundungsfehler auf das letzte Element schieben, damit die Zeile exakt schliesst
      if (stretch && i == group.length - 1) w = usable - used;
      cells.add(JustifiedCell(group[i], w));
      used += w;
    }
    rows.add(JustifiedRow(cells, height));
  }

  for (final item in items) {
    current.add(item);
    aspectSum += aspectOf(item);
    final usable = width - gap * (current.length - 1);
    final height = usable / aspectSum;
    if (height <= targetHeight) {
      emit(current, aspectSum, stretch: true);
      current = <MediaItem>[];
      aspectSum = 0;
    }
  }
  emit(current, aspectSum, stretch: false);
  return rows;
}

/// Zielhöhe abhängig von der Breite: auf dem Handy ~3 Spalten, auf dem Desktop ~5.
double targetRowHeightFor(double width) => (width / 3.4).clamp(120.0, 260.0);
