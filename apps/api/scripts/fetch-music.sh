#!/bin/sh
# Lädt die lizenzfreien Stücke aus assets/music/TRACKS.txt (Kevin MacLeod, CC BY 4.0) nach assets/music/.
# Läuft beim Image-Build; Fehler sind nicht fatal – dann gibt es Rückblicke ohne Musik.
set -u
cd "$(dirname "$0")/../assets/music" || exit 1
grep -v '^#' TRACKS.txt | grep '|' | while IFS='|' read -r title url; do
  file="$(printf '%s' "$title" | tr ' ' '_').mp3"
  if [ -s "$file" ]; then continue; fi
  if curl -fsSL --retry 3 -o "$file" "$url"; then echo "music: $title"; else echo "music: $title fehlgeschlagen" >&2; rm -f "$file"; fi
done
exit 0
