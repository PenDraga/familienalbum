# Familienalbum

[🇩🇪 Deutsch](./README.md) · 🇬🇧 English

![Familienalbum](docs/banner.png)

A private, self-hosted family photo album, inspired by FamilyAlbum/Mitene. Family members upload photos and videos,
browse them chronologically by capture date, comment on them and save originals when needed. It runs as a Docker
Compose stack at home and is reachable from outside through a reverse proxy (Traefik, Caddy) or a Cloudflare Tunnel.
Clients: iOS, Android and web from one Flutter code base. Project brief and conventions (German): [CLAUDE.md](./CLAUDE.md).

**Status: version 1.0.** The server runs in production, the iOS app ships via TestFlight/App Store, the Android app via
Google Play or APK, and the web app runs in any browser. Changes: [CHANGELOG.md](./CHANGELOG.md) (German).
License: [MIT](./LICENSE). The user interface is currently German only.

| Timeline | Photo | Comments | Recap | Settings |
|---|---|---|---|---|
| ![Timeline](docs/screenshots/01-timeline.png) | ![Photo](docs/screenshots/02-foto.png) | ![Comments](docs/screenshots/03-kommentare.png) | ![Recap](docs/screenshots/04-rueckblick.png) | ![Settings](docs/screenshots/05-einstellungen.png) |

*Sample photos from picsum.photos, demo family.*

## Features

- **Albums and permissions:** several albums (families) per server, membership by invitation only, per-member rights
  (upload, download originals, comment, album admin); global admins manage users and albums inside the app.
- **Timeline:** monthly mosaic, full-screen viewer with swipe and zoom, video scrubbing, multi-select to delete or
  adjust dates, light and dark mode.
- **Upload:** chunked and resumable, duplicate detection by SHA-256, HEIC/HEIF and iPhone videos converted on the
  server; automatic background upload of new captures (iOS, Android).
- **Capture metadata:** camera, lens, aperture, exposure, ISO, focal length, location with map; set or shift the
  capture date for one item or a selection.
- **Comments and activity:** comments per item, bell with unread counter, activity feed by day (who uploaded or
  commented when, with a jump to the photo); app icon badge mirrors the unread counter on iOS.
- **Originals:** save to the Photos library or share directly from the app, download in the browser.
- **Recaps:** monthly and yearly videos plus a one-second-per-day film, rendered on the server with ffmpeg (Ken Burns
  motion, cross-fades, title card, royalty-free music with attribution), automatically on the first of the month and on
  demand; "On this day" shows photos from the same calendar day in earlier months and years.
- **Export:** all photos, videos and comments as a ZIP, in total or per month, with `index.json` and the comments as a
  file. Your data stays yours, something commercial services tend to refuse.
- **Profile:** avatar per user, shown with comments, activity and members; comments are editable (author, album admin or
  global admin); "Last seen" shows who visited when; storage usage per album, free disk space for admins.
- **Timeline filters:** all · photos · videos · with comments.
- **Push** (Firebase Cloud Messaging): digest for new uploads, immediate for comments, notice when a recap is ready;
  without Firebase the clients poll.
- **Invitation links:** `https://<your-domain>/invite?code=…` opens the web app with server and code pre-filled, or the
  installed app directly (Universal Links / App Links).
- **Account deletion:** anonymises the account; photos and comments stay in the album as "Deleted account".
- **"Picture book" design:** warm vanilla, coral, lagoon and sun tones; Baloo 2 and Nunito bundled.

## Layout

```
apps/api    Fastify backend + media worker (Node 22, TypeScript, Prisma, Zod, BullMQ, sharp, ffmpeg)
apps/app    Flutter app (iOS, Android, web)
infra       docker-compose.yml, Caddyfile, .env.example, backup.sh
docs        API overview, ADRs, iOS build notes, generated OpenAPI spec (German)
```

| Part | Technology |
|---|---|
| Backend | Node 22, Fastify 5, Prisma 6, Zod 4, BullMQ 6, sharp, fluent-ffmpeg |
| Database / queue | PostgreSQL 16, Redis 7 |
| Media | file-system bind mount, WebP thumbnails (400/1600), H.264 MP4 video preview |
| Auth | e-mail + Argon2id, JWT access token (15 min) + rotating refresh token (30 days) |
| Clients | Flutter (Riverpod, go_router, Dio) |
| Delivery | Caddy serves the web app and proxies `/api`; Traefik/reverse proxy or Cloudflare Tunnel in front |

## Running it (Docker Compose)

GitHub Actions builds the images on every push to `main` and on every release tag (`.github/workflows/images.yml`)
and publishes them to the GitHub Container Registry:

- `ghcr.io/pendraga/familienalbum-api` – API and worker (Node, ffmpeg, libheif)
- `ghcr.io/pendraga/familienalbum-web` – Flutter web build served by Caddy

The server only pulls finished images. A stack manager such as Dockhand or Portainer needs nothing but
`infra/docker-compose.yml` and the variables from `infra/.env.example`.

### Setup

1. Registry login, only needed while the packages are private (GitHub classic token with `read:packages`):

```bash
docker login ghcr.io -u <github-user>
```

2. Set the variables in your stack manager or create a `.env`:

```bash
cd infra && cp .env.example .env
```

Required: `POSTGRES_PASSWORD`, `JWT_SECRET` (at least 32 characters, `openssl rand -base64 48`), `ADMIN_EMAIL`,
`ADMIN_PASSWORD`, the paths `MEDIA_PATH`, `POSTGRES_PATH`, `REDIS_PATH` and `HTTP_PORT` (default 8090). `IMAGE_TAG`
selects the version (`latest`, `v1.0.0`, `sha-<commit>`). `OPERATOR_NAME` and `OPERATOR_EMAIL` appear on the privacy
page `/datenschutz.html` as the responsible party.

3. Start. The API applies migrations on start-up and re-queues media stuck in processing:

```bash
docker compose up -d
```

4. Create the first admin (idempotent):

```bash
docker compose exec api node dist/seed.js
```

5. Sign in on the LAN at `http://<server>:<HTTP_PORT>`, create an album, send an invitation.

### Invitations

An album admin creates a code under Members → "Create invitation code" (7 days, single use) and shares it as a link
`https://<domain>/invite?code=…&server=…`. The link opens the web app with server and code pre-filled, checks the
invitation immediately and offers "Open in app" (URL scheme `familienalbum://`). To make the link open the installed app
directly (Universal Links / App Links), `tool/build.sh` takes the domain from `APP_LINK_DOMAIN` in `apps/app/firebase.env`:
iOS gets it in the release entitlements, Android in a manifest placeholder. The web container serves the required files
under `/.well-known/`; put your own Apple team ID and the Android signing fingerprints (upload key and Play key) there.

### External access

Put the Cloudflare Tunnel token into the variables and start the stack with the profile:

```bash
docker compose --profile tunnel up -d
```

Or run an existing HTTPS reverse proxy in front of Caddy; it must pass request bodies up to 50 MB (upload chunks).

### Update, backup, self-build

```bash
docker compose pull && docker compose up -d
```

Daily backup via cron with `infra/backup.sh` (`pg_dump` + `rsync` of the media). Build from the checkout without a registry:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### Push (Firebase Cloud Messaging)

Optional. Without it the clients poll once a minute.

1. Create a Firebase project, add an iOS app (bundle ID `ch.familienalbum.familienalbum`) and an Android app (same
   package name); for iOS upload the APNs key (.p8 from your Apple developer account) under Cloud Messaging.
2. **Server:** put the service-account JSON (Firebase → project settings → service accounts) into the secrets folder
   (`SECRETS_PATH`, default `./secrets` next to the compose file) and set `FIREBASE_SERVICE_ACCOUNT=/run/secrets/<file>.json`,
   then `docker compose up -d`. If the key is unusable the API still starts, without push, and logs the reason.
3. **App:** enter the values from the Firebase project settings in `apps/app/firebase.env` (template `firebase.env.example`)
   and build with `apps/app/tool/build.sh ipa|apk`; the script sets the `--dart-define`s. `APP_LINK_DOMAIN` in the same
   file is the domain for Universal/App Links; `API_BASE_URL` optionally pre-fills the server on the login screen, only
   sensible for builds of a single family, not for store builds.
4. **Recap music:** the image build downloads ten royalty-free tracks by Kevin MacLeod (incompetech.com, CC BY 4.0);
   attribution is shown in the end credits of every video. Your own MP3s in `MUSIC_PATH` (default `<media>/_music`) take precedence.
5. **Google Play:** upload the first bundle by hand (`apps/app/tool/build.sh appbundle`). Afterwards automate with a
   service account (Play Console → Setup → API access, role "Release manager"), key file at
   `apps/app/android/play-service-account.json` (not in git) and `node apps/app/tool/play_upload.mjs --track=internal|alpha|beta|production --notes="…"`.
   `node apps/app/tool/play_listing.mjs --screenshots` maintains the store listing.
6. **TestFlight without Xcode Organizer:** create an App Store Connect API key (role "App Manager"), store the `.p8` at
   `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8` and fill in `apps/app/ios/asc.env` (template `asc.env.example`).
   Then `apps/app/tool/build.sh ipa && node apps/app/tool/testflight_upload.mjs --notes="…"` uploads, waits for
   processing, sets the test notes and attaches the build to your TestFlight group.
7. **App Store listing by script:** `node apps/app/tool/asc_listing.mjs --screenshots` sets subtitle, category, privacy
   URL, description, keywords, support URL, review information and uploads the screenshots from
   `apps/app/store/ios/<DISPLAY_TYPE>/` (6.7" and 6.5"; the app targets iPhone only). Personal values live in `ios/asc.env`.
8. **Android APK:** create the release key once (`apps/app/android/key.properties.example`), then
   `apps/app/tool/build.sh apk`. The key must stay the same for all future versions, back it up.

## Development (backend)

Requirements: Node 22, Docker (PostgreSQL, tests), `ffmpeg`/`ffprobe` on the PATH.

```bash
npm install
```

```bash
docker run -d --name familienalbum-pg -p 5432:5432 -e POSTGRES_USER=familienalbum -e POSTGRES_PASSWORD=familienalbum -e POSTGRES_DB=familienalbum postgres:16-alpine
```

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
npm run prisma:migrate -w apps/api && npm run seed -w apps/api && npm run dev
```

Swagger UI: <http://localhost:3000/api/docs> · Health: <http://localhost:3000/api/v1/health>

Process media inside the API process with `MEDIA_PROCESSING=inline` (no Redis needed). Closer to production: start Redis
(`docker run -d --name familienalbum-redis -p 6379:6379 redis:7-alpine`) and `npm run dev:worker -w apps/api`.

| Script (in `apps/api`) | Purpose |
|---|---|
| `npm test` | Vitest + Testcontainers (PostgreSQL 16), around 210 integration tests; `npm run test:unit` without Docker |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run openapi` | writes `docs/openapi.json` |
| `npm run prisma:migrate` | create and apply a migration from schema changes |
| `npm run seed` | create the first admin (`ADMIN_*` from `.env`) |

API description: [docs/api.md](docs/api.md). Decisions: [docs/adr](docs/adr) (German).

## Development (Flutter app)

Requirements: Flutter SDK (stable, currently 3.47); for iOS a Mac with Xcode ([docs/ios-build.md](docs/ios-build.md), German).

```bash
cd apps/app && flutter pub get
```

Web against the local backend (the server URL is also editable on the login screen):

```bash
cd apps/app && flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:3000
```

Test from a phone on the same Wi-Fi (insert the LAN IP; a release build is noticeably smoother):

```bash
cd apps/app && flutter build web --release --pwa-strategy=none --dart-define=API_BASE_URL=http://<lan-ip>:3000 && node tool/serve_web.mjs 8090
```

`--pwa-strategy=none` stops Safari from serving stale builds from the service-worker cache. Without `API_BASE_URL` the
web app uses its own origin (that is how it runs behind Caddy). iOS build against your home server:

```bash
cd apps/app && flutter run --release -d <iphone> --dart-define=API_BASE_URL=https://<your-domain>
```

Branding: the source is `apps/app/assets/branding/logo.svg`; regenerate icons and splash with
`node tool/render_branding.mjs && dart run flutter_launcher_icons && dart run flutter_native_splash:create`.

### Auto-upload

Enable it in the app settings under "Automatischer Upload". New captures (from the moment you enable it; the start date
can be moved back) are uploaded to the chosen album, on Wi-Fi only by default. It requires the upload permission in
that album and switches itself off if the permission is revoked.

- Foreground: on start, on return to the foreground (at most every 5 minutes) and via "Jetzt".
- Background: Android WorkManager (periodic), iOS BGTaskScheduler (`ch.familienalbum.autoupload`). At most 25 files per run.
- HEIC is converted to JPEG on the device; the server detects duplicates by SHA-256.
