#!/bin/sh
# Trägt die öffentliche Domain für Universal Links (iOS) und App Links (Android) ein, damit
# https://<domain>/invite?code=… direkt die App öffnet. Ohne diesen Schritt öffnet der Link die
# Web-App, die «In der App öffnen» über das Schema familienalbum:// anbietet.
#
#   tool/set_domain.sh album.beispiel.ch
#
# Voraussetzungen auf dem Server (liefert der Web-Container aus web/.well-known/):
#   https://<domain>/.well-known/apple-app-site-association   (Team K4GN98FN45, Bundle ch.familienalbum.familienalbum)
#   https://<domain>/.well-known/assetlinks.json              (Upload-Schlüssel; für Play-Builds zusätzlich den
#                                                              Fingerabdruck aus Play Console → App-Integrität eintragen)
set -eu
domain="${1:?Domain angeben, z.B. album.beispiel.ch}"
cd "$(dirname "$0")/.."

ent=ios/Runner/Runner.entitlements
if ! grep -q "applinks:$domain" "$ent"; then
  /usr/libexec/PlistBuddy -c "Add :com.apple.developer.associated-domains array" "$ent" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :com.apple.developer.associated-domains: string applinks:$domain" "$ent"
  echo "iOS: applinks:$domain in $ent"
fi

# Android: pro Domain ein eigener Filter; der Marker bleibt stehen, damit weitere Domains ergänzt werden können
man=android/app/src/main/AndroidManifest.xml
if ! grep -q "android:host=\"$domain\"" "$man"; then
  filter="            <intent-filter android:autoVerify=\"true\">\\
                <action android:name=\"android.intent.action.VIEW\"/>\\
                <category android:name=\"android.intent.category.DEFAULT\"/>\\
                <category android:name=\"android.intent.category.BROWSABLE\"/>\\
                <data android:scheme=\"https\" android:host=\"$domain\" android:pathPrefix=\"/invite\"/>\\
            </intent-filter>\\
            <!-- APP-LINKS: weitere Domains mit tool/set_domain.sh ergänzen -->"
  sed -i '' "s|            <!-- APP-LINKS: .*-->|$filter|" "$man"
  echo "Android: https://$domain/invite in $man"
fi
echo "Fertig. Jetzt neu bauen: tool/build.sh ipa && tool/build.sh appbundle"
