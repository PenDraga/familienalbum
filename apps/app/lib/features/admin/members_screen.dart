import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../widgets/user_avatar.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/api_exception.dart';
import '../auth/auth_controller.dart';
import '../auth/auth_models.dart';
import 'admin_models.dart';
import 'admin_repository.dart';
import 'rights_editor.dart';
import 'rename_dialog.dart';
import 'invite_share_dialog.dart';

/// Mitglieder einer Familie verwalten (Familien-Admin): Rechte, Entfernen, Hinzufügen per Konto oder Einladung.
class MembersScreen extends ConsumerStatefulWidget {
  const MembersScreen({super.key, required this.familyId});
  final String familyId;

  @override
  ConsumerState<MembersScreen> createState() => _MembersScreenState();
}

class _MembersScreenState extends ConsumerState<MembersScreen> {
  late Future<List<MemberItem>> _future = _load();

  Future<List<MemberItem>> _load() => ref.read(adminRepositoryProvider).members(widget.familyId);

  void _refresh() => setState(() => _future = _load());

  void _snack(String msg) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

  Future<void> _editRights(MemberItem m) async {
    final me = ref.read(meProvider);
    final flags = await showRightsSheet(context, title: 'Rechte von ${m.displayName}', initial: m.flags);
    if (flags == null) return;
    try {
      await ref.read(adminRepositoryProvider).updateMember(widget.familyId, m.userId, flagsToJson(flags));
      if (m.userId == me?.id) await ref.read(authControllerProvider.notifier).refreshMe();
      _refresh();
    } catch (e) {
      _snack(errorMessage(e));
    }
  }

  Future<void> _remove(MemberItem m) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('${m.displayName} entfernen?'),
        content: const Text('Die Person verliert den Zugriff auf dieses Album. Ihre hochgeladenen Fotos bleiben erhalten.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Abbrechen')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Entfernen'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(adminRepositoryProvider).removeMember(widget.familyId, m.userId);
      _refresh();
    } catch (e) {
      _snack(errorMessage(e));
    }
  }

  Future<void> _addMenu() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.person_add_alt_1_outlined),
              title: const Text('Konto anlegen'),
              subtitle: const Text('E-Mail und Startpasswort vergeben, z.B. für Grosseltern'),
              onTap: () => Navigator.pop(ctx, 'account'),
            ),
            ListTile(
              leading: const Icon(Icons.key_outlined),
              title: const Text('Einladungscode erzeugen'),
              subtitle: const Text('Die Person registriert sich selbst mit dem Code'),
              onTap: () => Navigator.pop(ctx, 'invite'),
            ),
          ],
        ),
      ),
    );
    if (!mounted) return;
    if (choice == 'account') await _createAccount();
    if (choice == 'invite') await _createInvite();
  }

  Future<void> _createAccount() async {
    final created = await showDialog<bool>(context: context, builder: (_) => _CreateAccountDialog(familyId: widget.familyId));
    if (created == true) _refresh();
  }

  Future<void> _createInvite() async {
    var flags = const MembershipFlags(isFamilyAdmin: false, canUpload: true, canDownload: false, canComment: true);
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: const Text('Einladung erstellen'),
          content: SizedBox(
            width: 380,
            child: RightsEditor(value: flags, allowAdminToggle: false, onChanged: (v) => setState(() => flags = v)),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Abbrechen')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Code erzeugen')),
          ],
        ),
      ),
    );
    if (go != true || !mounted) return;
    try {
      final code = await ref.read(adminRepositoryProvider).createInviteCode(widget.familyId, flagsToJson(flags));
      if (!mounted) return;
      final familyName = ref.read(meProvider)?.families.where((f) => f.id == widget.familyId).firstOrNull?.name ?? 'Familienalbum';
      await showInviteShareDialog(context, ref, familyName: familyName, code: code);
    } catch (e) {
      _snack(errorMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(meProvider);
    final family = me?.families.where((f) => f.id == widget.familyId).firstOrNull;
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final fmt = DateFormat.yMd('de_CH');

    return Scaffold(
      appBar: AppBar(
        title: Text(family == null ? 'Mitglieder' : 'Mitglieder · ${family.name}'),
        leading: BackButton(onPressed: () => context.canPop() ? context.pop() : context.go('/settings')),
        actions: [
          if (family != null)
            IconButton(
              tooltip: 'Album umbenennen',
              icon: const Icon(Icons.edit_outlined),
              onPressed: () => showRenameFamilyDialog(context, ref, familyId: family.id, currentName: family.name),
            ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(onPressed: _addMenu, icon: const Icon(Icons.add), label: const Text('Hinzufügen')),
      body: FutureBuilder<List<MemberItem>>(
        future: _future,
        builder: (context, snap) {
          if (snap.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(errorMessage(snap.error!), textAlign: TextAlign.center),
                    const SizedBox(height: 12),
                    FilledButton.tonal(onPressed: _refresh, child: const Text('Nochmals versuchen')),
                  ],
                ),
              ),
            );
          }
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final members = snap.data!;
          return RefreshIndicator(
            onRefresh: () async => _refresh(),
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
              itemCount: members.length,
              separatorBuilder: (_, _) => const SizedBox(height: 6),
              itemBuilder: (_, i) {
                final m = members[i];
                final isMe = m.userId == me?.id;
                return Card(
                  child: ListTile(
                    onTap: () => _editRights(m),
                    leading: UserAvatar(
                      name: m.displayName,
                      avatarUrl: m.avatarUrl,
                      size: 44,
                      color: m.flags.isFamilyAdmin ? scheme.primary : scheme.secondary,
                      foregroundColor: m.flags.isFamilyAdmin ? scheme.onPrimary : scheme.onSecondary,
                    ),
                    title: Text(isMe ? '${m.displayName} (du)' : m.displayName, style: text.titleMedium),
                    subtitle: Text(
                      '${describeRights(m.flags)}\n'
                      '${m.lastSeenAt == null ? 'Noch nie aktiv' : 'Zuletzt aktiv ${fmt.format(m.lastSeenAt!.toLocal())}'} · dabei seit ${fmt.format(m.joinedAt.toLocal())}',
                      style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                    isThreeLine: true,
                    trailing: PopupMenuButton<String>(
                      onSelected: (v) => v == 'rights' ? _editRights(m) : _remove(m),
                      itemBuilder: (_) => [
                        const PopupMenuItem(value: 'rights', child: Text('Rechte bearbeiten')),
                        if (!isMe) const PopupMenuItem(value: 'remove', child: Text('Aus dem Album entfernen')),
                      ],
                    ),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class _CreateAccountDialog extends ConsumerStatefulWidget {
  const _CreateAccountDialog({required this.familyId});
  final String familyId;

  @override
  ConsumerState<_CreateAccountDialog> createState() => _CreateAccountDialogState();
}

class _CreateAccountDialogState extends ConsumerState<_CreateAccountDialog> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  var _flags = const MembershipFlags(isFamilyAdmin: false, canUpload: true, canDownload: false, canComment: true);
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(adminRepositoryProvider).createMemberAccount(
        widget.familyId,
        email: _email.text.trim(),
        password: _password.text,
        displayName: _name.text.trim(),
        flags: flagsToJson(_flags),
      );
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      setState(() {
        _error = errorMessage(e);
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Konto anlegen'),
      content: SizedBox(
        width: 400,
        child: Form(
          key: _form,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: _name,
                  decoration: const InputDecoration(labelText: 'Anzeigename', prefixIcon: Icon(Icons.person_outline)),
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Bitte Namen angeben' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _email,
                  decoration: const InputDecoration(labelText: 'E-Mail', prefixIcon: Icon(Icons.mail_outline)),
                  keyboardType: TextInputType.emailAddress,
                  validator: (v) => (v == null || !v.contains('@')) ? 'E-Mail-Adresse angeben' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _password,
                  decoration: const InputDecoration(
                    labelText: 'Startpasswort (min. 8 Zeichen)',
                    prefixIcon: Icon(Icons.lock_outline),
                    helperText: 'Die Person kann es später in den Einstellungen ändern.',
                  ),
                  validator: (v) => (v == null || v.length < 8) ? 'Mindestens 8 Zeichen' : null,
                ),
                const SizedBox(height: 8),
                RightsEditor(value: _flags, onChanged: (v) => setState(() => _flags = v)),
                if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.pop(context, false), child: const Text('Abbrechen')),
        FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Speichert …' : 'Anlegen')),
      ],
    );
  }
}
