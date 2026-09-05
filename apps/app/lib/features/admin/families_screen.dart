import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_exception.dart';
import '../auth/auth_controller.dart';
import 'admin_models.dart';
import 'admin_repository.dart';

/// Globaler Admin: Familien anlegen, ansehen, löschen, sich selbst hinzufügen.
class FamiliesScreen extends ConsumerStatefulWidget {
  const FamiliesScreen({super.key});

  @override
  ConsumerState<FamiliesScreen> createState() => _FamiliesScreenState();
}

class _FamiliesScreenState extends ConsumerState<FamiliesScreen> {
  late Future<List<AdminFamily>> _future = ref.read(adminRepositoryProvider).families();

  void _refresh() => setState(() => _future = ref.read(adminRepositoryProvider).families());
  void _snack(String msg) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

  Future<void> _create() async {
    final name = TextEditingController();
    var joinAsAdmin = true;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: const Text('Neue Familie'),
          content: SizedBox(
            width: 380,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(controller: name, autofocus: true, decoration: const InputDecoration(labelText: 'Name', prefixIcon: Icon(Icons.family_restroom))),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Mich als Familien-Admin eintragen'),
                  value: joinAsAdmin,
                  onChanged: (v) => setState(() => joinAsAdmin = v),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Abbrechen')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Anlegen')),
          ],
        ),
      ),
    );
    if (ok != true || name.text.trim().isEmpty) return;
    try {
      await ref.read(adminRepositoryProvider).createFamily(name.text.trim(), initialAdminUserId: joinAsAdmin ? ref.read(meProvider)?.id : null);
      if (joinAsAdmin) await ref.read(authControllerProvider.notifier).refreshMe();
      _refresh();
    } catch (e) {
      _snack(errorMessage(e));
    }
  }

  Future<void> _joinSelf(AdminFamily f) async {
    final me = ref.read(meProvider);
    if (me == null) return;
    try {
      await ref.read(adminRepositoryProvider).addUserToFamily(f.id, me.id, {'isFamilyAdmin': true, 'canUpload': true, 'canDownload': true, 'canComment': true});
      await ref.read(authControllerProvider.notifier).refreshMe();
      _refresh();
    } catch (e) {
      _snack(errorMessage(e));
    }
  }

  Future<void> _delete(AdminFamily f) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('„${f.name}“ löschen?'),
        content: Text('${f.memberCount} Mitgliedschaften und ${f.mediaCount} Medien werden entfernt. Das lässt sich nicht rückgängig machen.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Abbrechen')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Löschen'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(adminRepositoryProvider).deleteFamily(f.id);
      await ref.read(authControllerProvider.notifier).refreshMe();
      _refresh();
    } catch (e) {
      _snack(errorMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(meProvider);
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Familien'),
        leading: BackButton(onPressed: () => context.canPop() ? context.pop() : context.go('/settings')),
      ),
      floatingActionButton: FloatingActionButton.extended(onPressed: _create, icon: const Icon(Icons.add), label: const Text('Neue Familie')),
      body: FutureBuilder<List<AdminFamily>>(
        future: _future,
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Text(errorMessage(snap.error!)));
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final families = snap.data!;
          if (families.isEmpty) return Center(child: Text('Noch keine Familien', style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)));
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
            itemCount: families.length,
            separatorBuilder: (_, _) => const SizedBox(height: 6),
            itemBuilder: (_, i) {
              final f = families[i];
              final mine = me?.families.where((x) => x.id == f.id).firstOrNull;
              return Card(
                child: ListTile(
                  leading: CircleAvatar(backgroundColor: scheme.primaryContainer, foregroundColor: scheme.onPrimaryContainer, child: const Icon(Icons.family_restroom)),
                  title: Text(f.name, style: text.titleMedium),
                  subtitle: Text(
                    '${f.memberCount} Mitglieder · ${f.mediaCount} Medien'
                    '${mine == null ? ' · du bist kein Mitglied' : (mine.membership.isFamilyAdmin ? ' · du bist Familien-Admin' : ' · du bist Mitglied')}',
                  ),
                  onTap: mine != null && mine.membership.isFamilyAdmin ? () => context.push('/settings/members/${f.id}') : null,
                  trailing: PopupMenuButton<String>(
                    onSelected: (v) {
                      if (v == 'members') context.push('/settings/members/${f.id}');
                      if (v == 'join') _joinSelf(f);
                      if (v == 'delete') _delete(f);
                    },
                    itemBuilder: (_) => [
                      if (mine != null && mine.membership.isFamilyAdmin) const PopupMenuItem(value: 'members', child: Text('Mitglieder verwalten')),
                      if (mine == null) const PopupMenuItem(value: 'join', child: Text('Mich als Familien-Admin hinzufügen')),
                      const PopupMenuItem(value: 'delete', child: Text('Familie löschen')),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
