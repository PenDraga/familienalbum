# Flutter-Web-Build + Caddy in einem Image. Build-Kontext ist das Repo-Root (siehe infra/docker-compose.yml).
# Ohne API_BASE_URL nimmt die Web-App den eigenen Origin – Caddy liefert App und /api zusammen.
#
# Flutter wird in der exakt gepinnten Version aus Git installiert (fertige Images hinken den
# Releases hinterher). Der erste Build dauert einige Minuten, danach greift der Docker-Cache.
FROM debian:bookworm-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl unzip xz-utils zip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ARG FLUTTER_VERSION=3.47.2
RUN git clone --depth 1 --branch ${FLUTTER_VERSION} https://github.com/flutter/flutter.git /opt/flutter
ENV PATH=/opt/flutter/bin:$PATH
RUN git config --global --add safe.directory /opt/flutter \
 && flutter config --no-analytics --enable-web \
 && flutter precache --web

WORKDIR /app
# Abhängigkeiten zuerst (Cache), dann der Rest
COPY apps/app/pubspec.yaml apps/app/pubspec.lock ./
RUN flutter pub get

COPY apps/app/ ./
# Kein Service Worker: neue Versionen kommen sofort an
RUN flutter build web --release --pwa-strategy=none

FROM caddy:2-alpine
COPY --from=build /app/build/web /srv/web
COPY infra/Caddyfile /etc/caddy/Caddyfile
