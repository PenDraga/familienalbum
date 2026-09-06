# Familienalbum – Projekt-Brief

Privates, selbst gehostetes Familienalbum (analog FamilyAlbum/Mitene). Fotos und Videos
werden von Familienmitgliedern hochgeladen, chronologisch nach Aufnahmedatum angezeigt,
kommentiert und optional heruntergeladen. Läuft als Docker-Compose zu Hause, ist aber von
aussen erreichbar (iOS, Android, Windows, Web).

## Stack (fix, nicht diskutieren)

| Teil | Wahl |
|---|---|
| Backend | Node 22, TypeScript, Fastify, Prisma, Zod, BullMQ |
| Datenbank | PostgreSQL 16 |
| Cache/Queue | Redis 7 |
| Medien-Storage | Bind-Mount `/data/media` (Filesystem, kein S3) |
| Bildverarbeitung | `sharp` (Thumbnails, EXIF), `fluent-ffmpeg` + `ffmpeg` Binary (Video) |
| Auth | Eigenbau: E-Mail + Argon2-Passwort, Access-Token (JWT, 15 min) + Refresh-Token (DB, 30 d) |
| Clients | Flutter (iOS, Android, Windows, Web) – ein Codebase |
| Reverse Proxy | Caddy (serviert Web-Build + proxied `/api`) |
| Externer Zugriff | Cloudflare Tunnel (`cloudflared`), kein Port-Forwarding |
| Push | Firebase Cloud Messaging (iOS/Android); Windows/Web pollen |

## Repo-Struktur (Monorepo)

```
/apps/api          Fastify-Backend
/apps/app          Flutter-App (alle Plattformen)
/infra             docker-compose.yml, Caddyfile, .env.example
/docs              ADRs, API-Beschreibung (OpenAPI aus Fastify generiert)
```

## Datenmodell (Prisma)

```prisma
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  displayName  String
  isAdmin      Boolean  @default(false)   // globaler Admin
  isDisabled   Boolean  @default(false)
  createdAt    DateTime @default(now())
  memberships  FamilyMember[]
  refreshTokens RefreshToken[]
}

model Family {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
  members   FamilyMember[]
  media     Media[]
  invites   Invite[]
}

model FamilyMember {
  userId        String
  familyId      String
  isFamilyAdmin Boolean @default(false)
  canUpload     Boolean @default(false)
  canDownload   Boolean @default(false)
  canComment    Boolean @default(true)
  lastSeenAt    DateTime?
  user   User   @relation(fields: [userId], references: [id])
  family Family @relation(fields: [familyId], references: [id])
  @@id([userId, familyId])
}

model Invite {
  id            String   @id @default(uuid())
  familyId      String
  code          String   @unique
  createdById   String
  expiresAt     DateTime
  maxUses       Int      @default(1)
  uses          Int      @default(0)
  // Flags, die das neue Mitglied bekommt
  canUpload     Boolean
  canDownload   Boolean
  canComment    Boolean
  family Family @relation(fields: [familyId], references: [id])
}

model Media {
  id           String    @id @default(uuid())
  familyId     String
  uploaderId   String
  type         MediaType            // PHOTO | VIDEO
  status       MediaStatus          // UPLOADING | PROCESSING | READY | FAILED
  sha256       String
  originalName String
  mimeType     String
  sizeBytes    Int
  width        Int?
  height       Int?
  durationSec  Float?
  takenAt      DateTime             // aus EXIF, Fallback Upload-Zeit
  uploadedAt   DateTime  @default(now())
  caption      String?
  deletedAt    DateTime?            // Soft-Delete
  family   Family    @relation(fields: [familyId], references: [id])
  comments Comment[]
  @@unique([familyId, sha256])       // Dedup pro Familie
  @@index([familyId, takenAt])
}

model Comment {
  id        String   @id @default(uuid())
  mediaId   String
  authorId  String
  body      String
  createdAt DateTime @default(now())
  media Media @relation(fields: [mediaId], references: [id])
}

model RefreshToken { ... }
model UploadSession { ... }   // für Chunk-Uploads, siehe unten
model Device { ... }          // FCM-Token pro Gerät
```

Dateien liegen unter `/data/media/<familyId>/<mediaId>/{original.ext, thumb_400.webp, thumb_1600.webp, preview.mp4}`.

## Rechtematrix (serverseitig in jeder Route prüfen – die App blendet nur Buttons aus)

| Aktion | Bedingung |
|---|---|
| Familie sehen, Timeline, Thumbnails | Mitglied der Familie |
| Original / Export-Zip laden | `canDownload` |
| Hochladen | `canUpload` |
| Eigenes Medium löschen / Caption ändern | Uploader oder `isFamilyAdmin` |
| Kommentieren | `canComment` |
| Kommentar bearbeiten / löschen | Autor, `isFamilyAdmin` oder `isAdmin` (als Mitglied; ADR-0003) |
| Mitglieder-Flags ändern, Einladungen erzeugen, Mitglied entfernen | `isFamilyAdmin` |
| User anlegen/sperren, Familien anlegen/löschen, Storage-Statistik | `isAdmin` (global) |

Ein Fastify-Hook `requireFamilyPermission('canUpload')` lädt die Membership einmal pro Request
und legt sie auf `request.membership`. Globale Admins umgehen Familienrechte **nicht**
automatisch – sie müssen sich selbst als Mitglied hinzufügen.

## API (REST, Präfix `/api/v1`)

```
POST   /auth/login | /auth/refresh | /auth/logout
GET    /me
PUT    /me/avatar | DELETE /me/avatar   Profilbild (Rohdaten JPEG/PNG/WebP → 512×512 WebP)
GET    /users/:id/avatar                 signierter Link (in UserBrief.avatarUrl) oder Bearer
GET    /families                         eigene Familien
POST   /families                         (isAdmin)
GET    /families/:id/members
PATCH  /families/:id/members/:userId     Flags (isFamilyAdmin)
POST   /families/:id/invites             (isFamilyAdmin)
POST   /invites/:code/accept
GET    /families/:id/timeline?cursor=&month=   gruppiert nach Monat, cursor-paginiert
GET    /media/:id
GET    /media/:id/thumb/:size            400 | 1600
GET    /media/:id/original               (canDownload)
GET    /families/:id/recaps | POST /families/:id/recaps {kind, period}   Rückblick-Videos (canUpload); DELETE /recaps/:id (isFamilyAdmin)
GET    /recaps/:id/video | /poster        signiert oder Mitglied
GET    /families/:id/on-this-day         «An diesem Tag» (gleicher Kalendertag vor 1–12 Monaten, 1–10 Jahren)
GET    /families/:id/export-link/:scope  signierter Link (canDownload); scope = alle | JJJJ-MM
GET    /families/:id/export/:scope       ZIP-Stream: Originale JJJJ/MM/, index.json, kommentare.md
PATCH  /media/:id                        caption
DELETE /media/:id
POST   /families/:id/uploads             UploadSession anlegen (sha256, size, name) → 409 wenn Hash existiert
PUT    /uploads/:id/chunks/:index        Chunk ≤ 50 MB (Cloudflare-Limit 100 MB beachten)
POST   /uploads/:id/complete             → Media mit status PROCESSING, Job enqueuen
GET/POST /media/:id/comments
POST   /devices                          FCM-Token registrieren
GET    /admin/users | POST /admin/users | PATCH /admin/users/:id   (isAdmin)
GET    /admin/stats
```

Fastify generiert OpenAPI; daraus wird der Flutter-Client (`openapi-generator`, dart-dio) erzeugt.

## Upload-Flow

1. App berechnet SHA-256 lokal, schickt `POST /uploads`. Antwort 409 = Duplikat, fertig.
2. Chunks à 50 MB per PUT, wiederaufnehmbar (Server merkt sich empfangene Indizes).
3. `complete` → Chunks zusammenfügen, Hash prüfen, `Media` anlegen, BullMQ-Job `process-media`.
4. Worker: EXIF lesen (`takenAt`, Rotation), Thumbnails 400/1600 als WebP, bei Video zusätzlich
   `preview.mp4` (H.264, 1080p max) und Poster-Frame. Danach `status = READY`, Push an Familie.
5. Auto-Upload in der App: neue Galerie-Fotos im Hintergrund (iOS: `BGProcessingTask`,
   Android: `WorkManager`), nur im WLAN standardmässig.

## Docker-Compose (infra/)

Services: `api`, `worker` (gleiches Image, anderer Entrypoint), `postgres`, `redis`, `caddy`,
`cloudflared`. Volumes: `/data/media`, `/data/postgres`. `.env` für Secrets. Backup-Script:
`pg_dump` + rsync von `/data/media` täglich auf ein zweites Ziel.

## Milestones (in dieser Reihenfolge, jeder Schritt lauffähig)

1. **M1 Backend-Kern:** Auth, Familien, Mitglieder, Einladungen, Rechte-Hook, Tests für die Rechtematrix
2. **M2 Medien:** Chunk-Upload, Worker, Thumbnails, Timeline-API
3. **M3 Flutter Basis:** Login, Timeline-Grid nach Monat, Detailansicht, manueller Upload – zuerst Android + Web
4. **M4 Kommentare + Push**
5. **M5 Auto-Upload** im Hintergrund (iOS und Android getrennt testen)
6. **M6 iOS + Windows Builds**, TestFlight-Verteilung
7. **M7 Admin-Bereich** im Web (User, Familien, Storage)
8. **M8 Export-Zip** (erledigt: alle Fotos, Videos und Kommentare, gesamt oder pro Monat)
9. **M9 Rückblicke** (erledigt: Monats-/Jahres-Video und Sekunden-Film per ffmpeg im Worker, automatisch am 1. des Monats
   bzw. 2. Januar und per Knopf; «An diesem Tag»; Musik: Kevin MacLeod CC BY 4.0 mit Nachweis im Abspann)
10. Später: Besucher-Anzeige (`lastSeenAt`)

## Konventionen

- Jede Route: Zod-Schema für Body/Query/Response, Rechte-Hook, Integrationstest (Vitest + Testcontainers).
- Keine Business-Logik in Routen – Services unter `src/services/`.
- Migrations nur via `prisma migrate`, nie manuell.
- Fehler als RFC 7807 Problem-JSON.
- Deutsch in UI-Texten, Englisch im Code.
- Bevor grössere Entscheidungen abweichen: ADR unter `/docs/adr/` anlegen und Rücksprache.
