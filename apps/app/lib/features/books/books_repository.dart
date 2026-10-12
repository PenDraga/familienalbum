import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
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

  Future<BookItem> create(
    String familyId, {
    required List<String> months,
    required BookFormat format,
    required BookTextMode textMode,
    bool onlyCommented = false,
    String? title,
  }) async {
    final data = await _api.dio
        .post<Map<String, dynamic>>(
          '/families/$familyId/books',
          data: {
            'months': months,
            'format': format.apiValue,
            'textMode': textMode.apiValue,
            'onlyCommented': onlyCommented,
            if (title != null && title.trim().isNotEmpty) 'title': title.trim(),
          },
        )
        .unwrap();
    return BookItem.fromJson(data, _api.absolute);
  }

  Future<BookItem> rename(String bookId, String title) async {
    final data = await _api.dio.patch<Map<String, dynamic>>('/books/$bookId', data: {'title': title}).unwrap();
    return BookItem.fromJson(data, _api.absolute);
  }

  Future<BookItem> rerender(String bookId) async {
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
