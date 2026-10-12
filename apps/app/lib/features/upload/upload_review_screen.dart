import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:mime/mime.dart';

import '../../l10n/l10n.dart';
import '../../theme/app_theme.dart';

/// Upload-Assistent: gewählte Dateien mit Vorschaubild und optionaler Beschreibung pro Datei, dazu «Gleiche
/// Beschreibung für alle». Liefert die Beschreibungen (Index → Text) oder null bei «Abbrechen».
class UploadReviewScreen extends StatefulWidget {
  const UploadReviewScreen({super.key, required this.files, required this.bytes});
  final List<PlatformFile> files;
  /// Dateiinhalt je Index (Web: sofort nach der Auswahl gelesen; sonst für Vorschaubilder geladen)
  final List<Future<Uint8List>?> bytes;

  @override
  State<UploadReviewScreen> createState() => _UploadReviewScreenState();
}

class _UploadReviewScreenState extends State<UploadReviewScreen> {
  late final _controllers = [for (final _ in widget.files) TextEditingController()];
  final _all = TextEditingController();

  @override
  void dispose() {
    for (final c in _controllers) {
      c.dispose();
    }
    _all.dispose();
    super.dispose();
  }

  void _applyAll() {
    final text = _all.text.trim();
    if (text.isEmpty) return;
    setState(() {
      for (final c in _controllers) {
        // Bereits Getipptes nicht überschreiben
        if (c.text.trim().isEmpty) c.text = text;
      }
    });
  }

  Map<int, String> _captions() => {
    for (var i = 0; i < _controllers.length; i++)
      if (_controllers[i].text.trim().isNotEmpty) i: _controllers[i].text.trim(),
  };

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.uploadReviewTitle),
        leading: IconButton(icon: const Icon(Icons.close), tooltip: l10n.commonCancel, onPressed: () => Navigator.pop(context)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          Text(l10n.uploadReviewHint, style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
          if (widget.files.length > 1) ...[
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextField(
                    key: const ValueKey('upload-caption-all'),
                    controller: _all,
                    textCapitalization: TextCapitalization.sentences,
                    maxLength: 2000,
                    decoration: InputDecoration(labelText: l10n.uploadCaptionAll, counterText: ''),
                    onSubmitted: (_) => _applyAll(),
                  ),
                ),
                const SizedBox(width: 8),
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: OutlinedButton(
                    // Das Theme macht umrandete Knöpfe volle Breite – in der Zeile eine eigene Mindestgrösse
                    style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
                    onPressed: _applyAll,
                    child: Text(l10n.uploadCaptionApply),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 8),
          for (var i = 0; i < widget.files.length; i++)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Thumb(file: widget.files[i], bytes: widget.bytes[i]),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(widget.files[i].name, maxLines: 1, overflow: TextOverflow.ellipsis, style: text.labelSmall?.copyWith(color: scheme.onSurfaceVariant)),
                        TextField(
                          key: ValueKey('upload-caption-$i'),
                          controller: _controllers[i],
                          textCapitalization: TextCapitalization.sentences,
                          minLines: 1,
                          maxLines: 3,
                          maxLength: 2000,
                          decoration: InputDecoration(hintText: l10n.uploadCaptionLabel, counterText: ''),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: FilledButton.icon(
            key: const ValueKey('upload-start'),
            onPressed: () => Navigator.pop(context, _captions()),
            icon: const Icon(Icons.cloud_upload_outlined),
            label: Text(l10n.uploadStart(widget.files.length)),
          ),
        ),
      ),
    );
  }
}

class _Thumb extends StatelessWidget {
  const _Thumb({required this.file, required this.bytes});
  final PlatformFile file;
  final Future<Uint8List>? bytes;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isVideo = (lookupMimeType(file.name) ?? '').startsWith('video/');
    Widget icon(IconData i) => ColoredBox(color: scheme.surfaceContainerHigh, child: Icon(i, color: scheme.onSurfaceVariant));
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppTokens.radiusS),
      child: SizedBox(
        width: 72,
        height: 72,
        child: isVideo || bytes == null
            ? icon(isVideo ? Icons.videocam_outlined : Icons.image_outlined)
            : FutureBuilder<Uint8List>(
                future: bytes,
                builder: (context, snap) => snap.hasData
                    ? Image.memory(snap.data!, fit: BoxFit.cover, cacheWidth: 200, gaplessPlayback: true, errorBuilder: (_, _, _) => icon(Icons.image_outlined))
                    : icon(Icons.image_outlined),
              ),
      ),
    );
  }
}
