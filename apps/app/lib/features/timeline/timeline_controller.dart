import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../auth/auth_controller.dart';
import 'media_model.dart';
import 'timeline_repository.dart';

class TimelineState {
  const TimelineState({required this.items, required this.nextCursor, this.loadingMore = false, this.loadMoreError});

  final List<MediaItem> items;
  final String? nextCursor;
  final bool loadingMore;
  final String? loadMoreError;

  bool get hasMore => nextCursor != null;
  bool get hasProcessing => items.any((m) => m.status == MediaStatus.processing);

  TimelineState copyWith({List<MediaItem>? items, String? nextCursor, bool clearCursor = false, bool? loadingMore, String? loadMoreError}) =>
      TimelineState(
        items: items ?? this.items,
        nextCursor: clearCursor ? null : (nextCursor ?? this.nextCursor),
        loadingMore: loadingMore ?? this.loadingMore,
        loadMoreError: loadMoreError,
      );

  /// Gruppen nach Monat in Reihenfolge des Auftretens (Server liefert bereits sortiert).
  List<(String, List<MediaItem>)> get groups {
    final out = <(String, List<MediaItem>)>[];
    for (final m in items) {
      if (out.isEmpty || out.last.$1 != m.monthKey) {
        out.add((m.monthKey, [m]));
      } else {
        out.last.$2.add(m);
      }
    }
    return out;
  }
}

final timelineRepositoryProvider = Provider<TimelineRepository>((ref) => TimelineRepository(ref.watch(apiClientProvider)));

/// Timeline der aktuell gewählten Familie, seitenweise nachladbar.
class TimelineController extends AsyncNotifier<TimelineState> {
  static const _pageSize = 60;

  String? get _familyId => ref.read(selectedFamilyProvider)?.id;

  @override
  Future<TimelineState> build() async {
    final family = ref.watch(selectedFamilyProvider);
    if (family == null) return const TimelineState(items: [], nextCursor: null);
    final page = await ref.watch(timelineRepositoryProvider).fetch(family.id, limit: _pageSize);
    return TimelineState(items: page.items, nextCursor: page.nextCursor);
  }

  Future<void> loadMore() async {
    final current = state.whenOrNull(data: (s) => s);
    final familyId = _familyId;
    if (current == null || !current.hasMore || current.loadingMore || familyId == null) return;
    state = AsyncData(current.copyWith(loadingMore: true));
    try {
      final page = await ref.read(timelineRepositoryProvider).fetch(familyId, cursor: current.nextCursor, limit: _pageSize);
      final known = current.items.map((m) => m.id).toSet();
      state = AsyncData(
        TimelineState(
          items: [...current.items, ...page.items.where((m) => !known.contains(m.id))],
          nextCursor: page.nextCursor,
        ),
      );
    } catch (e) {
      state = AsyncData(current.copyWith(loadingMore: false, loadMoreError: errorMessage(e)));
    }
  }

  /// Erste Seite neu laden, ohne die Ansicht zu leeren (Pull-to-Refresh, Polling nach Upload).
  Future<void> refresh() async {
    final familyId = _familyId;
    if (familyId == null) return;
    final current = state.whenOrNull(data: (s) => s);
    try {
      final page = await ref.read(timelineRepositoryProvider).fetch(familyId, limit: _pageSize);
      if (current == null) {
        state = AsyncData(TimelineState(items: page.items, nextCursor: page.nextCursor));
        return;
      }
      // Neue erste Seite + bereits geladene ältere Einträge, die nicht in der ersten Seite sind
      final fresh = page.items.map((m) => m.id).toSet();
      final older = current.items.where((m) => !fresh.contains(m.id) && _isOlderThanPage(m, page.items)).toList();
      state = AsyncData(TimelineState(items: [...page.items, ...older], nextCursor: older.isEmpty ? page.nextCursor : current.nextCursor));
    } catch (e, st) {
      if (current == null) state = AsyncError(e, st);
    }
  }

  bool _isOlderThanPage(MediaItem m, List<MediaItem> page) {
    if (page.isEmpty) return true;
    final last = page.last;
    return m.takenAt.isBefore(last.takenAt) || (m.takenAt == last.takenAt && m.id.compareTo(last.id) < 0);
  }

  void replaceItem(MediaItem updated) {
    final current = state.whenOrNull(data: (s) => s);
    if (current == null) return;
    state = AsyncData(current.copyWith(items: [for (final m in current.items) m.id == updated.id ? updated : m]));
  }

  void removeItem(String id) {
    final current = state.whenOrNull(data: (s) => s);
    if (current == null) return;
    state = AsyncData(current.copyWith(items: current.items.where((m) => m.id != id).toList()));
  }
}

final timelineControllerProvider = AsyncNotifierProvider<TimelineController, TimelineState>(TimelineController.new);
