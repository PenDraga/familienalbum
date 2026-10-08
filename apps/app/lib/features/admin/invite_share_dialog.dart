import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/providers.dart';
import '../../l10n/l10n.dart';
import '../../theme/app_theme.dart';
import '../auth/invite_screen.dart' show inviteLink;

/// Zeigt einen erzeugten Einladungscode mit Link und bietet «Teilen» und «Kopieren».
/// Wird aus der Timeline (Einladen-Knopf) und aus «Mitglieder» verwendet.
Future<void> showInviteShareDialog(BuildContext context, WidgetRef ref, {required String familyName, required String code}) async {
  final baseUrl = ref.read(settingsProvider).baseUrl;
  final link = inviteLink(baseUrl, code);
  final l10n = context.l10n;
  final message = l10n.inviteShareMessage(familyName, link, baseUrl, code);
  final messenger = ScaffoldMessenger.of(context);
  await showDialog<void>(
    context: context,
    builder: (ctx) {
      final text = Theme.of(ctx).textTheme;
      final scheme = Theme.of(ctx).colorScheme;
      return AlertDialog(
        title: Text(l10n.inviteTitle),
        content: SizedBox(
          width: 380,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 16),
                decoration: BoxDecoration(color: scheme.primaryContainer.withValues(alpha: 0.6), borderRadius: BorderRadius.circular(AppTokens.radiusM)),
                child: SelectableText(code, textAlign: TextAlign.center, style: text.headlineMedium?.copyWith(letterSpacing: 4)),
              ),
              const SizedBox(height: 8),
              Text(l10n.inviteShareValidity, style: text.bodySmall),
              const SizedBox(height: 12),
              SelectableText(link, style: text.bodySmall),
              const SizedBox(height: 4),
              Text(
                l10n.inviteShareLinkHint,
                style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(l10n.commonClose)),
          TextButton.icon(
            onPressed: () {
              Clipboard.setData(ClipboardData(text: message));
              Navigator.pop(ctx);
              messenger.showSnackBar(SnackBar(content: Text(l10n.inviteShareCopied)));
            },
            icon: const Icon(Icons.copy),
            label: Text(l10n.inviteShareCopy),
          ),
          FilledButton.icon(
            onPressed: () {
              Navigator.pop(ctx);
              SharePlus.instance.share(ShareParams(text: message, subject: l10n.inviteShareSubject(familyName)));
            },
            icon: const Icon(Icons.ios_share),
            label: Text(l10n.inviteShareAction),
          ),
        ],
      );
    },
  );
}
