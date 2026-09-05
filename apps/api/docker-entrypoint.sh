#!/bin/sh
# Startet als root, übergibt den Medien-Ordner dem Laufzeit-Benutzer "node" und wechselt dann zu ihm.
# Der Bind-Mount /data/media gehört auf dem Host meist root oder nobody (Unraid: 99:100) – ohne diesen
# Schritt scheitern Uploads mit EACCES. Rekursiv nur beim ersten Mal (fremder Besitzer der obersten Ebene).
set -e

MEDIA_DIR="${MEDIA_ROOT:-/data/media}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$MEDIA_DIR"
  NODE_UID="$(id -u node)"
  if [ "$(stat -c %u "$MEDIA_DIR")" != "$NODE_UID" ]; then
    echo "entrypoint: übergebe $MEDIA_DIR an node (uid $NODE_UID)"
    chown -R node:node "$MEDIA_DIR"
  fi
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
