import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../widgets/user_avatar.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/api_exception.dart';
import '../../l10n/l10n.dart';
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
    final flags = await showRightsSheet(context, title: context.l10n.membersRightsOf(m.displayName), initial: m.flags);
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
    final l10n = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.membersRemoveTitle(m.displayName)),
        content: Text(l10n.membersRemoveBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l10n.commonCancel)),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(l10n.membersRemoveAction),
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
    final l10n = context.l10n;
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.person_add_alt_1_outlined),
              title: Text(l10n.membersCreateAccount),
              subtitle: Text(l10n.membersCreateAccountSubtitle),
              onTap: () => Navigator.pop(ctx, 'account'),
            ),
            ListTile(
              leading: const Icon(Icons.key_outlined),
              title: Text(l10n.membersCreateInvite),
              subtitle: Text(l10n.membersCreateInviteSubtitle),
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
    final l10n = context.l10n;
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: Text(l10n.membersInviteDialogTitle),
          content: SizedBox(
            width: 380,
            child: RightsEditor(value: flags, allowAdminToggle: false, onChanged: (v) => setState(() => flags = v)),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l10n.commonCancel)),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l10n.membersGenerateCode)),
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
    final l10n = context.l10n;
    final fmt = DateFormat.yMd(context.localeTag);

    return Scaffold(
      appBar: AppBar(
        title: Text(family == null ? l10n.membersTitle : l10n.membersTitleWithFamily(family.name)),
        leading: BackButton(onPressed: () => context.canPop() ? context.pop() : context.go('/settings')),
        actions: [
          if (family != null)
            IconButton(
              tooltip: l10n.renameAlbumTitle,
              icon: const Icon(Icons.edit_outlined),
              onPressed: () => showRenameFamilyDialog(context, ref, familyId: family.id, currentName: family.name),
            ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(onPressed: _addMenu, icon: const Icon(Icons.add), label: Text(l10n.commonAdd)),
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
                    FilledButton.tonal(onPressed: _refresh, child: Text(l10n.commonRetry)),
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
                    title: Text(isMe ? l10n.commonNameYou(m.displayName) : m.displayName, style: text.titleMedium),
                    subtitle: Text(
                      l10n.membersSubtitle(
                        describeRights(l10n, m.flags),
                        m.lastSeenAt == null ? l10n.membersNeverActive : l10n.membersLastActive(fmt.format(m.lastSeenAt!.toLocal())),
                        fmt.format(m.joinedAt.toLocal()),
                      ),
                      style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                    isThreeLine: true,
                    trailing: PopupMenuButton<String>(
                      onSelected: (v) => v == 'rights' ? _editRights(m) : _remove(m),
                      itemBuilder: (_) => [
                        PopupMenuItem(value: 'rights', child: Text(l10n.membersEditRights)),
                        if (!isMe) PopupMenuItem(value: 'remove', child: Text(l10n.membersRemoveFromAlbum)),
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
    final l10n = context.l10n;
    return AlertDialog(
      title: Text(l10n.membersCreateAccount),
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
                  decoration: InputDecoration(labelText: l10n.profileDisplayName, prefixIcon: const Icon(Icons.person_outline)),
                  validator: (v) => (v == null || v.trim().isEmpty) ? l10n.authNameRequired : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _email,
                  decoration: InputDecoration(labelText: l10n.authEmailLabel, prefixIcon: const Icon(Icons.mail_outline)),
                  keyboardType: TextInputType.emailAddress,
                  validator: (v) => (v == null || !v.contains('@')) ? l10n.authEmailRequired : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _password,
                  decoration: InputDecoration(
                    labelText: l10n.membersStartPasswordLabel,
                    prefixIcon: const Icon(Icons.lock_outline),
                    helperText: l10n.membersStartPasswordHelper,
                  ),
                  validator: (v) => (v == null || v.length < 8) ? l10n.authPasswordMin8 : null,
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
        TextButton(onPressed: _busy ? null : () => Navigator.pop(context, false), child: Text(l10n.commonCancel)),
        FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? l10n.commonSaving : l10n.commonCreate)),
      ],
    );
  }
}
