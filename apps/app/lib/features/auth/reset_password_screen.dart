import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../../l10n/l10n.dart';
import '../../widgets/auth_shell.dart';
import 'auth_repository.dart';

/// Neues Passwort setzen – geöffnet über den Link aus der Reset-Mail (`/reset?token=…`).
class ResetPasswordScreen extends ConsumerStatefulWidget {
  const ResetPasswordScreen({super.key, required this.token});
  final String? token;

  @override
  ConsumerState<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _password = TextEditingController();
  final _repeat = TextEditingController();
  bool _busy = false;
  bool _show = false;
  bool _done = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    _repeat.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final token = widget.token;
    if (token == null || !_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AuthRepository(ref.read(apiClientProvider)).confirmPasswordReset(token, _password.text);
      if (mounted) setState(() => _done = true);
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final token = widget.token;

    Widget body;
    if (token == null || token.length < 20) {
      body = Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ErrorBanner(l10n.resetLinkInvalid),
          const SizedBox(height: 16),
          FilledButton(onPressed: () => context.go('/login'), child: Text(l10n.resetBackToLogin)),
        ],
      );
    } else if (_done) {
      body = Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.check_circle_outline, color: Theme.of(context).colorScheme.primary),
              const SizedBox(width: 10),
              Expanded(child: Text(l10n.resetDone, style: Theme.of(context).textTheme.bodyLarge)),
            ],
          ),
          const SizedBox(height: 20),
          FilledButton(onPressed: () => context.go('/login'), child: Text(l10n.resetBackToLogin)),
        ],
      );
    } else {
      body = Form(
        key: _form,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextFormField(
              controller: _password,
              decoration: InputDecoration(
                labelText: l10n.profileNewPasswordLabel,
                prefixIcon: const Icon(Icons.lock_reset),
                suffixIcon: IconButton(
                  icon: Icon(_show ? Icons.visibility_off_outlined : Icons.visibility_outlined),
                  onPressed: () => setState(() => _show = !_show),
                ),
              ),
              obscureText: !_show,
              autofillHints: const [AutofillHints.newPassword],
              textInputAction: TextInputAction.next,
              validator: (v) => (v == null || v.length < 8) ? l10n.authPasswordMin8 : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _repeat,
              decoration: InputDecoration(labelText: l10n.profileRepeatPassword, prefixIcon: const Icon(Icons.lock_reset)),
              obscureText: !_show,
              textInputAction: TextInputAction.done,
              onFieldSubmitted: (_) => _submit(),
              validator: (v) => v != _password.text ? l10n.profilePasswordMismatch : null,
            ),
            if (_error != null) ...[const SizedBox(height: 12), ErrorBanner(_error!)],
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(l10n.resetSubmit),
            ),
            const SizedBox(height: 8),
            TextButton(onPressed: _busy ? null : () => context.go('/login'), child: Text(l10n.resetBackToLogin)),
          ],
        ),
      );
    }

    return AuthShell(title: l10n.resetTitle, subtitle: l10n.resetSubtitle, child: body);
  }
}
