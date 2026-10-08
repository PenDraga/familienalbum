import 'package:flutter/material.dart';

import '../../l10n/l10n.dart';
import '../auth/auth_models.dart';

/// Vier Rechte-Schalter als Formularblock (für neue und bestehende Mitglieder).
class RightsEditor extends StatelessWidget {
  const RightsEditor({super.key, required this.value, required this.onChanged, this.allowAdminToggle = true});

  final MembershipFlags value;
  final ValueChanged<MembershipFlags> onChanged;
  final bool allowAdminToggle;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        _row(Icons.upload_outlined, l10n.rightsMayUpload, value.canUpload, (v) => onChanged(_copy(canUpload: v))),
        _row(Icons.download_outlined, l10n.rightsMayDownload, value.canDownload, (v) => onChanged(_copy(canDownload: v))),
        _row(Icons.chat_bubble_outline, l10n.rightsMayComment, value.canComment, (v) => onChanged(_copy(canComment: v))),
        if (allowAdminToggle)
          _row(Icons.admin_panel_settings_outlined, l10n.rightsAlbumAdmin, value.isFamilyAdmin, (v) => onChanged(_copy(isFamilyAdmin: v)),
              subtitle: l10n.rightsAlbumAdminSubtitle),
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

String describeRights(AppLocalizations l10n, MembershipFlags m) {
  final parts = <String>[
    if (m.isFamilyAdmin) l10n.rightsAlbumAdmin,
    if (m.canUpload) l10n.rightsUpload,
    if (m.canDownload) l10n.rightsDownload,
    if (m.canComment) l10n.rightsComment,
  ];
  return parts.isEmpty ? l10n.rightsViewOnly : parts.join(' · ');
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
            FilledButton(onPressed: () => Navigator.pop(ctx, current), child: Text(ctx.l10n.commonSave)),
          ],
        ),
      ),
    ),
  );
}
