import 'package:familienalbum/widgets/emoji_text.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('ergänzt FE0F bei Text-Herzen und anderen Text-Emoji', () {
    expect(withEmojiPresentation('Schatz♥♥'), 'Schatz♥️♥️');
    expect(withEmojiPresentation('a ❤ b'), 'a ❤️ b');
    expect(withEmojiPresentation('☀ ☕ ⚠'), '☀️ ☕️ ⚠️');
  });

  test('lässt bereits korrekte Emoji, Tastenkappen und Hauttöne in Ruhe', () {
    expect(withEmojiPresentation('❤️'), '❤️');
    expect(withEmojiPresentation('❤︎'), '❤︎');
    expect(withEmojiPresentation('✌\u{1F3FD}'), '✌\u{1F3FD}');
    expect(withEmojiPresentation('schono \u{1F602}'), 'schono \u{1F602}');
    expect(withEmojiPresentation(''), '');
    expect(withEmojiPresentation('Nur Text, äöü.'), 'Nur Text, äöü.');
  });
}
