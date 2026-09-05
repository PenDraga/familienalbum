import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/app_logo.dart';
import '../auth/auth_controller.dart';
import '../auth/auth_models.dart';
import '../autoupload/auto_upload_section.dart';
import '../autoupload/auto_upload_service.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(meProvider);
    final settings = ref.watch(settingsProvider);
    final selected = ref.watch(selectedFamilyProvider);
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Einstellungen'), leading: BackButton(onPressed: () => context.go('/'))),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          if (me != null)
            Card(
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: scheme.primaryContainer,
                  foregroundColor: scheme.onPrimaryContainer,
                  child: Text(me.displayName.isNotEmpty ? me.displayName[0].toUpperCase() : '?'),
                ),
                title: Text(me.displayName, style: text.titleMedium),
                subtitle: Text(me.email),
                trailing: me.isAdmin ? const Chip(label: Text('Admin')) : null,
              ),
            ),
          const SizedBox(height: 24),
          _SectionTitle('Darstellung'),
          SegmentedButton<ThemeMode>(
            segments: const [
              ButtonSegment(value: ThemeMode.system, icon: Icon(Icons.brightness_auto_outlined), label: Text('System')),
              ButtonSegment(value: ThemeMode.light, icon: Icon(Icons.light_mode_outlined), label: Text('Hell')),
              ButtonSegment(value: ThemeMode.dark, icon: Icon(Icons.dark_mode_outlined), label: Text('Dunkel')),
            ],
            selected: {settings.themeMode},
            onSelectionChanged: (s) => ref.read(settingsProvider.notifier).setThemeMode(s.first),
          ),
          if (AutoUploadService.platformSupported) ...[
            const SizedBox(height: 24),
            _SectionTitle('Automatischer Upload'),
            const AutoUploadSection(),
          ],
          const SizedBox(height: 24),
          _SectionTitle('Familien'),
          Card(
            child: Column(
              children: [
                if (me != null)
                  RadioGroup<String>(
                    groupValue: selected?.id,
                    onChanged: (id) => ref.read(settingsProvider.notifier).selectFamily(id),
                    child: Column(
                      children: [
                        for (final f in me.families)
                          RadioListTile<String>(value: f.id, title: Text(f.name), subtitle: Text(_rights(f.membership))),
                      ],
                    ),
                  ),
                ListTile(
                  leading: const Icon(Icons.key_outlined),
                  title: const Text('Einladungscode einlösen'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.go('/invite'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          _SectionTitle('Verbindung'),
          Card(
            child: ListTile(
              leading: const Icon(Icons.dns_outlined),
              title: const Text('Server'),
              subtitle: Text(settings.baseUrl),
            ),
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
            icon: const Icon(Icons.logout),
            label: const Text('Abmelden'),
          ),
          const SizedBox(height: 40),
          Center(
            child: Column(
              children: [
                const AppLogo(size: 40),
                const SizedBox(height: 8),
                Text('Familienalbum', style: text.labelLarge?.copyWith(color: scheme.onSurfaceVariant)),
                Text('Selbst gehostet · Milestone 3', style: text.bodySmall?.copyWith(color: scheme.outline)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _rights(MembershipFlags m) {
    final parts = <String>[
      if (m.isFamilyAdmin) 'Familien-Admin',
      if (m.canUpload) 'Hochladen',
      if (m.canDownload) 'Herunterladen',
      if (m.canComment) 'Kommentieren',
    ];
    return parts.isEmpty ? 'Nur ansehen' : parts.join(' · ');
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);
  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: AppTokens.gap),
      child: Text(
        title,
        style: Theme.of(context).textTheme.labelLarge?.copyWith(color: Theme.of(context).colorScheme.primary),
      ),
    );
  }
}
