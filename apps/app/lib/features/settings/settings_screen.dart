import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/app_logo.dart';
import '../../widgets/user_avatar.dart';
import '../auth/auth_controller.dart';
import '../auth/auth_models.dart';
import '../admin/admin_models.dart';
import '../admin/admin_repository.dart';
import '../autoupload/auto_upload_section.dart';
import 'avatar_sheet.dart';
import 'export_download.dart';
import '../recaps/create_recap_dialog.dart';
import 'profile_dialogs.dart';
import 'storage_card.dart';
import '../autoupload/auto_upload_service.dart';
import '../timeline/timeline_controller.dart';

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
              child: Column(
                children: [
                  ListTile(
                    leading: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        UserAvatar(name: me.displayName, avatarUrl: me.avatarUrl, size: 56),
                        Positioned(
                          right: -6,
                          bottom: -6,
                          child: Container(
                            width: 24,
                            height: 24,
                            decoration: BoxDecoration(color: scheme.secondary, shape: BoxShape.circle, border: Border.all(color: scheme.surfaceContainerLowest, width: 2)),
                            child: Icon(Icons.photo_camera_outlined, size: 14, color: scheme.onSecondary),
                          ),
                        ),
                      ],
                    ),
                    title: Text(me.displayName, style: text.titleMedium),
                    subtitle: Text(me.avatarUrl == null ? 'Tippen für ein Profilbild' : me.email),
                    trailing: me.isAdmin ? const Chip(label: Text('Admin')) : null,
                    onTap: () => showAvatarSheet(context, ref),
                  ),
                  const Divider(height: 1),
                  ListTile(
                    leading: _IconBadge(Icons.badge_outlined, scheme.primaryContainer),
                    title: const Text('Anzeigename ändern'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => showRenameDialog(context, ref),
                  ),
                  ListTile(
                    leading: _IconBadge(Icons.lock_reset, scheme.tertiaryContainer),
                    title: const Text('Passwort ändern'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => showChangePasswordDialog(context, ref),
                  ),
                ],
              ),
            ),
          if (me != null && ((selected?.membership.isFamilyAdmin ?? false) || me.isAdmin)) ...[
            const SizedBox(height: 24),
            _SectionTitle('Verwaltung'),
            Card(
              child: Column(
                children: [
                  if (selected != null && selected.membership.isFamilyAdmin)
                    ListTile(
                      leading: _IconBadge(Icons.group_outlined, scheme.secondaryContainer),
                      title: Text('Mitglieder von ${selected.name}'),
                      subtitle: const Text('Rechte, Konten anlegen, Einladungen'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/settings/members/${selected.id}'),
                    ),
                  if (me.isAdmin) ...[
                    ListTile(
                      leading: _IconBadge(Icons.manage_accounts_outlined, scheme.primaryContainer),
                      title: const Text('Benutzer'),
                      subtitle: const Text('Alle Konten, Admin-Rechte, Sperren'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/settings/users'),
                    ),
                    ListTile(
                      leading: _IconBadge(Icons.photo_album_outlined, scheme.tertiaryContainer),
                      title: const Text('Alben'),
                      subtitle: const Text('Anlegen, löschen, Mitglied werden'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/settings/families'),
                    ),
                  ],
                ],
              ),
            ),
          ],
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
          if (selected != null) ...[
            const SizedBox(height: 24),
            _SectionTitle('Zuletzt im Album'),
            _LastSeenCard(familyId: selected.id, meId: me?.id),
            const SizedBox(height: 24),
            _SectionTitle('Speicherplatz'),
            StorageCard(familyId: selected.id),
          ],
          const SizedBox(height: 24),
          _SectionTitle('Alben'),
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
                  leading: _IconBadge(Icons.key_outlined, scheme.secondaryContainer),
                  title: const Text('Einladungscode einlösen'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.go('/invite'),
                ),
              ],
            ),
          ),
          if (selected != null && selected.membership.canUpload) ...[
            const SizedBox(height: 24),
            _SectionTitle('Rückblicke'),
            Card(
              child: ListTile(
                leading: _IconBadge(Icons.movie_creation_outlined, scheme.tertiaryContainer),
                title: const Text('Rückblick erstellen'),
                subtitle: const Text('Monat, Jahr oder Sekunden-Film. Monats- und Jahresvideos entstehen auch automatisch.'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => showCreateRecapDialog(context, ref, selected.id),
              ),
            ),
          ],
          if (selected != null && selected.membership.canDownload) ...[
            const SizedBox(height: 24),
            _SectionTitle('Export'),
            Card(
              child: Column(
                children: [
                  ListTile(
                    leading: _IconBadge(Icons.archive_outlined, scheme.primaryContainer),
                    title: const Text('Alle Fotos, Videos und Kommentare'),
                    subtitle: const Text('ZIP mit Originalen nach Jahr/Monat, Kommentare als Datei. Am besten am Computer.'),
                    trailing: const Icon(Icons.download_outlined),
                    onTap: () => _export(context, ref, selected.id, 'alle'),
                  ),
                  const Divider(height: 1),
                  ListTile(
                    leading: _IconBadge(Icons.calendar_month_outlined, scheme.secondaryContainer),
                    title: const Text('Einzelnen Monat exportieren'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _exportMonth(context, ref, selected.id),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 24),
          _SectionTitle('Verbindung'),
          Card(
            child: ListTile(
              leading: _IconBadge(Icons.dns_outlined, scheme.surfaceContainerHigh),
              title: const Text('Server'),
              subtitle: Text(settings.baseUrl),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _changeServer(context, ref, settings.baseUrl),
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
                _VersionLabel(style: text.bodySmall?.copyWith(color: scheme.outline)),
                if (settings.baseUrl.isNotEmpty)
                  TextButton(
                    onPressed: () => launchUrl(Uri.parse('${settings.baseUrl}/datenschutz.html'), mode: LaunchMode.externalApplication),
                    child: const Text('Datenschutzerklärung'),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _rights(MembershipFlags m) {
    final parts = <String>[
      if (m.isFamilyAdmin) 'Album-Admin',
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

/// Server wechseln: neue URL abfragen, lokale Session verwerfen, zum Login-Screen.
Future<void> _changeServer(BuildContext context, WidgetRef ref, String current) async {
  final controller = TextEditingController(text: current);
  final formKey = GlobalKey<FormState>();
  final url = await showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Server wechseln'),
      content: Form(
        key: formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Du wirst abgemeldet und musst dich auf dem neuen Server neu anmelden.'),
            const SizedBox(height: 16),
            TextFormField(
              controller: controller,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Server-URL', hintText: 'https://album.example.ch'),
              keyboardType: TextInputType.url,
              autocorrect: false,
              validator: (v) {
                final u = Uri.tryParse((v ?? '').trim());
                if (u == null || !u.hasScheme || u.host.isEmpty) return 'Bitte eine gültige URL angeben (https://…)';
                return null;
              },
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Abbrechen')),
        FilledButton(
          onPressed: () {
            if (formKey.currentState!.validate()) Navigator.pop(ctx, controller.text.trim());
          },
          child: const Text('Wechseln'),
        ),
      ],
    ),
  );
  controller.dispose();
  if (url == null || url.isEmpty) return;
  await ref.read(authControllerProvider.notifier).switchServer(url);
}

/// Export starten: signierten Link holen und im Browser öffnen – der Download läuft dort, ohne Token.
Future<void> _export(BuildContext context, WidgetRef ref, String familyId, String scope) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    final url = await ref.read(timelineRepositoryProvider).exportLink(familyId, scope);
    if (!exportInApp) {
      final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      if (!ok) messenger.showSnackBar(const SnackBar(content: Text('Download konnte nicht geöffnet werden.')));
      return;
    }
    if (!context.mounted) return;
    // Handy: in der App laden (Fortschritt, abbrechbar), danach Teilen-Blatt → «In Dateien sichern»
    final cancel = CancelToken();
    final progress = ValueNotifier<String>('Wird vorbereitet …');
    var dialogOpen = true;
    unawaited(
      showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          title: const Text('Export wird geladen'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const LinearProgressIndicator(),
              const SizedBox(height: 12),
              ValueListenableBuilder<String>(valueListenable: progress, builder: (_, v, _) => Text(v)),
              const SizedBox(height: 4),
              Text('Danach erscheint das Teilen-Blatt – dort «In Dateien sichern» wählen.', style: Theme.of(ctx).textTheme.bodySmall),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () {
                cancel.cancel();
                Navigator.pop(ctx);
              },
              child: const Text('Abbrechen'),
            ),
          ],
        ),
      ).then((_) => dialogOpen = false),
    );
    try {
      await downloadAndShareExport(
        ref.read(apiClientProvider).dio,
        url: url,
        fileName: 'Familienalbum-$scope.zip',
        cancel: cancel,
        onProgress: (received, total) {
          final mb = (received / (1024 * 1024)).toStringAsFixed(1);
          progress.value = total == null ? '$mb MB geladen …' : '$mb von ${(total / (1024 * 1024)).toStringAsFixed(1)} MB';
        },
      );
    } finally {
      if (dialogOpen && context.mounted) Navigator.of(context, rootNavigator: true).pop();
    }
  } on DioException catch (e) {
    if (e.type != DioExceptionType.cancel) messenger.showSnackBar(SnackBar(content: Text(errorMessage(e))));
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(errorMessage(e))));
  }
}

/// Monat wählen (Jahr/Monat), dann exportieren.
Future<void> _exportMonth(BuildContext context, WidgetRef ref, String familyId) async {
  final now = DateTime.now();
  var year = now.year;
  var month = now.month;
  const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  final scope = await showDialog<String>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) => AlertDialog(
        title: const Text('Monat exportieren'),
        content: Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<int>(
                initialValue: month,
                decoration: const InputDecoration(labelText: 'Monat'),
                items: [for (var i = 1; i <= 12; i++) DropdownMenuItem(value: i, child: Text(months[i - 1]))],
                onChanged: (v) => setState(() => month = v ?? month),
              ),
            ),
            const SizedBox(width: 12),
            SizedBox(
              width: 100,
              child: DropdownButtonFormField<int>(
                initialValue: year,
                decoration: const InputDecoration(labelText: 'Jahr'),
                items: [for (var y = now.year; y >= now.year - 30; y--) DropdownMenuItem(value: y, child: Text('$y'))],
                onChanged: (v) => setState(() => year = v ?? year),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Abbrechen')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, '$year-${month.toString().padLeft(2, '0')}'),
            child: const Text('Exportieren'),
          ),
        ],
      ),
    ),
  );
  if (scope == null || !context.mounted) return;
  await _export(context, ref, familyId, scope);
}

/// «Version 0.1.0 (14)» aus dem Build – damit Tester sagen können, welchen Stand sie haben.
class _VersionLabel extends StatelessWidget {
  const _VersionLabel({this.style});
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<PackageInfo>(
      future: PackageInfo.fromPlatform(),
      builder: (context, snap) {
        final info = snap.data;
        final label = info == null ? 'Selbst gehostet' : 'Version ${info.version} (${info.buildNumber}) · selbst gehostet';
        return Text(label, style: style);
      },
    );
  }
}

/// Farbige Icon-Kachel für Listeneinträge (Richtung «Kinderbuch»).
class _IconBadge extends StatelessWidget {
  const _IconBadge(this.icon, this.color);
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(14)),
      child: Icon(icon, size: 20, color: scheme.onSurface),
    );
  }
}

/// Wer war zuletzt im Album – aus `lastSeenAt` der Mitglieder (wird beim Aufruf der API gesetzt).
final _lastSeenProvider = FutureProvider.family<List<MemberItem>, String>((ref, familyId) => ref.watch(adminRepositoryProvider).members(familyId));

class _LastSeenCard extends ConsumerWidget {
  const _LastSeenCard({required this.familyId, required this.meId});
  final String familyId;
  final String? meId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final members = ref.watch(_lastSeenProvider(familyId));
    return Card(
      child: members.when(
        loading: () => const Padding(padding: EdgeInsets.all(20), child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)))),
        error: (e, _) => Padding(padding: const EdgeInsets.all(16), child: Text(errorMessage(e), style: TextStyle(color: scheme.error))),
        data: (list) {
          final sorted = [...list]..sort((a, b) => (b.lastSeenAt ?? DateTime(2000)).compareTo(a.lastSeenAt ?? DateTime(2000)));
          return Column(
            children: [
              for (final m in sorted)
                ListTile(
                  leading: UserAvatar(name: m.displayName, avatarUrl: m.avatarUrl, size: 40, color: m.userId == meId ? scheme.primary : scheme.secondary, foregroundColor: m.userId == meId ? scheme.onPrimary : scheme.onSecondary),
                  title: Text(m.userId == meId ? '${m.displayName} (du)' : m.displayName),
                  subtitle: Text(_relative(m.lastSeenAt), style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
                  trailing: _isOnline(m.lastSeenAt)
                      ? Container(width: 10, height: 10, decoration: BoxDecoration(color: scheme.secondary, shape: BoxShape.circle))
                      : null,
                ),
            ],
          );
        },
      ),
    );
  }

  static bool _isOnline(DateTime? t) => t != null && DateTime.now().difference(t) < const Duration(minutes: 10);

  static String _relative(DateTime? t) {
    if (t == null) return 'Noch nie im Album gewesen';
    final d = DateTime.now().difference(t);
    if (d.inMinutes < 10) return 'Gerade jetzt';
    if (d.inHours < 1) return 'Vor ${d.inMinutes} Minuten';
    if (d.inHours < 24) return d.inHours == 1 ? 'Vor 1 Stunde' : 'Vor ${d.inHours} Stunden';
    if (d.inDays == 1) return 'Gestern';
    if (d.inDays < 7) return 'Vor ${d.inDays} Tagen';
    if (d.inDays < 30) return d.inDays < 14 ? 'Vor 1 Woche' : 'Vor ${d.inDays ~/ 7} Wochen';
    return 'Am ${t.toLocal().day}.${t.toLocal().month}.${t.toLocal().year}';
  }
}
