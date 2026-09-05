import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_exception.dart';
import '../auth/auth_controller.dart';
import 'activity_models.dart';
import 'activity_repository.dart';

/// Ungelesen-Zähler der gewählten Familie (Glocke). Fragt jede Minute nach; [refresh] für sofort.
class UnreadController extends AsyncNotifier<UnreadCounts> {
  Timer? _timer;

  @override
  Future<UnreadCounts> build() async {
    final family = ref.watch(selectedFamilyProvider);
    _timer?.cancel();
    if (family == null) return UnreadCounts.zero;
    _timer = Timer.periodic(const Duration(seconds: 60), (_) => refresh());
    ref.onDispose(() => _timer?.cancel());
    return ref.read(activityRepositoryProvider).unread(family.id);
  }

  Future<void> refresh() async {
    final family = ref.read(selectedFamilyProvider);
    if (family == null) return;
    try {
      state = AsyncData(await ref.read(activityRepositoryProvider).unread(family.id));
    } catch (_) {
      // Netzwerkfehler beim Polling still ignorieren, alter Wert bleibt
    }
  }

  /// Nach „gesehen“: sofort auf null, ohne Roundtrip.
  void clear() => state = const AsyncData(UnreadCounts.zero);
}

final unreadProvider = AsyncNotifierProvider<UnreadController, UnreadCounts>(UnreadController.new);

class FeedState {
  const FeedState({required this.items, required this.nextCursor, required this.seenAt, this.loadingMore = false, this.error});
  final List<FeedItem> items;
  final String? nextCursor;
  final DateTime seenAt;
  final bool loadingMore;
  final String? error;

  bool get hasMore => nextCursor != null;

  FeedState copyWith({List<FeedItem>? items, String? nextCursor, bool clearCursor = false, bool? loadingMore, String? error}) => FeedState(
    items: items ?? this.items,
    nextCursor: clearCursor ? null : (nextCursor ?? this.nextCursor),
    seenAt: seenAt,
    loadingMore: loadingMore ?? this.loadingMore,
    error: error,
  );
}

/// Verlauf der gewählten Familie, seitenweise nachladbar. Beim Öffnen wird alles als gesehen markiert,
/// die Einträge behalten ihre Ungelesen-Markierung aber bis zum nächsten Öffnen (so sieht man, was neu war).
class FeedController extends AsyncNotifier<FeedState> {
  static const _pageSize = 30;

  String? get _familyId => ref.read(selectedFamilyProvider)?.id;

  @override
  Future<FeedState> build() async {
    final family = ref.watch(selectedFamilyProvider);
    if (family == null) return FeedState(items: const [], nextCursor: null, seenAt: DateTime.now());
    final page = await ref.watch(activityRepositoryProvider).feed(family.id, limit: _pageSize);
    return FeedState(items: page.items, nextCursor: page.nextCursor, seenAt: page.seenAt);
  }

  Future<void> loadMore() async {
    final current = state.whenOrNull(data: (s) => s);
    final familyId = _familyId;
    if (current == null || !current.hasMore || current.loadingMore || familyId == null) return;
    state = AsyncData(current.copyWith(loadingMore: true));
    try {
      final page = await ref.read(activityRepositoryProvider).feed(familyId, cursor: current.nextCursor, limit: _pageSize);
      final known = current.items.map((i) => i.id).toSet();
      state = AsyncData(
        current.copyWith(items: [...current.items, ...page.items.where((i) => !known.contains(i.id))], nextCursor: page.nextCursor, loadingMore: false),
      );
    } catch (e) {
      state = AsyncData(current.copyWith(loadingMore: false, error: errorMessage(e)));
    }
  }

  Future<void> refresh() async {
    final familyId = _familyId;
    if (familyId == null) return;
    try {
      final page = await ref.read(activityRepositoryProvider).feed(familyId, limit: _pageSize);
      state = AsyncData(FeedState(items: page.items, nextCursor: page.nextCursor, seenAt: page.seenAt));
    } catch (e, st) {
      if (state.hasValue) return;
      state = AsyncError(e, st);
    }
  }

  /// Server-Zeitpunkt setzen und Glocke leeren. Die Markierungen in der Liste bleiben bis zum nächsten Laden.
  Future<void> markSeen() async {
    final familyId = _familyId;
    if (familyId == null) return;
    try {
      await ref.read(activityRepositoryProvider).markSeen(familyId);
      ref.read(unreadProvider.notifier).clear();
    } catch (_) {
      // beim nächsten Öffnen erneut
    }
  }
}

final feedProvider = AsyncNotifierProvider<FeedController, FeedState>(FeedController.new);
