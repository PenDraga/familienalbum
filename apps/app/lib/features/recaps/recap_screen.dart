import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';

import '../../core/api_exception.dart';
import '../../core/providers.dart';
import '../../l10n/l10n.dart';
import '../auth/auth_controller.dart';
import '../media/original/original_saver.dart';
import 'recap_models.dart';
import 'recaps_repository.dart';

/// Rückblick abspielen, teilen/sichern, löschen (Familien-Admin).
class RecapScreen extends ConsumerStatefulWidget {
  const RecapScreen({super.key, required this.recapId});
  final String recapId;

  @override
  ConsumerState<RecapScreen> createState() => _RecapScreenState();
}

class _RecapScreenState extends ConsumerState<RecapScreen> {
  VideoPlayerController? _controller;
  String? _loadedUrl;
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  void _ensurePlayer(RecapItem recap) {
    final url = recap.videoUrl;
    if (url == null || url == _loadedUrl) return;
    _loadedUrl = url;
    final c = VideoPlayerController.networkUrl(Uri.parse(url));
    _controller?.dispose();
    _controller = c;
    c
        .initialize()
        .then((_) {
          if (!mounted) return;
          setState(() {});
          c.play();
        })
        .catchError((Object e) {
          if (mounted) setState(() => _error = context.l10n.mediaVideoLoadError('$e'));
        });
  }

  Future<void> _share(RecapItem recap) async {
    final url = recap.videoUrl;
    if (url == null) return;
    if (kIsWeb) {
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      return;
    }
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final prepared = await prepareOriginal(
        ref.read(apiClientProvider).dio,
        url: url,
        fileName: 'Familienalbum ${recap.title}.mp4',
        mimeType: 'video/mp4',
        isVideo: true,
        onProgress: (_) {},
      );
      try {
        await prepared.share();
      } finally {
        await prepared.dispose();
      }
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete(RecapItem recap) async {
    final l10n = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.recapDeleteTitle(recap.title)),
        content: Text(l10n.recapDeleteText),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l10n.commonCancel)),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l10n.commonDelete)),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await ref.read(recapsRepositoryProvider).delete(recap.id);
      ref.invalidate(recapsProvider);
      if (mounted) context.pop();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final l10n = context.l10n;
    final recaps = ref.watch(recapsProvider);
    final recap = recaps.value?.where((r) => r.id == widget.recapId).firstOrNull;
    final family = ref.watch(selectedFamilyProvider);
    if (recap != null && recap.isReady) _ensurePlayer(recap);
    final c = _controller;

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(recap?.title ?? l10n.recapTitle, style: text.titleLarge?.copyWith(color: Colors.white)),
        actions: [
          if (recap != null && recap.isReady)
            IconButton(
              tooltip: kIsWeb ? l10n.recapDownload : l10n.recapShareOrSave,
              onPressed: _busy ? null : () => _share(recap),
              icon: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Icon(kIsWeb ? Icons.download_outlined : Icons.ios_share),
            ),
          if (recap != null && (family?.membership.isFamilyAdmin ?? false))
            IconButton(tooltip: l10n.commonDelete, onPressed: () => _delete(recap), icon: const Icon(Icons.delete_outline)),
        ],
      ),
      body: recap == null
          ? Center(child: recaps.isLoading ? const CircularProgressIndicator() : Text(l10n.recapNotFound, style: const TextStyle(color: Colors.white)))
          : !recap.isReady
          ? _Status(recap: recap)
          : _error != null
          ? Center(child: Text(_error!, style: const TextStyle(color: Colors.white70)))
          : c == null || !c.value.isInitialized
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Expanded(
                  child: Center(
                    child: AspectRatio(
                      aspectRatio: c.value.aspectRatio,
                      child: GestureDetector(
                        onTap: () => setState(() => c.value.isPlaying ? c.pause() : c.play()),
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            VideoPlayer(c),
                            if (!c.value.isPlaying) Icon(Icons.play_circle_fill, size: 84, color: Colors.white.withValues(alpha: 0.9)),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                VideoProgressIndicator(c, allowScrubbing: true, colors: VideoProgressColors(playedColor: scheme.primary, bufferedColor: Colors.white24, backgroundColor: Colors.white12), padding: const EdgeInsets.fromLTRB(16, 8, 16, 12)),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
                  child: Text(
                    [
                      l10n.recapMoments(recap.mediaCount),
                      if (recap.durationSec != null) '${Duration(seconds: recap.durationSec!.round()).inMinutes}:${(recap.durationSec!.round() % 60).toString().padLeft(2, '0')} min',
                      if (recap.musicTrack != null) l10n.recapMusic(recap.musicTrack!),
                    ].join(' · '),
                    textAlign: TextAlign.center,
                    style: text.bodySmall?.copyWith(color: Colors.white54),
                  ),
                ),
              ],
            ),
    );
  }
}

class _Status extends StatelessWidget {
  const _Status({required this.recap});
  final RecapItem recap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (recap.isFailed) const Icon(Icons.error_outline, color: Colors.white70, size: 48) else const CircularProgressIndicator(),
            const SizedBox(height: 16),
            Text(recap.isFailed ? context.l10n.recapFailedText : context.l10n.recapCreatingText, style: text.titleMedium?.copyWith(color: Colors.white)),
            const SizedBox(height: 6),
            Text(
              recap.isFailed ? (recap.error ?? '') : context.l10n.recapCreatingHint,
              textAlign: TextAlign.center,
              style: text.bodyMedium?.copyWith(color: Colors.white60),
            ),
          ],
        ),
      ),
    );
  }
}
