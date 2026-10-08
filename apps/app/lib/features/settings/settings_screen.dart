import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../../l10n/l10n.dart';
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
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsTitle), leading: BackButton(onPressed: () => context.go('/'))),
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
                    subtitle: Text(me.avatarUrl == null ? l10n.settingsTapForAvatar : me.email),
                    trailing: me.isAdmin ? Chip(label: Text(l10n.commonAdmin)) : null,
                    onTap: () => showAvatarSheet(context, ref),
                  ),
                  const Divider(height: 1),
                  ListTile(
                    leading: _IconBadge(Icons.badge_outlined, scheme.primaryContainer),
                    title: Text(l10n.settingsChangeDisplayName),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => showRenameDialog(context, ref),
                  ),
                  ListTile(
                    leading: _IconBadge(Icons.lock_reset, scheme.tertiaryContainer),
                    title: Text(l10n.settingsChangePassword),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => showChangePasswordDialog(context, ref),
                  ),
                ],
              ),
            ),
          if (me != null && ((selected?.membership.isFamilyAdmin ?? false) || me.isAdmin)) ...[
            const SizedBox(height: 24),
            _SectionTitle(l10n.settingsSectionManagement),
            Card(
              child: Column(
                children: [
                  if (selected != null && selected.membership.isFamilyAdmin)
                    ListTile(
                      leading: _IconBadge(Icons.group_outlined, scheme.secondaryContainer),
                      title: Text(l10n.settingsMembersOf(selected.name)),
                      subtitle: Text(l10n.settingsMembersSubtitle),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/settings/members/${selected.id}'),
                    ),
                  if (me.isAdmin) ...[
                    ListTile(
                      leading: _IconBadge(Icons.manage_accounts_outlined, scheme.primaryContainer),
                      title: Text(l10n.usersTitle),
                      subtitle: Text(l10n.settingsUsersSubtitle),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/settings/users'),
                    ),
                    ListTile(
                      leading: _IconBadge(Icons.photo_album_outlined, scheme.tertiaryContainer),
                      title: Text(l10n.albumsTitle),
                      subtitle: Text(l10n.settingsAlbumsSubtitle),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/settings/families'),
                    ),
                  ],
                ],
              ),
            ),
          ],
          const SizedBox(height: 24),
          _SectionTitle(l10n.settingsSectionAppearance),
          SegmentedButton<ThemeMode>(
            segments: [
              ButtonSegment(value: ThemeMode.system, icon: const Icon(Icons.brightness_auto_outlined), label: Text(l10n.settingsThemeSystem)),
              ButtonSegment(value: ThemeMode.light, icon: const Icon(Icons.light_mode_outlined), label: Text(l10n.settingsThemeLight)),
              ButtonSegment(value: ThemeMode.dark, icon: const Icon(Icons.dark_mode_outlined), label: Text(l10n.settingsThemeDark)),
            ],
            selected: {settings.themeMode},
            onSelectionChanged: (s) => ref.read(settingsProvider.notifier).setThemeMode(s.first),
          ),
          if (AutoUploadService.platformSupported) ...[
            const SizedBox(height: 24),
            _SectionTitle(l10n.settingsSectionAutoUpload),
            const AutoUploadSection(),
          ],
          if (selected != null) ...[
            const SizedBox(height: 24),
            _SectionTitle(l10n.settingsSectionLastSeen),
            _LastSeenCard(familyId: selected.id, meId: me?.id),
            const SizedBox(height: 24),
            _SectionTitle(l10n.settingsSectionStorage),
            StorageCard(familyId: selected.id),
          ],
          const SizedBox(height: 24),
          _SectionTitle(l10n.albumsTitle),
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
                          RadioListTile<String>(value: f.id, title: Text(f.name), subtitle: Text(_rights(l10n, f.membership))),
                      ],
                    ),
                  ),
                ListTile(
                  leading: _IconBadge(Icons.key_outlined, scheme.secondaryContainer),
                  title: Text(l10n.settingsRedeemInvite),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.go('/invite'),
                ),
              ],
            ),
          ),
          if (selected != null && selected.membership.canUpload) ...[
            const SizedBox(height: 24),
            _SectionTitle(l10n.settingsSectionRecaps),
            Card(
              child: ListTile(
                leading: _IconBadge(Icons.movie_creation_outlined, scheme.tertiaryContainer),
                title: Text(l10n.settingsCreateRecap),
                subtitle: Text(l10n.settingsCreateRecapSubtitle),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => showCreateRecapDialog(context, ref, selected.id),
              ),
            ),
          ],
          if (selected != null && selected.membership.canDownload) ...[
            const SizedBox(height: 24),
            _SectionTitle(l10n.settingsSectionExport),
            Card(
              child: Column(
                children: [
                  ListTile(
                    leading: _IconBadge(Icons.archive_outlined, scheme.primaryContainer),
                    title: Text(l10n.settingsExportAll),
                    subtitle: Text(l10n.settingsExportAllSubtitle),
                    trailing: const Icon(Icons.download_outlined),
                    onTap: () => _export(context, ref, selected.id, 'alle'),
                  ),
                  const Divider(height: 1),
                  ListTile(
                    leading: _IconBadge(Icons.calendar_month_outlined, scheme.secondaryContainer),
                    title: Text(l10n.settingsExportMonth),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _exportMonth(context, ref, selected.id),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 24),
          _SectionTitle(l10n.settingsSectionConnection),
          Card(
            child: ListTile(
              leading: _IconBadge(Icons.dns_outlined, scheme.surfaceContainerHigh),
              title: Text(l10n.authServerLabel),
              subtitle: Text(settings.baseUrl),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _changeServer(context, ref, settings.baseUrl),
            ),
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
            icon: const Icon(Icons.logout),
            label: Text(l10n.settingsLogout),
          ),
          const SizedBox(height: 40),
          Center(
            child: Column(
              children: [
                const AppLogo(size: 40),
                const SizedBox(height: 8),
                Text(l10n.appTitle, style: text.labelLarge?.copyWith(color: scheme.onSurfaceVariant)),
                _VersionLabel(style: text.bodySmall?.copyWith(color: scheme.outline)),
                if (settings.baseUrl.isNotEmpty)
                  TextButton(
                    onPressed: () => launchUrl(Uri.parse('${settings.baseUrl}/datenschutz.html'), mode: LaunchMode.externalApplication),
                    child: Text(l10n.settingsPrivacyPolicy),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _rights(AppLocalizations l10n, MembershipFlags m) {
    final parts = <String>[
      if (m.isFamilyAdmin) l10n.rightsAlbumAdmin,
      if (m.canUpload) l10n.rightsUpload,
      if (m.canDownload) l10n.rightsDownload,
      if (m.canComment) l10n.rightsComment,
    ];
    return parts.isEmpty ? l10n.rightsViewOnly : parts.join(' · ');
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
  final l10n = context.l10n;
  final url = await showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(l10n.settingsChangeServerTitle),
      content: Form(
        key: formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(l10n.settingsChangeServerHint),
            const SizedBox(height: 16),
            TextFormField(
              controller: controller,
              autofocus: true,
              decoration: InputDecoration(labelText: l10n.settingsServerUrlLabel, hintText: 'https://album.example.ch'),
              keyboardType: TextInputType.url,
              autocorrect: false,
              validator: (v) {
                final u = Uri.tryParse((v ?? '').trim());
                if (u == null || !u.hasScheme || u.host.isEmpty) return l10n.authServerUrlInvalid;
                return null;
              },
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: Text(l10n.commonCancel)),
        FilledButton(
          onPressed: () {
            if (formKey.currentState!.validate()) Navigator.pop(ctx, controller.text.trim());
          },
          child: Text(l10n.settingsChangeServerAction),
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
  final l10n = context.l10n;
  try {
    final url = await ref.read(timelineRepositoryProvider).exportLink(familyId, scope);
    if (!exportInApp) {
      final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      if (!ok) messenger.showSnackBar(SnackBar(content: Text(l10n.settingsExportOpenFailed)));
      return;
    }
    if (!context.mounted) return;
    // Handy: in der App laden (Fortschritt, abbrechbar), danach Teilen-Blatt → «In Dateien sichern»
    final cancel = CancelToken();
    final progress = ValueNotifier<String>(l10n.settingsExportPreparing);
    var dialogOpen = true;
    unawaited(
      showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          title: Text(l10n.settingsExportLoadingTitle),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const LinearProgressIndicator(),
              const SizedBox(height: 12),
              ValueListenableBuilder<String>(valueListenable: progress, builder: (_, v, _) => Text(v)),
              const SizedBox(height: 4),
              Text(l10n.settingsExportShareHint, style: Theme.of(ctx).textTheme.bodySmall),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () {
                cancel.cancel();
                Navigator.pop(ctx);
              },
              child: Text(l10n.commonCancel),
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
          progress.value = total == null ? l10n.settingsExportProgressNoTotal(mb) : l10n.settingsExportProgress(mb, (total / (1024 * 1024)).toStringAsFixed(1));
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
  final l10n = context.l10n;
  final monthName = DateFormat.MMMM(context.localeTag);
  final scope = await showDialog<String>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) => AlertDialog(
        title: Text(l10n.settingsExportMonthTitle),
        content: Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<int>(
                initialValue: month,
                decoration: InputDecoration(labelText: l10n.settingsMonthLabel),
                items: [for (var i = 1; i <= 12; i++) DropdownMenuItem(value: i, child: Text(monthName.format(DateTime(2000, i))))],
                onChanged: (v) => setState(() => month = v ?? month),
              ),
            ),
            const SizedBox(width: 12),
            SizedBox(
              width: 100,
              child: DropdownButtonFormField<int>(
                initialValue: year,
                decoration: InputDecoration(labelText: l10n.settingsYearLabel),
                items: [for (var y = now.year; y >= now.year - 30; y--) DropdownMenuItem(value: y, child: Text('$y'))],
                onChanged: (v) => setState(() => year = v ?? year),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(l10n.commonCancel)),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, '$year-${month.toString().padLeft(2, '0')}'),
            child: Text(l10n.settingsExportAction),
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
        final l10n = context.l10n;
        final label = info == null ? l10n.settingsVersionSelfHosted : l10n.settingsVersionLabel(info.version, info.buildNumber);
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
    final l10n = context.l10n;
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
                  title: Text(m.userId == meId ? l10n.commonNameYou(m.displayName) : m.displayName),
                  subtitle: Text(_relative(context, m.lastSeenAt), style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
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

  static String _relative(BuildContext context, DateTime? t) {
    final l10n = context.l10n;
    if (t == null) return l10n.lastSeenNever;
    final d = DateTime.now().difference(t);
    if (d.inMinutes < 10) return l10n.lastSeenNow;
    if (d.inHours < 1) return l10n.lastSeenMinutesAgo(d.inMinutes);
    if (d.inHours < 24) return l10n.lastSeenHoursAgo(d.inHours);
    if (d.inDays == 1) return l10n.lastSeenYesterday;
    if (d.inDays < 7) return l10n.lastSeenDaysAgo(d.inDays);
    if (d.inDays < 30) return l10n.lastSeenWeeksAgo(d.inDays ~/ 7);
    return l10n.lastSeenOnDate(DateFormat.yMd(context.localeTag).format(t.toLocal()));
  }
}
