import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../../l10n/l10n.dart';
import '../../widgets/auth_shell.dart';
import 'auth_controller.dart';
import 'auth_repository.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _server = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _editServer = false;
  bool _busy = false;
  bool _showPassword = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Provider nur hier lesen – nie in late-Feldern, die erst in dispose() initialisiert würden
    _server.text = ref.read(settingsProvider).baseUrl;
    _editServer = _server.text.isEmpty;
  }

  @override
  void dispose() {
    _server.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(settingsProvider.notifier).setBaseUrl(_server.text);
      await ref.read(authControllerProvider.notifier).login(_email.text.trim(), _password.text);
      // Router leitet über redirect auf "/" weiter.
    } catch (e) {
      setState(() => _error = errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Passwort vergessen: E-Mail abfragen, Server schickt den Link. Antwort ist bewusst immer gleich.
  Future<void> _forgotPassword() async {
    final l10n = context.l10n;
    final controller = TextEditingController(text: _email.text.trim());
    final email = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.resetRequestTitle),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(l10n.resetRequestBody),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              autofocus: true,
              keyboardType: TextInputType.emailAddress,
              autocorrect: false,
              decoration: InputDecoration(labelText: l10n.authEmailLabel, prefixIcon: const Icon(Icons.mail_outline)),
              onSubmitted: (v) => Navigator.pop(ctx, v),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(l10n.commonCancel)),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text),
            style: FilledButton.styleFrom(minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: 18)),
            child: Text(l10n.resetRequestSend),
          ),
        ],
      ),
    );
    controller.dispose();
    final trimmed = email?.trim() ?? '';
    if (trimmed.isEmpty || !trimmed.contains('@') || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_form.currentState != null && _server.text.trim().isNotEmpty) await ref.read(settingsProvider.notifier).setBaseUrl(_server.text);
      await AuthRepository(ref.read(apiClientProvider)).requestPasswordReset(trimmed);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.resetRequestSent), duration: const Duration(seconds: 8)));
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final l10n = context.l10n;
    final serverHost = Uri.tryParse(_server.text)?.host ?? _server.text;
    // Startprüfung am Server gescheitert (z.B. umgezogen): Grund zeigen, Server-Feld ist unten änderbar.
    // Nur echte API-/Netzwerkfehler – interne Ausnahmen gehören nicht auf den Login-Screen.
    final startupError = ref.watch(authControllerProvider).error;
    final startupProblem = startupError is ApiException ? startupError : null;

    return AuthShell(
      title: l10n.appTitle,
      subtitle: l10n.loginSubtitle,
      child: Form(
        key: _form,
        child: AutofillGroup(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _email,
                decoration: InputDecoration(labelText: l10n.authEmailLabel, prefixIcon: const Icon(Icons.mail_outline)),
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.username, AutofillHints.email],
                autocorrect: false,
                textInputAction: TextInputAction.next,
                validator: (v) => (v == null || !v.contains('@')) ? l10n.authEmailRequired : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _password,
                decoration: InputDecoration(
                  labelText: l10n.authPasswordLabel,
                  prefixIcon: const Icon(Icons.lock_outline),
                  suffixIcon: IconButton(
                    icon: Icon(_showPassword ? Icons.visibility_off_outlined : Icons.visibility_outlined),
                    onPressed: () => setState(() => _showPassword = !_showPassword),
                  ),
                ),
                obscureText: !_showPassword,
                autofillHints: const [AutofillHints.password],
                textInputAction: TextInputAction.done,
                onFieldSubmitted: (_) => _submit(),
                validator: (v) => (v == null || v.isEmpty) ? l10n.authPasswordRequired : null,
              ),
              const SizedBox(height: 12),
              if (_editServer)
                TextFormField(
                  controller: _server,
                  decoration: InputDecoration(
                    labelText: l10n.authServerLabel,
                    hintText: 'https://album.example.ch',
                    prefixIcon: const Icon(Icons.dns_outlined),
                  ),
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  validator: (v) {
                    final u = Uri.tryParse((v ?? '').trim());
                    if (u == null || !u.hasScheme || u.host.isEmpty) return l10n.authServerUrlInvalid;
                    return null;
                  },
                )
              else
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: () => setState(() => _editServer = true),
                    icon: const Icon(Icons.dns_outlined, size: 18),
                    label: Text(l10n.loginServerShown(serverHost), style: TextStyle(color: scheme.onSurfaceVariant)),
                  ),
                ),
              if (_error != null)
                ...[const SizedBox(height: 12), ErrorBanner(_error!)]
              else if (startupProblem != null)
                ...[const SizedBox(height: 12), ErrorBanner(l10n.loginStartupProblem(startupProblem.detail, serverHost))],
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(l10n.loginSubmit),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: _busy ? null : () => context.go('/invite'),
                child: Text(l10n.loginHaveInviteCode),
              ),
              TextButton(
                onPressed: _busy ? null : _forgotPassword,
                child: Text(l10n.loginForgotPassword, style: TextStyle(color: scheme.onSurfaceVariant)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
