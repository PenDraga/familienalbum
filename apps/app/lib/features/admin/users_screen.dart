import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/api_exception.dart';
import '../auth/auth_controller.dart';
import '../auth/auth_models.dart';
import 'admin_models.dart';
import 'admin_repository.dart';
import 'rights_editor.dart';

/// Globaler Admin: alle Benutzer suchen, anlegen, ändern, sperren, Familien zuweisen.
class UsersScreen extends ConsumerStatefulWidget {
  const UsersScreen({super.key});

  @override
  ConsumerState<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends ConsumerState<UsersScreen> {
  final _search = TextEditingController();
  Timer? _debounce;
  late Future<List<AdminUser>> _future = _load();

  Future<List<AdminUser>> _load() => ref.read(adminRepositoryProvider).users(q: _search.text.trim().isEmpty ? null : _search.text.trim());
  void _refresh() => setState(() => _future = _load());

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  void _onSearch(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), _refresh);
  }

  Future<void> _create() async {
    final ok = await showDialog<bool>(context: context, builder: (_) => const _UserDialog());
    if (ok == true) _refresh();
  }

  Future<void> _open(AdminUser u) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _UserDetailSheet(userId: u.id),
    );
    if (changed == true) _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final me = ref.watch(meProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Benutzer'),
        leading: BackButton(onPressed: () => context.canPop() ? context.pop() : context.go('/settings')),
      ),
      floatingActionButton: FloatingActionButton.extended(onPressed: _create, icon: const Icon(Icons.person_add_alt_1_outlined), label: const Text('Benutzer anlegen')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: TextField(
              controller: _search,
              onChanged: _onSearch,
              decoration: InputDecoration(
                hintText: 'Name oder E-Mail suchen',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _search.clear();
                          _refresh();
                        },
                      ),
              ),
            ),
          ),
          Expanded(
            child: FutureBuilder<List<AdminUser>>(
              future: _future,
              builder: (context, snap) {
                if (snap.hasError) return Center(child: Text(errorMessage(snap.error!)));
                if (!snap.hasData) return const Center(child: CircularProgressIndicator());
                final users = snap.data!;
                if (users.isEmpty) return Center(child: Text('Keine Benutzer gefunden', style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)));
                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                  itemCount: users.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 6),
                  itemBuilder: (_, i) {
                    final u = users[i];
                    return Card(
                      child: ListTile(
                        onTap: () => _open(u),
                        leading: CircleAvatar(
                          backgroundColor: u.isDisabled ? scheme.surfaceContainerHighest : (u.isAdmin ? scheme.primaryContainer : scheme.secondaryContainer),
                          foregroundColor: u.isDisabled ? scheme.outline : (u.isAdmin ? scheme.onPrimaryContainer : scheme.onSecondaryContainer),
                          child: Text(u.displayName.isNotEmpty ? u.displayName[0].toUpperCase() : '?'),
                        ),
                        title: Text(
                          u.id == me?.id ? '${u.displayName} (du)' : u.displayName,
                          style: text.titleMedium?.copyWith(decoration: u.isDisabled ? TextDecoration.lineThrough : null),
                        ),
                        subtitle: Text(u.email),
                        trailing: Wrap(
                          spacing: 6,
                          children: [
                            if (u.isAdmin) const Chip(label: Text('Admin'), visualDensity: VisualDensity.compact),
                            if (u.isDisabled) Chip(label: const Text('Gesperrt'), backgroundColor: scheme.errorContainer, visualDensity: VisualDensity.compact),
                          ],
                        ),
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Anlegen (ohne userId) oder Passwort/Name eines bestehenden Benutzers ändern.
class _UserDialog extends ConsumerStatefulWidget {
  const _UserDialog({this.existing});
  final AdminUser? existing;

  @override
  ConsumerState<_UserDialog> createState() => _UserDialogState();
}

class _UserDialogState extends ConsumerState<_UserDialog> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: widget.existing?.displayName ?? '');
  late final _email = TextEditingController(text: widget.existing?.email ?? '');
  final _password = TextEditingController();
  late bool _isAdmin = widget.existing?.isAdmin ?? false;
  bool _busy = false;
  String? _error;

  bool get _isNew => widget.existing == null;

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
      final repo = ref.read(adminRepositoryProvider);
      if (_isNew) {
        await repo.createUser(email: _email.text.trim(), password: _password.text, displayName: _name.text.trim(), isAdmin: _isAdmin);
      } else {
        await repo.updateUser(
          widget.existing!.id,
          displayName: _name.text.trim() == widget.existing!.displayName ? null : _name.text.trim(),
          password: _password.text.isEmpty ? null : _password.text,
        );
      }
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
      title: Text(_isNew ? 'Benutzer anlegen' : 'Benutzer bearbeiten'),
      content: SizedBox(
        width: 400,
        child: Form(
          key: _form,
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
                enabled: _isNew,
                decoration: const InputDecoration(labelText: 'E-Mail', prefixIcon: Icon(Icons.mail_outline)),
                keyboardType: TextInputType.emailAddress,
                validator: (v) => (v == null || !v.contains('@')) ? 'E-Mail-Adresse angeben' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _password,
                decoration: InputDecoration(
                  labelText: _isNew ? 'Startpasswort (min. 8 Zeichen)' : 'Neues Passwort (leer = unverändert)',
                  prefixIcon: const Icon(Icons.lock_outline),
                ),
                validator: (v) => (_isNew || (v != null && v.isNotEmpty)) && (v == null || v.length < 8) ? 'Mindestens 8 Zeichen' : null,
              ),
              if (_isNew)
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Globaler Admin'),
                  subtitle: const Text('Darf Benutzer und Alben verwalten'),
                  value: _isAdmin,
                  onChanged: (v) => setState(() => _isAdmin = v),
                ),
              if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.pop(context, false), child: const Text('Abbrechen')),
        FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Speichert …' : (_isNew ? 'Anlegen' : 'Speichern'))),
      ],
    );
  }
}

/// Detail eines Benutzers: Status, Familien, Aktionen.
class _UserDetailSheet extends ConsumerStatefulWidget {
  const _UserDetailSheet({required this.userId});
  final String userId;

  @override
  ConsumerState<_UserDetailSheet> createState() => _UserDetailSheetState();
}

class _UserDetailSheetState extends ConsumerState<_UserDetailSheet> {
  late Future<AdminUserDetail> _future = ref.read(adminRepositoryProvider).user(widget.userId);
  bool _changed = false;

  void _reload() => setState(() {
    _future = ref.read(adminRepositoryProvider).user(widget.userId);
    _changed = true;
  });

  void _snack(String msg) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

  /// Konto löschen: Sicherheitsabfrage mit dem Namen, dann anonymisiert der Server das Konto.
  Future<void> _delete(AdminUserDetail u) async {
    final controller = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: Text('${u.displayName} löschen?'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Das Konto wird endgültig gelöscht: E-Mail, Name, Passwort, Profilbild, Geräte und Mitgliedschaften. '
                'Fotos, Videos und Kommentare bleiben im Album und tragen danach «Gelöschtes Konto» als Urheber.',
              ),
              const SizedBox(height: 12),
              TextField(
                controller: controller,
                autofocus: true,
                decoration: InputDecoration(labelText: 'Zur Bestätigung «${u.displayName}» eingeben'),
                onChanged: (_) => setState(() {}),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Abbrechen')),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error),
              onPressed: controller.text.trim() == u.displayName.trim() ? () => Navigator.pop(ctx, true) : null,
              child: const Text('Endgültig löschen'),
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await ref.read(adminRepositoryProvider).deleteUser(u.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Konto von ${u.displayName} gelöscht')));
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(e))));
    }
  }

  Future<void> _toggle(AdminUserDetail u, {bool? isAdmin, bool? isDisabled}) async {
    try {
      await ref.read(adminRepositoryProvider).updateUser(u.id, isAdmin: isAdmin, isDisabled: isDisabled);
      _reload();
    } catch (e) {
      _snack(errorMessage(e));
    }
  }

  Future<void> _addToFamily(AdminUserDetail u) async {
    final repo = ref.read(adminRepositoryProvider);
    List<AdminFamily> families;
    try {
      families = await repo.families();
    } catch (e) {
      _snack(errorMessage(e));
      return;
    }
    final available = families.where((f) => !u.families.any((x) => x.id == f.id)).toList();
    if (!mounted) return;
    if (available.isEmpty) {
      _snack('Ist bereits in allen Alben.');
      return;
    }
    final picked = await showModalBottomSheet<AdminFamily>(
      context: context,
      builder: (ctx) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            Padding(padding: const EdgeInsets.all(16), child: Text('Zu Album hinzufügen', style: Theme.of(ctx).textTheme.titleLarge)),
            for (final f in available)
              ListTile(leading: const Icon(Icons.photo_album_outlined), title: Text(f.name), subtitle: Text('${f.memberCount} Mitglieder'), onTap: () => Navigator.pop(ctx, f)),
          ],
        ),
      ),
    );
    if (picked == null || !mounted) return;
    final flags = await showRightsSheet(
      context,
      title: 'Rechte in ${picked.name}',
      initial: const MembershipFlags(isFamilyAdmin: false, canUpload: true, canDownload: false, canComment: true),
    );
    if (flags == null) return;
    try {
      await repo.addUserToFamily(picked.id, u.id, flagsToJson(flags));
      if (u.id == ref.read(meProvider)?.id) await ref.read(authControllerProvider.notifier).refreshMe();
      _reload();
    } catch (e) {
      _snack(errorMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(meProvider);
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final fmt = DateFormat.yMd('de_CH');

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_changed);
      },
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.75,
        maxChildSize: 0.95,
        builder: (_, controller) => FutureBuilder<AdminUserDetail>(
          future: _future,
          builder: (context, snap) {
            if (snap.hasError) return Center(child: Text(errorMessage(snap.error!)));
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final u = snap.data!;
            final isMe = u.id == me?.id;
            return ListView(
              controller: controller,
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
              children: [
                Row(
                  children: [
                    CircleAvatar(radius: 24, child: Text(u.displayName.isNotEmpty ? u.displayName[0].toUpperCase() : '?')),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(u.displayName, style: text.titleLarge),
                          Text(u.email, style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)),
                          Text('Seit ${fmt.format(u.createdAt.toLocal())} · ${u.deviceCount} Gerät${u.deviceCount == 1 ? '' : 'e'} mit Push', style: text.bodySmall?.copyWith(color: scheme.outline)),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Name / Passwort',
                      icon: const Icon(Icons.edit_outlined),
                      onPressed: () async {
                        final ok = await showDialog<bool>(context: context, builder: (_) => _UserDialog(existing: u));
                        if (ok == true) _reload();
                      },
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                SwitchListTile(
                  secondary: const Icon(Icons.admin_panel_settings_outlined),
                  title: const Text('Globaler Admin'),
                  subtitle: Text(isMe ? 'Dir selbst kannst du das nicht entziehen' : 'Verwaltet Benutzer und Alben'),
                  value: u.isAdmin,
                  onChanged: isMe ? null : (v) => _toggle(u, isAdmin: v),
                ),
                SwitchListTile(
                  secondary: Icon(Icons.block, color: u.isDisabled ? scheme.error : null),
                  title: const Text('Gesperrt'),
                  subtitle: Text(isMe ? 'Dich selbst kannst du nicht sperren' : 'Kann sich nicht mehr anmelden, alle Sitzungen werden beendet'),
                  value: u.isDisabled,
                  onChanged: isMe ? null : (v) => _toggle(u, isDisabled: v),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Text('Alben', style: text.titleMedium),
                    const Spacer(),
                    TextButton.icon(onPressed: () => _addToFamily(u), icon: const Icon(Icons.add), label: const Text('Hinzufügen')),
                  ],
                ),
                if (u.families.isEmpty)
                  Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text('In keinem Album', style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant))),
                for (final f in u.families)
                  Card(
                    margin: const EdgeInsets.only(bottom: 6),
                    child: ListTile(
                      leading: const Icon(Icons.photo_album_outlined),
                      title: Text(f.name),
                      subtitle: Text(describeRights(f.membership)),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/settings/members/${f.id}'),
                    ),
                  ),
                const SizedBox(height: 24),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(foregroundColor: scheme.error, side: BorderSide(color: scheme.error.withValues(alpha: 0.5))),
                  onPressed: isMe ? null : () => _delete(u),
                  icon: const Icon(Icons.person_off_outlined),
                  label: Text(isMe ? 'Dein eigenes Konto kannst du nicht löschen' : 'Konto löschen'),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
