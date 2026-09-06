import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../auth/auth_controller.dart';
import '../auth/auth_repository.dart';

/// Profilbild wählen oder entfernen. Das Bild wird auf dem Gerät auf höchstens 1024 px verkleinert
/// (HEIC wird dabei zu JPEG), der Server schneidet quadratisch zu und speichert 512×512.
Future<void> showAvatarSheet(BuildContext context, WidgetRef ref) async {
  final me = ref.read(meProvider);
  if (me == null) return;
  final action = await showModalBottomSheet<String>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 8),
          ListTile(
            leading: const Icon(Icons.photo_library_outlined),
            title: const Text('Bild aus der Mediathek wählen'),
            onTap: () => Navigator.pop(ctx, 'pick'),
          ),
          if (me.avatarUrl != null)
            ListTile(leading: const Icon(Icons.delete_outline), title: const Text('Profilbild entfernen'), onTap: () => Navigator.pop(ctx, 'remove')),
          ListTile(leading: const Icon(Icons.close), title: const Text('Abbrechen'), onTap: () => Navigator.pop(ctx)),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
  if (action == null || !context.mounted) return;
  final messenger = ScaffoldMessenger.of(context);
  final repo = AuthRepository(ref.read(apiClientProvider));
  try {
    if (action == 'remove') {
      await repo.deleteAvatar();
    } else {
      final picked = await FilePicker.pickFiles(type: FileType.image, dialogTitle: 'Profilbild wählen');
      final file = picked.firstOrNull;
      if (file == null) return;
      final bytes = await _prepare(file);
      if (bytes == null) {
        messenger.showSnackBar(const SnackBar(content: Text('Bild konnte nicht gelesen werden.')));
        return;
      }
      messenger.showSnackBar(const SnackBar(content: Text('Profilbild wird hochgeladen …'), duration: Duration(seconds: 1)));
      await repo.uploadAvatar(bytes, contentType: 'image/jpeg');
    }
    await ref.read(authControllerProvider.notifier).refreshMe();
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(errorMessage(e))));
  }
}

Future<Uint8List?> _prepare(PlatformFile file) async {
  if (kIsWeb) return file.readAsBytes(); // der Server verkleinert; Web liefert JPEG/PNG direkt
  final path = file.path;
  if (path == null) return file.readAsBytes();
  final out = await FlutterImageCompress.compressWithFile(path, minWidth: 1024, minHeight: 1024, quality: 88, format: CompressFormat.jpeg, keepExif: false);
  return out ?? await file.readAsBytes();
}
