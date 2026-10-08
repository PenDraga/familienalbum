import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_exception.dart';
import '../../l10n/l10n.dart';
import '../admin/admin_repository.dart';
import '../auth/auth_controller.dart';

/// Anzeigename ändern.
Future<void> showRenameDialog(BuildContext context, WidgetRef ref) async {
  final me = ref.read(meProvider);
  if (me == null) return;
  final controller = TextEditingController(text: me.displayName);
  final l10n = context.l10n;
  final result = await showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(l10n.profileDisplayName),
      content: TextField(controller: controller, autofocus: true, decoration: const InputDecoration(prefixIcon: Icon(Icons.person_outline))),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: Text(l10n.commonCancel)),
        FilledButton(onPressed: () => Navigator.pop(ctx, controller.text.trim()), child: Text(l10n.commonSave)),
      ],
    ),
  );
  if (result == null || result.isEmpty || result == me.displayName) return;
  try {
    await ref.read(adminRepositoryProvider).updateMe(displayName: result);
    await ref.read(authControllerProvider.notifier).refreshMe();
  } catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(e))));
  }
}

/// Passwort ändern (mit Bestätigung des aktuellen).
Future<void> showChangePasswordDialog(BuildContext context, WidgetRef ref) async {
  final current = TextEditingController();
  final next = TextEditingController();
  final repeat = TextEditingController();
  final form = GlobalKey<FormState>();
  String? error;
  var busy = false;
  final l10n = context.l10n;

  await showDialog<void>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) => AlertDialog(
        title: Text(l10n.settingsChangePassword),
        content: SizedBox(
          width: 380,
          child: Form(
            key: form,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: current,
                  obscureText: true,
                  autofocus: true,
                  decoration: InputDecoration(labelText: l10n.profileCurrentPassword, prefixIcon: const Icon(Icons.lock_outline)),
                  validator: (v) => (v == null || v.isEmpty) ? l10n.profileRequired : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: next,
                  obscureText: true,
                  decoration: InputDecoration(labelText: l10n.profileNewPasswordLabel, prefixIcon: const Icon(Icons.lock_reset)),
                  validator: (v) => (v == null || v.length < 8) ? l10n.authPasswordMin8 : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: repeat,
                  obscureText: true,
                  decoration: InputDecoration(labelText: l10n.profileRepeatPassword, prefixIcon: const Icon(Icons.lock_reset)),
                  validator: (v) => v != next.text ? l10n.profilePasswordMismatch : null,
                ),
                if (error != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(error!, style: TextStyle(color: Theme.of(ctx).colorScheme.error))),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(onPressed: busy ? null : () => Navigator.pop(ctx), child: Text(l10n.commonCancel)),
          FilledButton(
            onPressed: busy
                ? null
                : () async {
                    if (!form.currentState!.validate()) return;
                    setState(() {
                      busy = true;
                      error = null;
                    });
                    try {
                      await ref.read(adminRepositoryProvider).updateMe(currentPassword: current.text, newPassword: next.text);
                      if (ctx.mounted) Navigator.pop(ctx);
                      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.profilePasswordChanged)));
                    } catch (e) {
                      setState(() {
                        error = errorMessage(e);
                        busy = false;
                      });
                    }
                  },
            child: Text(busy ? l10n.commonSaving : l10n.profileChangeAction),
          ),
        ],
      ),
    ),
  );
}
