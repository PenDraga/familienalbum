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
# Vorbelegte Server-Adresse (Login-Screen zeigt sie an, bleibt änderbar) – für Store-Builds und Prüfer
if [ -n "${API_BASE_URL:-}" ]; then
  defines="$defines --dart-define=API_BASE_URL=$API_BASE_URL"
  echo "Server vorbelegt: $API_BASE_URL"
fi

# shellcheck disable=SC2086
exec flutter build "$target" --release $defines "$@"
