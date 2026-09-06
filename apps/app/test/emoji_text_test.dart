import 'package:familienalbum/widgets/emoji_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('erkennt Symbole mit Emoji-Kennung (FE0F), nicht aber blanke Textzeichen oder echte Emoji', () {
    expect(needsEmojiFont('Schatz♥️♥️'), isTrue);
    expect(needsEmojiFont('✔️ erledigt'), isTrue);
    expect(needsEmojiFont('Schatz♥'), isFalse);
    expect(needsEmojiFont('schono \u{1F602}'), isFalse);
    expect(needsEmojiFont('Nur Text, äöü.'), isFalse);
  });

  testWidgets('setzt nur die Emoji-Sequenzen in die Emoji-Schrift', (
    tester,
  ) async {
    const style = TextStyle(fontSize: 14);
    final span = emojiTextSpan('Mi Hübsch Schatz♥️ ok', style: style);
    final parts = span.children!.cast<TextSpan>();
    expect(parts.map((p) => p.text), ['Mi Hübsch Schatz', '♥️', ' ok']);
    expect(
      parts[1].style?.fontFamily,
      anyOf('Apple Color Emoji', 'Noto Color Emoji'),
    );
    expect(parts[0].style?.fontFamily, isNull);
    expect(span.toPlainText(), 'Mi Hübsch Schatz♥️ ok');
  });

  testWidgets('ohne betroffene Zeichen bleibt ein einfacher Span', (
    tester,
  ) async {
    final span = emojiTextSpan('schono \u{1F602}');
    expect(span.children, isNull);
    expect(span.text, 'schono \u{1F602}');
  });
}
