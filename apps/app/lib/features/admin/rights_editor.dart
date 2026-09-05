import 'package:flutter/material.dart';

import '../auth/auth_models.dart';

/// Vier Rechte-Schalter als Formularblock (für neue und bestehende Mitglieder).
class RightsEditor extends StatelessWidget {
  const RightsEditor({super.key, required this.value, required this.onChanged, this.allowAdminToggle = true});

  final MembershipFlags value;
  final ValueChanged<MembershipFlags> onChanged;
  final bool allowAdminToggle;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        _row(Icons.upload_outlined, 'Darf hochladen', value.canUpload, (v) => onChanged(_copy(canUpload: v))),
        _row(Icons.download_outlined, 'Darf Originale herunterladen', value.canDownload, (v) => onChanged(_copy(canDownload: v))),
        _row(Icons.chat_bubble_outline, 'Darf kommentieren', value.canComment, (v) => onChanged(_copy(canComment: v))),
        if (allowAdminToggle)
          _row(Icons.admin_panel_settings_outlined, 'Familien-Admin', value.isFamilyAdmin, (v) => onChanged(_copy(isFamilyAdmin: v)),
              subtitle: 'Verwaltet Mitglieder und Einladungen'),
      ],
    );
  }

  Widget _row(IconData icon, String title, bool v, ValueChanged<bool> onChanged, {String? subtitle}) => SwitchListTile(
    contentPadding: EdgeInsets.zero,
    secondary: Icon(icon),
    title: Text(title),
    subtitle: subtitle == null ? null : Text(subtitle),
    value: v,
    onChanged: onChanged,
  );

  MembershipFlags _copy({bool? isFamilyAdmin, bool? canUpload, bool? canDownload, bool? canComment}) => MembershipFlags(
    isFamilyAdmin: isFamilyAdmin ?? value.isFamilyAdmin,
    canUpload: canUpload ?? value.canUpload,
    canDownload: canDownload ?? value.canDownload,
    canComment: canComment ?? value.canComment,
  );
}

Map<String, dynamic> flagsToJson(MembershipFlags f) => {
  'isFamilyAdmin': f.isFamilyAdmin,
  'canUpload': f.canUpload,
  'canDownload': f.canDownload,
  'canComment': f.canComment,
};

String describeRights(MembershipFlags m) {
  final parts = <String>[
    if (m.isFamilyAdmin) 'Familien-Admin',
    if (m.canUpload) 'Hochladen',
    if (m.canDownload) 'Herunterladen',
    if (m.canComment) 'Kommentieren',
  ];
  return parts.isEmpty ? 'Nur ansehen' : parts.join(' · ');
}

/// Bottom-Sheet mit Rechte-Editor; liefert die neuen Rechte oder null.
Future<MembershipFlags?> showRightsSheet(BuildContext context, {required String title, required MembershipFlags initial, bool allowAdminToggle = true}) {
  var current = initial;
  return showModalBottomSheet<MembershipFlags>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => Padding(
      padding: EdgeInsets.fromLTRB(20, 4, 20, 20 + MediaQuery.viewInsetsOf(ctx).bottom),
      child: StatefulBuilder(
        builder: (ctx, setState) => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: Theme.of(ctx).textTheme.titleLarge),
            const SizedBox(height: 8),
            RightsEditor(value: current, allowAdminToggle: allowAdminToggle, onChanged: (v) => setState(() => current = v)),
            const SizedBox(height: 12),
            FilledButton(onPressed: () => Navigator.pop(ctx, current), child: const Text('Speichern')),
          ],
        ),
      ),
    ),
  );
}
