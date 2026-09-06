/// Zeichen, die in Unicode standardmässig als Text dargestellt werden, aber ein Emoji-Gegenstück haben
/// (❤ ☀ ☺ ✌ ♥ ☕ ⚠ …). Ohne Variation Selector 16 (U+FE0F) zeichnet Flutter sie als schwarze Glyphe,
/// mit FE0F als farbiges Emoji. Tastaturen und andere Clients schicken sie nicht einheitlich.
final RegExp _textPresentationEmoji = RegExp(
  '([‼⁉™ℹ↔-↙↩↪⌚⌛⌨⏏⏩-⏳⏸-⏺'
  'Ⓜ▪▫▶◀◻-◾☀-➿⤴⤵⬅-⬇⬛⬜⭐⭕'
  '〰〽㊗㊙])(?![︎️⃣\u{1F3FB}-\u{1F3FF}])',
  unicode: true,
);

/// Ergänzt fehlende Emoji-Kennungen (FE0F), damit ♥ und ❤ wie ❤️ erscheinen. Nur für die Anzeige gedacht,
/// die gespeicherten Daten bleiben unverändert.
String withEmojiPresentation(String text) {
  if (text.isEmpty) return text;
  return text.replaceAllMapped(_textPresentationEmoji, (m) => '${m[1]}️');
}
