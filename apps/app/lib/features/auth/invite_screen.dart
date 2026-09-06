import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/auth_shell.dart';
import 'auth_controller.dart';
import 'auth_models.dart';
import 'auth_repository.dart';

/// Einladung einlösen: Code → Vorschau → (angemeldet: beitreten | neu: registrieren).
class InviteScreen extends ConsumerStatefulWidget {
  const InviteScreen({super.key, this.initialCode});
  final String? initialCode;

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
    _server.text = ref.read(settingsProvider).baseUrl;
    _code.text = widget.initialCode ?? '';
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
          ? 'Du wurdest eingeladen. Tritt der Familie bei.'
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
                        Icon(Icons.family_restroom, color: scheme.primary),
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
                  decoration: const InputDecoration(labelText: 'Dein Name (wird der Familie angezeigt)', prefixIcon: Icon(Icons.person_outline)),
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
                child: Text(loggedIn ? 'Familie beitreten' : 'Konto anlegen und beitreten'),
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
