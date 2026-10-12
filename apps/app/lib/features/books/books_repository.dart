import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../auth/auth_controller.dart';
import 'book_models.dart';

class BooksRepository {
  BooksRepository(this._api);
  final ApiClient _api;

  Future<List<BookItem>> list(String familyId) async {
    final data = await _api.dio.get<List<dynamic>>('/families/$familyId/books').unwrap();
    return data.map((e) => BookItem.fromJson(e as Map<String, dynamic>, _api.absolute)).toList();
  }

  Future<BookItem> get(String bookId) async {
    final data = await _api.dio.get<Map<String, dynamic>>('/books/$bookId').unwrap();
    return BookItem.fromJson(data, _api.absolute);
  }

  Future<BookItem> create(String familyId, BookRequest request) async {
    final data = await _api.dio.post<Map<String, dynamic>>('/families/$familyId/books', data: request.toJson()).unwrap();
    return BookItem.fromJson(data, _api.absolute);
  }

  Future<List<BookMonth>> months(String familyId) async {
    final data = await _api.dio.get<List<dynamic>>('/families/$familyId/books/months').unwrap();
    return data.map((e) => BookMonth.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<List<BookPhoto>> photos(String familyId, List<String> months) async {
    final data = await _api.dio.get<List<dynamic>>('/families/$familyId/books/photos', queryParameters: {'months': months.join(',')}).unwrap();
    return data.map((e) => BookPhoto.fromJson(e as Map<String, dynamic>, _api.absolute)).toList();
  }

  Future<BookPreview> preview(String familyId, BookRequest request) async {
    final data = await _api.dio.post<Map<String, dynamic>>('/families/$familyId/books/preview', data: request.toJson()).unwrap();
    return BookPreview.fromJson(data);
  }

  /// Seitenliste ersetzen (Kontroll-Assistent); der Server rendert danach neu.
  Future<BookItem> savePages(String bookId, List<Map<String, dynamic>> pages) async {
    final data = await _api.dio.patch<Map<String, dynamic>>('/books/$bookId', data: {'pages': pages}).unwrap();
    return BookItem.fromJson(data, _api.absolute);
  }

  /// Eine (bearbeitete) Seite als Bild, ohne zu speichern; dazu das Seitenverhältnis jedes Fotoplatzes.
  Future<PagePreview> previewPage(String bookId, Map<String, dynamic> page) async {
    try {
      final res = await _api.dio.post<List<int>>('/books/$bookId/preview-page', data: {'page': page}, options: Options(responseType: ResponseType.bytes));
      final raw = res.headers.value('x-book-slots');
      final slots = raw == null ? const <String, double>{} : {for (final e in (jsonDecode(raw) as Map<String, dynamic>).entries) e.key: (e.value as num).toDouble()};
      return PagePreview(Uint8List.fromList(res.data!), slots);
    } on DioException catch (e) {
      throw (e.error is ApiException) ? e.error! as ApiException : ApiException.fromDio(e);
    }
  }

  Future<BookItem> rename(String bookId, String title) async {
    final data = await _api.dio.patch<Map<String, dynamic>>('/books/$bookId', data: {'title': title}).unwrap();
    return BookItem.fromJson(data, _api.absolute);
  }

  /// «PDF erstellen» (auch nach einem Fehler)
  Future<BookItem> requestPdf(String bookId) async {
    final data = await _api.dio.post<Map<String, dynamic>>('/books/$bookId/render').unwrap();
    return BookItem.fromJson(data, _api.absolute);
  }

  Future<void> delete(String bookId) => _api.dio.delete<void>('/books/$bookId').unwrap();
}

final booksRepositoryProvider = Provider<BooksRepository>((ref) => BooksRepository(ref.watch(apiClientProvider)));

/// Fotobücher der gewählten Familie; `ref.invalidate` nach Erstellen/Löschen oder Push.
final booksProvider = FutureProvider<List<BookItem>>((ref) async {
  final family = ref.watch(selectedFamilyProvider);
  if (family == null) return const [];
  return ref.watch(booksRepositoryProvider).list(family.id);
});

/// Detail mit Seitenliste.
final bookDetailProvider = FutureProvider.family<BookItem, String>((ref, bookId) => ref.watch(booksRepositoryProvider).get(bookId));

/// Monate mit Fotos eines Albums (Assistent; beim Verlassen verworfen, damit neue Fotos erscheinen).
final bookMonthsProvider = FutureProvider.autoDispose.family<List<BookMonth>, String>((ref, familyId) => ref.watch(booksRepositoryProvider).months(familyId));

/// Fotos der gewählten Monate; Schlüssel `familyId|JJJJ-MM,JJJJ-MM`.
final bookPhotosProvider = FutureProvider.autoDispose.family<List<BookPhoto>, String>((ref, key) {
  final parts = key.split('|');
  return ref.watch(booksRepositoryProvider).photos(parts[0], parts[1].split(','));
});

/// Schlüssel der Seitenschätzung: gleich, wenn Album und alles ausser dem Titel gleich sind.
class BookPreviewArgs {
  const BookPreviewArgs(this.familyId, this.request);
  final String familyId;
  final BookRequest request;

  String get _key => '$familyId#${request.previewKey}';

  @override
  bool operator ==(Object other) => other is BookPreviewArgs && other._key == _key;

  @override
  int get hashCode => _key.hashCode;
}

/// Seitenschätzung des Servers für die aktuelle Auswahl im Assistenten.
final bookPreviewProvider = FutureProvider.autoDispose.family<BookPreview, BookPreviewArgs>((ref, args) => ref.watch(booksRepositoryProvider).preview(args.familyId, args.request));

/// Gerenderte Seite und Seitenverhältnis (Breite/Höhe) des Platzes je Foto, das ihn füllt.
class PagePreview {
  const PagePreview(this.bytes, this.slots);
  final Uint8List bytes;
  final Map<String, double> slots;
}

/// Schlüssel der Seitenvorschau: Buch und die Seite als JSON (vergleichbar).
class PagePreviewArgs {
  PagePreviewArgs(this.bookId, Map<String, dynamic> page) : json = jsonEncode(page);
  final String bookId;
  final String json;

  @override
  bool operator ==(Object other) => other is PagePreviewArgs && other.bookId == bookId && other.json == json;

  @override
  int get hashCode => Object.hash(bookId, json);
}

/// Vorschau einer bearbeiteten Seite vom Server.
final bookPagePreviewProvider = FutureProvider.autoDispose.family<PagePreview, PagePreviewArgs>(
  (ref, args) => ref.watch(booksRepositoryProvider).previewPage(args.bookId, jsonDecode(args.json) as Map<String, dynamic>),
);
