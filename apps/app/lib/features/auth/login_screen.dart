import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../../widgets/auth_shell.dart';
import 'auth_controller.dart';

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

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final serverHost = Uri.tryParse(_server.text)?.host ?? _server.text;

    return AuthShell(
      title: 'Familienalbum',
      subtitle: 'Eure Fotos und Videos – privat, zu Hause.',
      child: Form(
        key: _form,
        child: AutofillGroup(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _email,
                decoration: const InputDecoration(labelText: 'E-Mail', prefixIcon: Icon(Icons.mail_outline)),
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.username, AutofillHints.email],
                autocorrect: false,
                textInputAction: TextInputAction.next,
                validator: (v) => (v == null || !v.contains('@')) ? 'E-Mail-Adresse angeben' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _password,
                decoration: InputDecoration(
                  labelText: 'Passwort',
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
                validator: (v) => (v == null || v.isEmpty) ? 'Passwort angeben' : null,
              ),
              const SizedBox(height: 12),
              if (_editServer)
                TextFormField(
                  controller: _server,
                  decoration: const InputDecoration(
                    labelText: 'Server',
                    hintText: 'https://album.example.ch',
                    prefixIcon: Icon(Icons.dns_outlined),
                  ),
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  validator: (v) {
                    final u = Uri.tryParse((v ?? '').trim());
                    if (u == null || !u.hasScheme || u.host.isEmpty) return 'Bitte eine gültige URL angeben (https://…)';
                    return null;
                  },
                )
              else
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: () => setState(() => _editServer = true),
                    icon: const Icon(Icons.dns_outlined, size: 18),
                    label: Text('Server: $serverHost', style: TextStyle(color: scheme.onSurfaceVariant)),
                  ),
                ),
              if (_error != null) ...[const SizedBox(height: 12), ErrorBanner(_error!)],
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Anmelden'),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: _busy ? null : () => context.go('/invite'),
                child: const Text('Ich habe einen Einladungscode'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
