import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Mehrfachauswahl in der Timeline (IDs der markierten Medien).
class SelectionController extends Notifier<Set<String>> {
  @override
  Set<String> build() => const {};

  bool get active => state.isNotEmpty;

  void toggle(String id) {
    final next = {...state};
    next.contains(id) ? next.remove(id) : next.add(id);
    state = next;
  }

  void addAll(Iterable<String> ids) => state = {...state, ...ids};

  void removeAll(Iterable<String> ids) => state = {...state}..removeAll(ids);

  void clear() => state = const {};
}

final selectionProvider = NotifierProvider<SelectionController, Set<String>>(SelectionController.new);
