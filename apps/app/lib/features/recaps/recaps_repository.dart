import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/providers.dart';
import '../auth/auth_controller.dart';
import 'recap_models.dart';

class RecapsRepository {
  RecapsRepository(this._api);
  final ApiClient _api;

  Future<List<RecapItem>> list(String familyId) async {
    final data = await _api.dio.get<List<dynamic>>('/families/$familyId/recaps').unwrap();
    return data.map((e) => RecapItem.fromJson(e as Map<String, dynamic>, _api.absolute)).toList();
  }

  Future<RecapItem> create(String familyId, RecapKind kind, String period) async {
    final data = await _api.dio.post<Map<String, dynamic>>('/families/$familyId/recaps', data: {'kind': kind.apiValue, 'period': period}).unwrap();
    return RecapItem.fromJson(data, _api.absolute);
  }

  Future<void> delete(String recapId) => _api.dio.delete<void>('/recaps/$recapId').unwrap();

  Future<List<OnThisDayGroup>> onThisDay(String familyId) async {
    final data = await _api.dio.get<Map<String, dynamic>>('/families/$familyId/on-this-day').unwrap();
    return (data['groups'] as List<dynamic>).map((e) => OnThisDayGroup.fromJson(e as Map<String, dynamic>, _api.absolute)).toList();
  }
}

final recapsRepositoryProvider = Provider<RecapsRepository>((ref) => RecapsRepository(ref.watch(apiClientProvider)));

/// Rückblicke der gewählten Familie; `ref.invalidate` nach Erstellen/Löschen oder Push.
final recapsProvider = FutureProvider<List<RecapItem>>((ref) async {
  final family = ref.watch(selectedFamilyProvider);
  if (family == null) return const [];
  return ref.watch(recapsRepositoryProvider).list(family.id);
});

final onThisDayProvider = FutureProvider<List<OnThisDayGroup>>((ref) async {
  final family = ref.watch(selectedFamilyProvider);
  if (family == null) return const [];
  return ref.watch(recapsRepositoryProvider).onThisDay(family.id);
});
