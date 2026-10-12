import '../../l10n/l10n.dart';

enum BookFormat { square21, a4Landscape, square30 }

BookFormat bookFormatFromJson(String s) => switch (s) {
  'A4_LANDSCAPE' => BookFormat.a4Landscape,
  'SQUARE_30' => BookFormat.square30,
  _ => BookFormat.square21,
};

extension BookFormatLabel on BookFormat {
  String get apiValue => switch (this) {
    BookFormat.square21 => 'SQUARE_21',
    BookFormat.a4Landscape => 'A4_LANDSCAPE',
    BookFormat.square30 => 'SQUARE_30',
  };

  String label(AppLocalizations l10n) => switch (this) {
    BookFormat.square21 => l10n.bookFormatSquare21,
    BookFormat.a4Landscape => l10n.bookFormatA4,
    BookFormat.square30 => l10n.bookFormatSquare30,
  };

  /// Seitenverhältnis Breite / Höhe (für Vorschau-Kacheln)
  double get aspectRatio => this == BookFormat.a4Landscape ? 297 / 210 : 1;
}

/// Anordnung der Fotos (siehe Server: book-layout.ts)
enum BookLayout { single, mixed, collage }

BookLayout bookLayoutFromJson(String? s) => switch (s) {
  'SINGLE' => BookLayout.single,
  'COLLAGE' => BookLayout.collage,
  _ => BookLayout.mixed,
};

extension BookLayoutLabel on BookLayout {
  String get apiValue => switch (this) {
    BookLayout.single => 'SINGLE',
    BookLayout.mixed => 'MIXED',
    BookLayout.collage => 'COLLAGE',
  };

  String label(AppLocalizations l10n) => switch (this) {
    BookLayout.single => l10n.bookLayoutSingle,
    BookLayout.mixed => l10n.bookLayoutMixed,
    BookLayout.collage => l10n.bookLayoutCollage,
  };

  String description(AppLocalizations l10n) => switch (this) {
    BookLayout.single => l10n.bookLayoutSingleText,
    BookLayout.mixed => l10n.bookLayoutMixedText,
    BookLayout.collage => l10n.bookLayoutCollageText,
  };
}

enum BookTextMode { none, captions, comments }

BookTextMode bookTextModeFromJson(String s) => switch (s) {
  'NONE' => BookTextMode.none,
  'COMMENTS' => BookTextMode.comments,
  _ => BookTextMode.captions,
};

extension BookTextModeLabel on BookTextMode {
  String get apiValue => switch (this) {
    BookTextMode.none => 'NONE',
    BookTextMode.captions => 'CAPTIONS',
    BookTextMode.comments => 'COMMENTS',
  };

  String label(AppLocalizations l10n) => switch (this) {
    BookTextMode.none => l10n.bookTextNone,
    BookTextMode.captions => l10n.bookTextCaptions,
    BookTextMode.comments => l10n.bookTextComments,
  };
}

/// Fotobuch (druckfertiges PDF), siehe ADR-0004.
class BookItem {
  const BookItem({
    required this.id,
    required this.familyId,
    required this.createdByName,
    required this.title,
    required this.format,
    required this.textMode,
    this.layout = BookLayout.mixed,
    required this.months,
    required this.status,
    required this.pageCount,
    required this.mediaCount,
    required this.canEdit,
    required this.createdAt,
    this.error,
    this.pdfBytes,
    this.pdfUrl,
    this.coverUrl,
    this.pages = const [],
  });

  final String id;
  final String familyId;
  final String createdByName;
  final String title;
  final BookFormat format;
  final BookTextMode textMode;
  final BookLayout layout;
  final List<String> months;
  final String status; // PROCESSING | READY | FAILED
  final String? error;
  final int pageCount;
  final int mediaCount;
  final int? pdfBytes;
  final bool canEdit;
  final DateTime createdAt;
  final String? pdfUrl;
  final String? coverUrl;
  /// Nur im Detail gefüllt
  final List<BookPageView> pages;

  bool get isReady => status == 'READY';
  bool get isFailed => status == 'FAILED';

  factory BookItem.fromJson(Map<String, dynamic> j, String Function(String) absolute) {
    final urls = j['urls'] as Map<String, dynamic>;
    final createdBy = j['createdBy'] as Map<String, dynamic>?;
    return BookItem(
      id: j['id'] as String,
      familyId: j['familyId'] as String,
      createdByName: (createdBy?['displayName'] as String?) ?? '',
      title: j['title'] as String,
      format: bookFormatFromJson(j['format'] as String),
      textMode: bookTextModeFromJson(j['textMode'] as String),
      layout: bookLayoutFromJson(j['layout'] as String?),
      months: (j['months'] as List<dynamic>).cast<String>(),
      status: j['status'] as String,
      error: j['error'] as String?,
      pageCount: j['pageCount'] as int,
      mediaCount: j['mediaCount'] as int,
      pdfBytes: j['pdfBytes'] as int?,
      canEdit: j['canEdit'] as bool? ?? false,
      createdAt: DateTime.parse(j['createdAt'] as String),
      pdfUrl: urls['pdf'] == null ? null : absolute(urls['pdf'] as String),
      coverUrl: urls['cover'] == null ? null : absolute(urls['cover'] as String),
      pages: ((j['pages'] as List<dynamic>?) ?? const []).map((e) => BookPageView.fromJson(e as Map<String, dynamic>, absolute)).toList(),
    );
  }
}

/// Eine Seite im Detail: gespeicherte Seite plus Vorschau und Foto-Thumbnails.
class BookPageView {
  const BookPageView({required this.index, required this.type, required this.template, required this.title, required this.mediaCount, required this.previewUrl, required this.thumbs});

  final int index;
  final String type; // cover | chapter | photos
  final String? template; // one | two | two_stacked | four | one_text
  final String? title;
  final int mediaCount;
  final String? previewUrl;
  final List<String> thumbs;

  factory BookPageView.fromJson(Map<String, dynamic> j, String Function(String) absolute) {
    final page = j['page'] as Map<String, dynamic>;
    final items = page['items'] as List<dynamic>?;
    return BookPageView(
      index: j['index'] as int,
      type: page['type'] as String,
      template: page['template'] as String?,
      title: page['title'] as String?,
      mediaCount: items?.length ?? (page['mediaId'] == null ? 0 : 1),
      previewUrl: j['previewUrl'] == null ? null : absolute(j['previewUrl'] as String),
      thumbs: ((j['thumbs'] as List<dynamic>?) ?? const []).map((e) => absolute(e as String)).toList(),
    );
  }
}

/// Monat mit Fotos (Assistent, Schritt «Zeitraum»).
class BookMonth {
  const BookMonth({required this.month, required this.count});
  final String month; // JJJJ-MM
  final int count;

  int get year => int.parse(month.substring(0, 4));
  int get monthNumber => int.parse(month.substring(5, 7));

  factory BookMonth.fromJson(Map<String, dynamic> j) => BookMonth(month: j['month'] as String, count: j['count'] as int);
}

/// Foto zum An- und Abwählen (Assistent, Schritt «Fotos»).
class BookPhoto {
  const BookPhoto({required this.id, required this.takenAt, required this.commentCount, required this.thumbUrl, this.caption});
  final String id;
  final DateTime takenAt;
  final int commentCount;
  final String thumbUrl;
  final String? caption;

  String get month => '${takenAt.toUtc().year}-${takenAt.toUtc().month.toString().padLeft(2, '0')}';

  factory BookPhoto.fromJson(Map<String, dynamic> j, String Function(String) absolute) => BookPhoto(
    id: j['id'] as String,
    takenAt: DateTime.parse(j['takenAt'] as String),
    commentCount: j['commentCount'] as int,
    thumbUrl: absolute(j['thumbUrl'] as String),
    caption: j['caption'] as String?,
  );
}

/// Seitenschätzung des Servers.
class BookPreview {
  const BookPreview({required this.pageCount, required this.mediaCount, required this.maxPages});
  final int pageCount;
  final int mediaCount;
  final int maxPages;

  factory BookPreview.fromJson(Map<String, dynamic> j) => BookPreview(pageCount: j['pageCount'] as int, mediaCount: j['mediaCount'] as int, maxPages: j['maxPages'] as int);
}

/// Was der Assistent an den Server schickt (Anlegen und Seitenschätzung).
class BookRequest {
  const BookRequest({required this.months, required this.format, required this.textMode, required this.layout, this.excludeMediaIds = const [], this.title});
  final List<String> months;
  final BookFormat format;
  final BookTextMode textMode;
  final BookLayout layout;
  final List<String> excludeMediaIds;
  final String? title;

  Map<String, dynamic> toJson() => {
    'months': months,
    'format': format.apiValue,
    'textMode': textMode.apiValue,
    'layout': layout.apiValue,
    'excludeMediaIds': excludeMediaIds,
    if (title != null && title!.trim().isNotEmpty) 'title': title!.trim(),
  };

  /// Schlüssel für die Seitenschätzung (der Titel ändert die Seitenzahl nicht)
  String get previewKey => [months.join(','), format.apiValue, textMode.apiValue, layout.apiValue, (excludeMediaIds.toList()..sort()).join(',')].join('|');
}
