import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_exception.dart';
import '../auth/auth_controller.dart';
import 'admin_repository.dart';

/// Album umbenennen (PATCH /families/:id, Album-Admin). Gibt true zurück, wenn umbenannt wurde.
Future<bool> showRenameFamilyDialog(BuildContext context, WidgetRef ref, {required String familyId, required String currentName}) async {
  final controller = TextEditingController(text: currentName);
  final formKey = GlobalKey<FormState>();
  final name = await showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Album umbenennen'),
      content: Form(
        key: formKey,
        child: TextFormField(
          controller: controller,
          autofocus: true,
          maxLength: 80,
          decoration: const InputDecoration(labelText: 'Name des Albums', prefixIcon: Icon(Icons.photo_album_outlined)),
          validator: (v) => (v ?? '').trim().isEmpty ? 'Bitte einen Namen eingeben' : null,
          onFieldSubmitted: (_) {
            if (formKey.currentState!.validate()) Navigator.pop(ctx, controller.text.trim());
          },
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Abbrechen')),
        FilledButton(
          onPressed: () {
            if (formKey.currentState!.validate()) Navigator.pop(ctx, controller.text.trim());
          },
          child: const Text('Speichern'),
        ),
      ],
    ),
  );
  if (name == null || name == currentName) return false;
  try {
    await ref.read(adminRepositoryProvider).renameFamily(familyId, name);
    await ref.read(authControllerProvider.notifier).refreshMe();
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Album heisst jetzt «$name»')));
    return true;
  } catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(e))));
    return false;
  }
}
