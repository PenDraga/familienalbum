import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_exception.dart';
import '../../l10n/l10n.dart';
import '../auth/auth_controller.dart';
import 'admin_models.dart';
import 'admin_repository.dart';
import '../settings/storage_card.dart' show formatBytes;
import 'rename_dialog.dart';

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

  Future<void> _rename(AdminFamily f) async {
    final ok = await showRenameFamilyDialog(context, ref, familyId: f.id, currentName: f.name);
    if (ok) _refresh();
  }

  Future<void> _create() async {
    final name = TextEditingController();
    var joinAsAdmin = true;
    final l10n = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: Text(l10n.familiesNewAlbum),
          content: SizedBox(
            width: 380,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(controller: name, autofocus: true, decoration: InputDecoration(labelText: l10n.familiesNameLabel, prefixIcon: const Icon(Icons.photo_album_outlined))),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(l10n.familiesJoinAsAdmin),
                  value: joinAsAdmin,
                  onChanged: (v) => setState(() => joinAsAdmin = v),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l10n.commonCancel)),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l10n.commonCreate)),
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
    final l10n = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.familiesDeleteTitle(f.name)),
        content: Text(l10n.familiesDeleteBody(f.memberCount, f.mediaCount)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l10n.commonCancel)),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(l10n.commonDelete),
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
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.albumsTitle),
        leading: BackButton(onPressed: () => context.canPop() ? context.pop() : context.go('/settings')),
      ),
      floatingActionButton: FloatingActionButton.extended(onPressed: _create, icon: const Icon(Icons.add), label: Text(l10n.familiesNewAlbum)),
      body: FutureBuilder<List<AdminFamily>>(
        future: _future,
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Text(errorMessage(snap.error!)));
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final families = snap.data!;
          if (families.isEmpty) return Center(child: Text(l10n.familiesEmpty, style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)));
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
            itemCount: families.length,
            separatorBuilder: (_, _) => const SizedBox(height: 6),
            itemBuilder: (_, i) {
              final f = families[i];
              final mine = me?.families.where((x) => x.id == f.id).firstOrNull;
              return Card(
                child: ListTile(
                  leading: CircleAvatar(backgroundColor: scheme.primaryContainer, foregroundColor: scheme.onPrimaryContainer, child: const Icon(Icons.photo_album_outlined)),
                  title: Text(f.name, style: text.titleMedium),
                  subtitle: Text(
                    '${l10n.familiesMemberCount(f.memberCount)} · ${l10n.commonPhotoCount(f.photoCount)} · ${l10n.commonVideoCount(f.videoCount)} · ${formatBytes(f.totalBytes)}'
                    '\n${mine == null ? l10n.familiesNotMember : (mine.membership.isFamilyAdmin ? l10n.familiesYouAreAdmin : l10n.familiesYouAreMember)}',
                  ),
                  isThreeLine: true,
                  onTap: mine != null && mine.membership.isFamilyAdmin ? () => context.push('/settings/members/${f.id}') : null,
                  trailing: PopupMenuButton<String>(
                    onSelected: (v) {
                      if (v == 'members') context.push('/settings/members/${f.id}');
                      if (v == 'rename') _rename(f);
                      if (v == 'join') _joinSelf(f);
                      if (v == 'delete') _delete(f);
                    },
                    itemBuilder: (_) => [
                      if (mine != null && mine.membership.isFamilyAdmin) PopupMenuItem(value: 'members', child: Text(l10n.familiesManageMembers)),
                      if (mine != null && mine.membership.isFamilyAdmin) PopupMenuItem(value: 'rename', child: Text(l10n.familiesRename)),
                      if (mine == null) PopupMenuItem(value: 'join', child: Text(l10n.familiesJoinSelfAsAdmin)),
                      PopupMenuItem(value: 'delete', child: Text(l10n.familiesDeleteAlbum)),
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
