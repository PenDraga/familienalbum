# Familienalbum

Privates, selbst gehostetes Familienalbum. Projekt-Brief und Konventionen: [CLAUDE.md](./CLAUDE.md).

```
apps/api    Fastify-Backend + Medien-Worker (Node 22, TypeScript, Prisma, Zod, BullMQ, sharp, ffmpeg)
apps/app    Flutter-App (Android, iOS, Web, Windows – ein Codebase)
infra       docker-compose.yml, Caddyfile, .env.example, backup.sh
docs        API-Übersicht, ADRs, generierte OpenAPI-Spezifikation
```

## Entwicklung (Backend)

Voraussetzungen: Node 22, Docker (für PostgreSQL und die Tests), `ffmpeg`/`ffprobe` im PATH (Videos).

```bash
npm install
```

PostgreSQL lokal starten (z.B. nur den DB-Service aus dem Compose-File):

```bash
docker run -d --name familienalbum-pg -p 5432:5432 -e POSTGRES_USER=familienalbum -e POSTGRES_PASSWORD=familienalbum -e POSTGRES_DB=familienalbum postgres:16-alpine
```

```bash
cp apps/api/.env.example apps/api/.env
```

Dann Migrationen einspielen, ersten Admin anlegen und starten:

```bash
npm run prisma:migrate -w apps/api
```

```bash
npm run prisma:seed -w apps/api
```

```bash
npm run dev
```

Swagger-UI: <http://localhost:3000/api/docs> · Health: <http://localhost:3000/api/v1/health>

Medienverarbeitung lokal: mit `MEDIA_PROCESSING=inline` in der `.env` läuft sie im API-Prozess (kein Redis nötig).
Für den produktionsnahen Weg Redis starten und den Worker separat laufen lassen:

```bash
docker run -d --name familienalbum-redis -p 6379:6379 redis:7-alpine
```

```bash
npm run dev:worker -w apps/api
```

### Tests

```bash
npm test
```

Die Integrationstests (Vitest) starten per Testcontainers einen PostgreSQL-16-Container, spielen die
Migrationen ein und leeren vor jedem Test alle Tabellen. Ohne Docker kann alternativ
`TEST_DATABASE_URL` auf eine leere Datenbank zeigen (sie wird geleert!).

### Weitere Skripte (in `apps/api`)

| Skript | Zweck |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | kompiliert nach `dist/` |
| `npm run openapi` | schreibt `docs/openapi.json` (Basis für den Flutter-Client) |
| `npm run prisma:migrate` | neue Migration aus Schema-Änderungen erzeugen und anwenden |
| `npm run prisma:deploy` | Migrationen anwenden (Produktion, läuft auch im Container-Start) |

## Entwicklung (Flutter-App)

Voraussetzungen: Flutter SDK (stable) im PATH; für Android zusätzlich Android SDK, für Web Chrome.

```bash
cd apps/app && flutter pub get
```

Web gegen das lokale Backend (Server-URL ist im Login-Screen auch editierbar):

```bash
cd apps/app && flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:3000
```

Android-Emulator erreicht den Host unter `http://10.0.2.2:3000`. Release-Web-Build für Caddy:

```bash
cd apps/app && flutter build web --release
```

Ohne `API_BASE_URL` nimmt die Web-App den eigenen Origin (Caddy serviert App und `/api` zusammen).

### Vom Handy im WLAN testen

Der Dev-Server muss auf allen Interfaces lauschen und die App muss die LAN-Adresse des Rechners kennen
(hier `192.168.0.135`, mit `ipconfig` prüfen). Backend läuft bereits auf `0.0.0.0:3000`.

```bash
cd apps/app && flutter run -d web-server --web-hostname 0.0.0.0 --web-port 8090 --dart-define=API_BASE_URL=http://192.168.0.135:3000
```

Schneller auf dem Handy ist der Release-Build, statisch ausgeliefert:

```bash
cd apps/app && flutter build web --release --dart-define=API_BASE_URL=http://192.168.0.135:3000 && node tool/serve_web.mjs 8090
```

Dann auf dem Handy `http://192.168.0.135:8090` öffnen. Windows fragt beim ersten Start evtl. nach der Firewall-Freigabe
für `dart.exe` und `node.exe` (privates Netzwerk erlauben). Über HTTP ohne HTTPS fällt die Token-Ablage im Browser auf
localStorage zurück – für den Test okay, im Betrieb läuft alles über HTTPS.

Branding: Logo-Quelle ist `apps/app/assets/branding/logo.svg`. Nach Änderungen die PNGs rendern und Icons/Splash neu erzeugen:

```bash
cd apps/app && node tool/render_branding.mjs && dart run flutter_launcher_icons && dart run flutter_native_splash:create
```

## Betrieb (Docker Compose)

```bash
cd infra && cp .env.example .env
```

`.env` ausfüllen (Passwörter, `JWT_SECRET`, Cloudflare-Tunnel-Token, Pfade), dann:

```bash
docker compose up -d --build
```

Ersten Admin anlegen:

```bash
docker compose exec api npx prisma db seed
```

Backup (täglich per Cron): `infra/backup.sh` – `pg_dump` + `rsync` von `/data/media`.

### Auto-Upload (M5)

In den App-Einstellungen unter „Automatischer Upload“ einschalten. Danach werden neue Aufnahmen (ab dem Einschaltzeitpunkt,
Datum rückwirkend wählbar) in die gewählte Familie hochgeladen – standardmässig nur im WLAN.

- **Vordergrund:** beim App-Start, bei Rückkehr in den Vordergrund (max. alle 5 Minuten) und über „Jetzt“.
- **Hintergrund:** Android WorkManager (periodisch, ~30 Minuten, nur bei WLAN/Akku ok), iOS BGTaskScheduler
  (`ch.familienalbum.autoupload`, iOS entscheidet den Zeitpunkt). Pro Lauf höchstens 25 Dateien.
- HEIC/HEIF wird auf dem Gerät zu JPEG gewandelt (iOS liefert die kompatible Variante, Android per `flutter_image_compress`).
- Dedup: Assets werden lokal als erledigt gemerkt; der Server erkennt Duplikate zusätzlich per SHA-256.
- Berechtigungen: Android `READ_MEDIA_IMAGES/VIDEO`, iOS `NSPhotoLibraryUsageDescription` – beides eingetragen.

### Push (Firebase Cloud Messaging)

Push ist optional. Ohne Konfiguration pollen die Clients jede Minute (`GET /families/:id/activity`).

1. Firebase-Projekt anlegen, Android-App (`ch.familienalbum.familienalbum`) und später iOS-App hinzufügen.
2. **Server:** In der Firebase-Konsole unter *Projekteinstellungen → Dienstkonten* einen privaten Schlüssel
   erzeugen, als `infra/secrets/firebase-service-account.json` ablegen und in `infra/.env`
   `FIREBASE_SERVICE_ACCOUNT=/run/secrets/firebase-service-account.json` setzen.
3. **App:** Die Werte aus *Projekteinstellungen → Allgemein → Deine Apps* beim Bauen als `--dart-define` mitgeben:

```bash
cd apps/app && flutter build apk --dart-define=FIREBASE_API_KEY=… --dart-define=FIREBASE_APP_ID=… --dart-define=FIREBASE_PROJECT_ID=… --dart-define=FIREBASE_SENDER_ID=…
```

Fehlen die Defines, startet die App ohne Firebase (kein `google-services.json` nötig).

## Milestones

- [x] **M1** Backend-Kern: Auth, Familien, Mitglieder, Einladungen, Rechte-Hook, Rechtematrix-Tests
- [x] **M2** Medien: Chunk-Upload, Worker, Thumbnails, Video-Preview, Timeline-API, signierte Medien-URLs
- [x] **M3** Flutter Basis: Login, Einladung einlösen, Timeline-Grid nach Monat, Detailansicht (Foto/Video), manueller Upload – Web gebaut, Android-Build braucht Android SDK
- [x] **M3b** Design: immersive Timeline (Hero-Kopf, bündiges Mosaik, Glas-Leisten, Hero-Übergang, Wischen zum Schliessen), warmes Farbschema hell/dunkel wählbar, Logo, App-Icons, Splash
- [x] **M4** Kommentare (API, Sheet in der App) + Push (FCM-Digest für Uploads, sofort bei Kommentaren) + Aktivitäts-Polling für Web/Windows
- [x] **M5** Auto-Upload: neue Galerie-Aufnahmen im Hintergrund (Android WorkManager, iOS BGTaskScheduler) und beim Öffnen der App, nur-WLAN-Option, HEIC→JPEG auf dem Gerät – Code fertig, Gerätetest offen (kein Android SDK/iOS-Build)
- [ ] **M6** iOS + Windows Builds
- [ ] **M7** Admin-Bereich im Web
