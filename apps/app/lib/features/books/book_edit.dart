/// Reine Bearbeitungsschritte auf der Seitenliste eines Fotobuchs (Kontroll-Assistent).
/// Jede Funktion liefert eine neue Liste; die Eingabe bleibt unverändert.
library;

typedef BookPageJson = Map<String, dynamic>;

/// Tiefe Kopie (JSON-artige Strukturen).
dynamic _copy(dynamic v) => switch (v) {
  final Map<String, dynamic> m => {for (final e in m.entries) e.key: _copy(e.value)},
  final List<dynamic> l => [for (final x in l) _copy(x)],
  _ => v,
};

List<BookPageJson> copyPages(List<BookPageJson> pages) => [for (final p in pages) _copy(p) as BookPageJson];

List<BookPageJson> _items(BookPageJson page) => ((page['items'] as List<dynamic>?) ?? const []).cast<BookPageJson>();

/// Fotos einer Seite in der Reihenfolge, in der der Server die Thumbnails liefert.
List<String> pageMediaIds(BookPageJson page) => switch (page['type']) {
  'cover' => [if (page['mediaId'] != null) page['mediaId'] as String],
  'photos' => [for (final i in _items(page)) i['mediaId'] as String],
  _ => const [],
};

bool pageHasText(BookPageJson page) =>
    page['type'] == 'photos' && _items(page).any((i) => (i['caption'] as String?)?.isNotEmpty == true || ((i['comments'] as List<dynamic>?) ?? const []).isNotEmpty);

/// Vorlage passend zur neuen Anzahl Fotos: feste Vorlagen der ersten Version und «ein Foto» werden zu `auto`.
void _normalize(BookPageJson page) {
  final n = _items(page).length;
  final t = page['template'] as String?;
  if ((t == 'one' || t == 'one_text') && n != 1) page['template'] = 'auto';
  if (t == 'two' || t == 'two_stacked' || t == 'four') page['template'] = 'auto';
}

/// Foto von der Seite nehmen; eine leere Fotoseite verschwindet.
List<BookPageJson> removeItem(List<BookPageJson> pages, int pageIndex, String mediaId) {
  final out = copyPages(pages);
  final page = out[pageIndex];
  page['items'] = _items(page).where((i) => i['mediaId'] != mediaId).toList();
  if (_items(page).isEmpty) {
    out.removeAt(pageIndex);
  } else {
    _normalize(page);
  }
  return out;
}

/// Index der Nachbar-Fotoseite im selben Kapitel (oder null).
int? neighbourPhotoPage(List<BookPageJson> pages, int pageIndex, int direction) {
  final j = pageIndex + direction;
  if (j < 0 || j >= pages.length) return null;
  return pages[j]['type'] == 'photos' ? j : null;
}

/// Foto auf die vorige (-1) oder nächste (+1) Fotoseite schieben; höchstens 6 Fotos pro Seite. Null = geht nicht.
List<BookPageJson>? moveItem(List<BookPageJson> pages, int pageIndex, String mediaId, int direction) {
  final target = neighbourPhotoPage(pages, pageIndex, direction);
  if (target == null || _items(pages[target]).length >= 6) return null;
  final out = copyPages(pages);
  final item = _items(out[pageIndex]).firstWhere((i) => i['mediaId'] == mediaId);
  final targetItems = _items(out[target]);
  out[target]['items'] = direction > 0 ? [item, ...targetItems] : [...targetItems, item];
  _normalize(out[target]);
  out[pageIndex]['items'] = _items(out[pageIndex]).where((i) => i['mediaId'] != mediaId).toList();
  if (_items(out[pageIndex]).isEmpty) {
    out.removeAt(pageIndex);
  } else {
    _normalize(out[pageIndex]);
  }
  return out;
}

/// Ausschnitt setzen (null = automatisch). Gilt für ein Foto einer Fotoseite oder das Umschlagfoto.
List<BookPageJson> setCrop(List<BookPageJson> pages, int pageIndex, String mediaId, ({double x, double y, double zoom})? crop) {
  final out = copyPages(pages);
  final page = out[pageIndex];
  final value = crop == null ? null : {'x': _round(crop.x), 'y': _round(crop.y), 'zoom': _round(crop.zoom)};
  BookPageJson target = page;
  if (page['type'] == 'photos') target = _items(page).firstWhere((i) => i['mediaId'] == mediaId);
  if (value == null) {
    target.remove('crop');
  } else {
    target['crop'] = value;
  }
  return out;
}

double _round(double v) => (v * 1000).round() / 1000;

({double x, double y, double zoom})? cropOf(BookPageJson page, String mediaId) {
  final BookPageJson? target = page['type'] == 'photos' ? _items(page).where((i) => i['mediaId'] == mediaId).firstOrNull : page;
  final c = target?['crop'] as Map<String, dynamic>?;
  if (c == null) return null;
  return (x: (c['x'] as num).toDouble(), y: (c['y'] as num).toDouble(), zoom: (c['zoom'] as num).toDouble());
}

List<BookPageJson> setHideText(List<BookPageJson> pages, int pageIndex, bool hide) {
  final out = copyPages(pages);
  if (hide) {
    out[pageIndex]['hideText'] = true;
  } else {
    out[pageIndex].remove('hideText');
  }
  return out;
}

List<BookPageJson> setCoverPhoto(List<BookPageJson> pages, String mediaId) {
  final out = copyPages(pages);
  final i = out.indexWhere((p) => p['type'] == 'cover');
  if (i < 0) return out;
  out[i]['mediaId'] = mediaId;
  out[i].remove('crop');
  return out;
}

/// Titel (Umschlag, Kapitel) oder Untertitel (Umschlag) ändern.
List<BookPageJson> setText(List<BookPageJson> pages, int pageIndex, String field, String value) {
  final out = copyPages(pages);
  out[pageIndex][field] = value;
  return out;
}
