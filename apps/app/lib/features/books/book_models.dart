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
