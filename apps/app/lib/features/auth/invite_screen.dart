import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../../l10n/l10n.dart';
import '../../theme/app_theme.dart';
import '../../widgets/auth_shell.dart';
import 'auth_controller.dart';
import 'auth_models.dart';
import 'auth_repository.dart';

/// Einladung einlösen: Code → Vorschau → (angemeldet: beitreten | neu: registrieren).
/// Einladungslink: öffnet die Web-App (oder per Universal Link die App) mit Server und Code vorbelegt.
String inviteLink(String baseUrl, String code) =>
    Uri.parse(baseUrl).replace(path: '/invite', queryParameters: {'code': code, 'server': baseUrl}).toString();

/// Link mit eigenem Schema für «In der App öffnen» aus dem Browser.
String inviteAppLink(String baseUrl, String code) =>
    Uri(scheme: 'familienalbum', host: '', path: '/invite', queryParameters: {'code': code, 'server': baseUrl}).toString();

class InviteScreen extends ConsumerStatefulWidget {
  const InviteScreen({super.key, this.initialCode, this.initialServer});
  final String? initialCode;
  /// Aus dem Link (`?server=`); im Browser sonst die eigene Adresse.
  final String? initialServer;

  @override
  ConsumerState<InviteScreen> createState() => _InviteScreenState();
}

class _InviteScreenState extends ConsumerState<InviteScreen> {
  final _server = TextEditingController();
  final _code = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _name = TextEditingController();
  final _form = GlobalKey<FormState>();

  InvitePreview? _preview;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final fromLink = widget.initialServer?.trim() ?? '';
    final stored = ref.read(settingsProvider).baseUrl;
    _server.text = fromLink.isNotEmpty
        ? fromLink
        : stored.isNotEmpty
        ? stored
        : kIsWeb
        ? Uri.base.origin
        : '';
    _code.text = widget.initialCode ?? '';
    // Link mit Code und Server: Einladung direkt prüfen, ohne dass jemand tippen muss.
    if (_code.text.isNotEmpty && _server.text.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _lookup());
    }
  }

  /// Aus dem Browser in die installierte App wechseln (Schema familienalbum://).
  Future<void> _openInApp() async {
    final uri = Uri.parse(inviteAppLink(_server.text.trim(), _code.text.trim()));
    final l10n = context.l10n;
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication, webOnlyWindowName: '_self');
    if (!ok && mounted) setState(() => _error = l10n.inviteAppNotInstalled);
  }

  @override
  void dispose() {
    for (final c in [_server, _code, _email, _password, _name]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _lookup() => _run(() async {
    final l10n = context.l10n;
    await ref.read(settingsProvider.notifier).setBaseUrl(_server.text);
    final repo = AuthRepository(ref.read(apiClientProvider));
    try {
      final p = await repo.previewInvite(_code.text);
      setState(() => _preview = p);
    } on ApiException catch (e) {
      // Kein oder falscher Code: erklären, statt «ungültige Daten» zu melden – Prüfer und Grosseltern tippen hier gern ein Passwort ein
      if (e.status == 400 || e.status == 404) {
        throw ApiException(
          status: e.status,
          code: 'INVITE_INVALID',
          detail: l10n.inviteCodeInvalid,
        );
      }
      rethrow;
    }
  });

  Future<void> _accept() => _run(() async {
    if (!_form.currentState!.validate()) return;
    final repo = AuthRepository(ref.read(apiClientProvider));
    final loggedIn = ref.read(meProvider) != null;
    final tokens = loggedIn
        ? await repo.acceptInvite(_code.text)
        : await repo.acceptInvite(_code.text, email: _email.text.trim(), password: _password.text, displayName: _name.text.trim());
    final auth = ref.read(authControllerProvider.notifier);
    if (tokens != null) {
      await auth.adoptTokens(tokens);
    } else {
      await auth.refreshMe();
    }
    if (mounted) context.go('/');
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final l10n = context.l10n;
    final loggedIn = ref.watch(meProvider) != null;
    final preview = _preview;

    return AuthShell(
      title: l10n.inviteTitle,
      subtitle: preview == null
          ? l10n.inviteSubtitleEnterCode
          : loggedIn
          ? l10n.inviteSubtitleJoin
          : l10n.inviteSubtitleRegister,
      onBack: () => context.go(loggedIn ? '/' : '/login'),
      child: Form(
        key: _form,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (!loggedIn && preview == null) ...[
              TextFormField(
                controller: _server,
                decoration: InputDecoration(labelText: l10n.authServerLabel, prefixIcon: const Icon(Icons.dns_outlined)),
                keyboardType: TextInputType.url,
              ),
              const SizedBox(height: 12),
            ],
            if (preview == null) ...[
              TextFormField(
                controller: _code,
                decoration: InputDecoration(labelText: l10n.inviteCodeLabel, prefixIcon: const Icon(Icons.key_outlined)),
                textCapitalization: TextCapitalization.characters,
                autocorrect: false,
                style: const TextStyle(letterSpacing: 2, fontWeight: FontWeight.w600),
                onFieldSubmitted: (_) => _lookup(),
              ),
              const SizedBox(height: 20),
              FilledButton(onPressed: _busy ? null : _lookup, child: Text(l10n.inviteCheck)),
              if (!loggedIn) ...[
                const SizedBox(height: 8),
                TextButton(
                  onPressed: _busy ? null : () => context.go('/login'),
                  child: Text(l10n.inviteHaveAccountSignIn),
                ),
              ],
            ] else ...[
              if (kIsWeb && !loggedIn) ...[
                OutlinedButton.icon(
                  onPressed: _busy ? null : _openInApp,
                  icon: const Icon(Icons.phone_iphone),
                  label: Text(l10n.inviteOpenInApp),
                ),
                const SizedBox(height: 12),
              ],
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: scheme.primaryContainer.withValues(alpha: 0.5),
                  borderRadius: BorderRadius.circular(AppTokens.radiusL),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.photo_album_outlined, color: scheme.primary),
                        const SizedBox(width: 10),
                        Expanded(child: Text(preview.familyName, style: text.titleLarge)),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      preview.isValid
                          ? l10n.inviteValidUntil(DateFormat.yMd(context.localeTag).format(preview.expiresAt.toLocal()))
                          : l10n.inviteExpired,
                      style: text.bodyMedium?.copyWith(color: preview.isValid ? scheme.onSurfaceVariant : scheme.error),
                    ),
                    const SizedBox(height: 10),
                    Text(l10n.inviteYouMay, style: text.labelMedium?.copyWith(color: scheme.onSurfaceVariant)),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        Chip(avatar: const Icon(Icons.visibility_outlined, size: 16), label: Text(l10n.rightsView)),
                        if (preview.flags.canUpload) Chip(avatar: const Icon(Icons.upload_outlined, size: 16), label: Text(l10n.rightsUpload)),
                        if (preview.flags.canDownload) Chip(avatar: const Icon(Icons.download_outlined, size: 16), label: Text(l10n.rightsDownload)),
                        if (preview.flags.canComment) Chip(avatar: const Icon(Icons.chat_bubble_outline, size: 16), label: Text(l10n.rightsComment)),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              if (!loggedIn) ...[
                Text(l10n.inviteNewAccountTitle, style: text.titleMedium),
                const SizedBox(height: 4),
                Text(
                  l10n.inviteNewAccountHint,
                  style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _name,
                  decoration: InputDecoration(labelText: l10n.inviteNameLabel, prefixIcon: const Icon(Icons.person_outline)),
                  textInputAction: TextInputAction.next,
                  validator: (v) => (v == null || v.trim().isEmpty) ? l10n.authNameRequired : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _email,
                  decoration: InputDecoration(labelText: l10n.authEmailLabel, prefixIcon: const Icon(Icons.mail_outline)),
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  validator: (v) => (v == null || !v.contains('@')) ? l10n.authEmailRequired : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _password,
                  decoration: InputDecoration(labelText: l10n.inviteChoosePasswordLabel, prefixIcon: const Icon(Icons.lock_outline)),
                  obscureText: true,
                  onFieldSubmitted: (_) => _accept(),
                  validator: (v) => (v == null || v.length < 8) ? l10n.authPasswordMin8 : null,
                ),
                const SizedBox(height: 20),
              ],
              FilledButton(
                onPressed: _busy || !preview.isValid ? null : _accept,
                child: Text(loggedIn ? l10n.inviteJoinAlbum : l10n.inviteCreateAndJoin),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: _busy ? null : () => setState(() => _preview = null),
                child: Text(l10n.inviteOtherCode),
              ),
              if (!loggedIn)
                TextButton(
                  onPressed: _busy ? null : () => context.go('/login'),
                  child: Text(l10n.inviteHaveAccountSignInFirst),
                ),
            ],
            if (_error != null) ...[const SizedBox(height: 12), ErrorBanner(_error!)],
          ],
        ),
      ),
    );
  }
}
