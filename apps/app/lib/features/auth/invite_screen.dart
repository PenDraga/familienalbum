import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
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
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication, webOnlyWindowName: '_self');
    if (!ok && mounted) setState(() => _error = 'Die App scheint nicht installiert zu sein. Du kannst die Einladung auch hier im Browser annehmen.');
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
    await ref.read(settingsProvider.notifier).setBaseUrl(_server.text);
    final repo = AuthRepository(ref.read(apiClientProvider));
    final p = await repo.previewInvite(_code.text);
    setState(() => _preview = p);
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
    final loggedIn = ref.watch(meProvider) != null;
    final preview = _preview;

    return AuthShell(
      title: 'Einladung',
      subtitle: preview == null
          ? 'Gib den Code ein, den du bekommen hast.'
          : loggedIn
          ? 'Du wurdest eingeladen. Tritt dem Album bei.'
          : 'Du wurdest eingeladen. Lege dein eigenes Konto an, um beizutreten.',
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
                decoration: const InputDecoration(labelText: 'Server', prefixIcon: Icon(Icons.dns_outlined)),
                keyboardType: TextInputType.url,
              ),
              const SizedBox(height: 12),
            ],
            if (preview == null) ...[
              TextFormField(
                controller: _code,
                decoration: const InputDecoration(labelText: 'Einladungscode', prefixIcon: Icon(Icons.key_outlined)),
                textCapitalization: TextCapitalization.characters,
                autocorrect: false,
                style: const TextStyle(letterSpacing: 2, fontWeight: FontWeight.w600),
                onFieldSubmitted: (_) => _lookup(),
              ),
              const SizedBox(height: 20),
              FilledButton(onPressed: _busy ? null : _lookup, child: const Text('Einladung prüfen')),
            ] else ...[
              if (kIsWeb && !loggedIn) ...[
                OutlinedButton.icon(
                  onPressed: _busy ? null : _openInApp,
                  icon: const Icon(Icons.phone_iphone),
                  label: const Text('In der App öffnen'),
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
                          ? 'Gültig bis ${DateFormat.yMd('de_CH').format(preview.expiresAt.toLocal())}'
                          : 'Diese Einladung ist nicht mehr gültig.',
                      style: text.bodyMedium?.copyWith(color: preview.isValid ? scheme.onSurfaceVariant : scheme.error),
                    ),
                    const SizedBox(height: 10),
                    Text('Du darfst:', style: text.labelMedium?.copyWith(color: scheme.onSurfaceVariant)),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        const Chip(avatar: Icon(Icons.visibility_outlined, size: 16), label: Text('Ansehen')),
                        if (preview.flags.canUpload) const Chip(avatar: Icon(Icons.upload_outlined, size: 16), label: Text('Hochladen')),
                        if (preview.flags.canDownload) const Chip(avatar: Icon(Icons.download_outlined, size: 16), label: Text('Herunterladen')),
                        if (preview.flags.canComment) const Chip(avatar: Icon(Icons.chat_bubble_outline, size: 16), label: Text('Kommentieren')),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              if (!loggedIn) ...[
                Text('Neues Konto anlegen', style: text.titleMedium),
                const SizedBox(height: 4),
                Text(
                  'Zum Beitreten brauchst du ein eigenes Konto. Mit dieser E-Mail und diesem Passwort '
                  'meldest du dich künftig in der App an.',
                  style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _name,
                  decoration: const InputDecoration(labelText: 'Dein Name (wird den anderen angezeigt)', prefixIcon: Icon(Icons.person_outline)),
                  textInputAction: TextInputAction.next,
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Bitte Namen angeben' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _email,
                  decoration: const InputDecoration(labelText: 'E-Mail', prefixIcon: Icon(Icons.mail_outline)),
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  validator: (v) => (v == null || !v.contains('@')) ? 'E-Mail-Adresse angeben' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _password,
                  decoration: const InputDecoration(labelText: 'Passwort wählen (min. 8 Zeichen)', prefixIcon: Icon(Icons.lock_outline)),
                  obscureText: true,
                  onFieldSubmitted: (_) => _accept(),
                  validator: (v) => (v == null || v.length < 8) ? 'Mindestens 8 Zeichen' : null,
                ),
                const SizedBox(height: 20),
              ],
              FilledButton(
                onPressed: _busy || !preview.isValid ? null : _accept,
                child: Text(loggedIn ? 'Album beitreten' : 'Konto anlegen und beitreten'),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: _busy ? null : () => setState(() => _preview = null),
                child: const Text('Anderen Code eingeben'),
              ),
              if (!loggedIn)
                TextButton(
                  onPressed: _busy ? null : () => context.go('/login'),
                  child: const Text('Ich habe schon ein Konto – zuerst anmelden'),
                ),
            ],
            if (_error != null) ...[const SizedBox(height: 12), ErrorBanner(_error!)],
          ],
        ),
      ),
    );
  }
}
