#!/bin/sh
# Baut die App mit Firebase-Werten aus firebase.env (falls vorhanden).
#   tool/build.sh ipa            → TestFlight-Archiv (build/ios/ipa/*.ipa)
#   tool/build.sh ios            → signierter Geräte-Build (build/ios/iphoneos/Runner.app)
#   tool/build.sh apk            → Android-APK zum direkten Verteilen
#   tool/build.sh appbundle      → Android App Bundle (Play Store)
# Weitere Argumente werden an flutter build durchgereicht, z.B. --build-number=11.
set -e
cd "$(dirname "$0")/.."
target="${1:?Ziel angeben: ipa | ios | apk | appbundle}"
shift

defines=""
if [ -f firebase.env ]; then
  # shellcheck disable=SC1091
  . ./firebase.env
  case "$target" in
    ipa|ios) key="$FIREBASE_IOS_API_KEY"; app="$FIREBASE_IOS_APP_ID" ;;
    apk|appbundle) key="$FIREBASE_ANDROID_API_KEY"; app="$FIREBASE_ANDROID_APP_ID" ;;
  esac
  if [ -n "$key" ] && [ -n "$app" ] && [ -n "$FIREBASE_PROJECT_ID" ] && [ -n "$FIREBASE_SENDER_ID" ]; then
    defines="--dart-define=FIREBASE_API_KEY=$key --dart-define=FIREBASE_APP_ID=$app \
      --dart-define=FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID --dart-define=FIREBASE_SENDER_ID=$FIREBASE_SENDER_ID"
    echo "Firebase-Push aktiv (Projekt $FIREBASE_PROJECT_ID)"
  else
    echo "firebase.env unvollständig für $target – baue ohne Push"
  fi
else
  echo "keine firebase.env – baue ohne Push (Clients pollen)"
fi
# APP_LINK_DOMAIN: Domain für Universal Links (iOS, Release-Entitlements) und App Links (Android, Manifest-Platzhalter).
# API_BASE_URL: optional, belegt die Server-Adresse im Login vor – nur für Builds einer einzelnen Familie, nicht für den Store.
if [ -n "${API_BASE_URL:-}" ]; then
  defines="$defines --dart-define=API_BASE_URL=$API_BASE_URL"
  echo "Server vorbelegt: $API_BASE_URL"
fi
domain="${APP_LINK_DOMAIN:-$(printf '%s' "${API_BASE_URL:-}" | sed -E 's#^[a-z]+://##; s#[:/].*$##')}"
[ -n "$domain" ] && defines="$defines --dart-define=APP_LINK_DOMAIN=$domain"
ent=ios/Runner/Runner.release.entitlements
{
  printf '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n'
  printf '\t<key>aps-environment</key>\n\t<string>production</string>\n'
  if [ -n "$domain" ]; then
    printf '\t<key>com.apple.developer.associated-domains</key>\n\t<array>\n\t\t<string>applinks:%s</string>\n\t</array>\n' "$domain"
  fi
  printf '</dict>\n</plist>\n'
} > "$ent"
[ -n "$domain" ] && echo "Universal/App Links für $domain"


# shellcheck disable=SC2086
# IPA: Archiv + Export. Der Export braucht das Verteilungs-Zertifikat aus Apples Cloud; ohne Apple-Konto in Xcode
# scheitert er («No Accounts»). Mit ASC_SIGNING_KEY_ID (Admin-Schlüssel in ios/asc.env) exportieren wir dann selbst
# über die App-Store-Connect-API – unabhängig vom Xcode-Konto.
if [ "$target" = "ipa" ]; then
  rm -rf build/ios/ipa
  flutter build ipa --release $defines --export-options-plist=ios/ExportOptions.plist "$@" || true
  if ! ls build/ios/ipa/*.ipa >/dev/null 2>&1; then
    key_id=""; issuer=""
    if [ -f ios/asc.env ]; then
      key_id="$(grep '^ASC_SIGNING_KEY_ID=' ios/asc.env | cut -d= -f2 | tr -d ' \r')"
      issuer="$(grep '^ASC_ISSUER_ID=' ios/asc.env | cut -d= -f2 | tr -d ' \r')"
    fi
    if [ -z "$key_id" ] || [ ! -d build/ios/archive/Runner.xcarchive ]; then
      echo "IPA-Export fehlgeschlagen. Entweder in Xcode anmelden (Settings → Accounts) oder ASC_SIGNING_KEY_ID in ios/asc.env setzen." >&2
      exit 1
    fi
    echo "Export über App-Store-Connect-API (Schlüssel $key_id) …"
    xcodebuild -exportArchive -archivePath build/ios/archive/Runner.xcarchive -exportPath build/ios/ipa \
      -exportOptionsPlist ios/ExportOptions.plist -allowProvisioningUpdates \
      -authenticationKeyPath "$HOME/.appstoreconnect/private_keys/AuthKey_$key_id.p8" \
      -authenticationKeyID "$key_id" -authenticationKeyIssuerID "$issuer" | grep -E "error|EXPORT" || true
    ls build/ios/ipa/*.ipa >/dev/null 2>&1 || exit 1
  fi
  exit 0
fi
exec flutter build "$target" --release $defines "$@"
