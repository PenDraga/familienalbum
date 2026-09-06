import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Symbole, die in Unicode standardmässig Text sind, aber mit Variation Selector 16 (U+FE0F) als Emoji
/// gelten (♥️ ♠️ ✔️ ✈️ ⚠️ …). Flutter wählt für sie auf iOS die Systemschrift, sobald die das Zeichen
/// kennt, und ignoriert die Kennung – das Ergebnis ist eine schwarze Glyphe statt des farbigen Emoji.
/// Abhilfe: solche Sequenzen ausdrücklich mit der Emoji-Schrift des Systems setzen.
final RegExp _vs16Emoji = RegExp(
  '[‼⁉™ℹ↔-↙↩↪⌚⌛⌨⏏⏩-⏳⏸-⏺'
  'Ⓜ▪▫▶◀◻-◾☀-➿⤴⤵⬅-⬇⬛⬜⭐⭕'
  '〰〽㊗㊙]️',
  unicode: true,
);

/// Name der Emoji-Schrift des Systems; null, wo Flutter sie selbst korrekt findet (Web, Windows).
String? get _emojiFontFamily {
  if (kIsWeb) return null;
  return switch (defaultTargetPlatform) {
    TargetPlatform.iOS || TargetPlatform.macOS => 'Apple Color Emoji',
    TargetPlatform.android => 'Noto Color Emoji',
    _ => null,
  };
}

/// Zerlegt [text] in Spans; Emoji-Sequenzen mit FE0F bekommen die Emoji-Schrift, der Rest [style].
TextSpan emojiTextSpan(String text, {TextStyle? style}) {
  final family = _emojiFontFamily;
  if (family == null || text.isEmpty || !_vs16Emoji.hasMatch(text)) {
    return TextSpan(text: text, style: style);
  }
  final emojiStyle = (style ?? const TextStyle()).copyWith(fontFamily: family);
  final children = <InlineSpan>[];
  var last = 0;
  for (final m in _vs16Emoji.allMatches(text)) {
    if (m.start > last) {
      children.add(TextSpan(text: text.substring(last, m.start)));
    }
    children.add(TextSpan(text: m[0], style: emojiStyle));
    last = m.end;
  }
  if (last < text.length) {
    children.add(TextSpan(text: text.substring(last)));
  }
  return TextSpan(style: style, children: children);
}

/// Text-Widget, das VS16-Emoji farbig darstellt.
class EmojiText extends StatelessWidget {
  const EmojiText(
    this.text, {
    super.key,
    this.style,
    this.maxLines,
    this.overflow,
    this.textAlign,
  });
  final String text;
  final TextStyle? style;
  final int? maxLines;
  final TextOverflow? overflow;
  final TextAlign? textAlign;

  @override
  Widget build(BuildContext context) {
    final effective = DefaultTextStyle.of(context).style.merge(style);
    return Text.rich(
      emojiTextSpan(text, style: effective),
      maxLines: maxLines,
      overflow: overflow,
      textAlign: textAlign,
    );
  }
}

/// Controller für Eingabefelder, der dieselbe Darstellung beim Tippen anwendet.
class EmojiTextEditingController extends TextEditingController {
  EmojiTextEditingController({super.text});

  @override
  TextSpan buildTextSpan({
    required BuildContext context,
    TextStyle? style,
    required bool withComposing,
  }) {
    // Während der Tastatur-Komposition (z.B. Diakritika) die Standarddarstellung lassen
    if (withComposing && value.isComposingRangeValid) {
      return super.buildTextSpan(
        context: context,
        style: style,
        withComposing: withComposing,
      );
    }
    return emojiTextSpan(text, style: style);
  }
}

/// Nur für Tests: hat der Text Sequenzen, die die Emoji-Schrift brauchen?
@visibleForTesting
bool needsEmojiFont(String text) => _vs16Emoji.hasMatch(text);
