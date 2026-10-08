# Familienalbum API – Übersicht (Stand M4)

Basis-URL: `/api/v1`. Die vollständige, generierte Spezifikation liegt in [`openapi.json`](./openapi.json)
(`npm run openapi -w apps/api`) und ist im Dev-Betrieb unter `/api/docs` als Swagger-UI erreichbar.

## Fehlerformat

Alle Fehler sind RFC 7807 Problem-JSON (`Content-Type: application/problem+json`):

```json
{
  "type": "https://familienalbum.local/problems/permission-canupload",
  "title": "Forbidden",
  "status": 403,
  "detail": "Du darfst in dieser Familie nichts hochladen.",
  "code": "PERMISSION_CANUPLOAD",
  "instance": "/api/v1/families/…/uploads"
}
```

`detail` ist ein deutscher, anzeigbarer Text. `code` ist stabil und für die App gedacht. Validierungsfehler
(`VALIDATION_ERROR`) enthalten zusätzlich `errors: [{ path, message }]`.

## Authentifizierung

- `POST /auth/login` `{ email, password }` → `{ user, tokens }`
- Access-Token: JWT (HS256), 15 Minuten, als `Authorization: Bearer …`
- Refresh-Token: zufälliger String, 30 Tage, nur als SHA-256-Hash in der DB
- `POST /auth/refresh` `{ refreshToken }` → neues Paar. **Rotation:** das alte Token wird ungültig.
  Wird ein bereits rotiertes Token nochmals benutzt, werden alle Sitzungen des Benutzers beendet
  (`REFRESH_REUSED`).
- `POST /auth/logout` `{ refreshToken }` oder mit Access-Token `{ all: true }`
- Gesperrte Benutzer (`isDisabled`) werden bei jedem Request geprüft, nicht nur beim Login.

Es gibt **keine offene Registrierung**. Konten entstehen durch einen globalen Admin
(`POST /admin/users`) oder über eine Einladung (siehe unten).

## Familien & Mitglieder

| Route | Recht |
|---|---|
| `GET /families` | angemeldet (nur eigene) |
| `POST /families` `{ name, initialAdminUserId? }` | globaler Admin |
| `GET /families/:id` | Mitglied |
| `PATCH /families/:id` `{ name }` | Familien-Admin |
| `DELETE /families/:id` | globaler Admin |
| `GET /families/:id/members` | Mitglied |
| `GET /families/:id/storage` → Originale nach Typ (Bytes, Anzahl); `disk` (gesamt/frei unter `MEDIA_ROOT`) nur für Familien-/globale Admins, sonst `null` | Mitglied |
| `PATCH /families/:id/members/:userId` `{ isFamilyAdmin?, canUpload?, canDownload?, canComment? }` | Familien-Admin |
| `DELETE /families/:id/members/:userId` | Familien-Admin, oder man selbst (Austritt) |

Eine Familie behält immer mindestens einen Familien-Admin (`LAST_FAMILY_ADMIN`, 409).

**Globale Admins umgehen Familienrechte nicht.** Ein Admin, der eine Familie sehen will, fügt sich
über `POST /admin/families/:id/members` selbst hinzu oder gibt sich beim Anlegen als
`initialAdminUserId` an.

## Einladungen

| Route | Recht |
|---|---|
| `POST /families/:id/invites` `{ expiresInHours=168, maxUses=1, canUpload, canDownload, canComment }` | Familien-Admin |
| `GET /families/:id/invites` (nur aktive) | Familien-Admin |
| `DELETE /families/:id/invites/:inviteId` | Familien-Admin |
| `GET /invites/:code` (Vorschau: Familienname, Gültigkeit, Rechte) | öffentlich |
| `POST /invites/:code/accept` | siehe unten |

Annehmen funktioniert auf zwei Wegen (ADR-0001):

1. **Angemeldet** (Bearer-Token, leerer Body): der Benutzer wird Mitglied mit den Flags der Einladung.
2. **Neu** (kein Token, Body `{ email, password, displayName }`): Konto wird angelegt, Mitgliedschaft
   erzeugt, Tokens zurückgegeben. Alles in einer Transaktion – bei aufgebrauchter Einladung entsteht
   kein Konto.

Codes: 10 Zeichen aus `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (keine 0/O, 1/I/L), Gross-/Kleinschreibung egal.
Abgelaufen/aufgebraucht → 410 (`INVITE_EXPIRED` / `INVITE_USED_UP`), bereits Mitglied → 409.

## Admin (globaler Admin)

- `GET /admin/users?q=&limit=&offset=` · `POST /admin/users` · `PATCH /admin/users/:id` · `DELETE /admin/users/:id`
  (anonymisiert: E-Mail, Name, Passwort, Profilbild, Geräte, Sitzungen, Mitgliedschaften, eigene Einladungen weg;
  Fotos und Kommentare bleiben als «Gelöschtes Konto»; 409 `SELF_DELETE`, 409 `LAST_ADMIN`)
  (`displayName`, `isAdmin`, `isDisabled`, `password`; Sperre/Passwortwechsel beendet alle Sitzungen;
  kein Selbst-Entzug/Selbst-Sperre)
- `POST /admin/families/:id/members` `{ userId, flags… }`
- Sprache: `Accept-Language: en…` liefert englische `detail`-Texte (Katalog `src/lib/messages.en.ts`, Schlüssel = `code`);
  sonst Deutsch. `POST /devices` nimmt `locale` (de, en) für Push-Texte entgegen.
- `GET /meta` → `{ name, version, operator: { name, email } }` (öffentlich; Betreiber aus `OPERATOR_NAME`/`OPERATOR_EMAIL`)
- `GET /admin/stats` → Benutzer, Familien, Medien, Speicher

## Rechte-Hook

`requireFamilyPermission('canUpload')` (in `src/plugins/permissions.ts`) lädt die Membership einmal
pro Request, legt sie auf `request.membership` und wirft 401/403/404 als Problem-JSON. Die Family-ID
kommt standardmässig aus `params.id`; für Routen wie `/media/:id` kann ein eigener Resolver
übergeben werden. `lastSeenAt` wird dabei höchstens alle 5 Minuten aktualisiert.
Die komplette Rechtematrix ist in `test/permissions.test.ts` als Tabelle abgesichert.

## Medien (M2)

### Upload-Flow

```
POST /families/:id/uploads   { sha256, sizeBytes, originalName, mimeType, takenAt? }   (canUpload)
  → 201 UploadSession { id, chunkSize, totalChunks, receivedChunks[] }
  → 409 DUPLICATE_MEDIA { mediaId }       Datei existiert in dieser Familie schon
  → 415 UNSUPPORTED_MEDIA_TYPE            unbekannter Typ (HEIC/HEIF wird akzeptiert und im Worker gewandelt)
PUT  /uploads/:id/chunks/:index          application/octet-stream, genau chunkSize Bytes (letzter kleiner)
  → 200 UploadSession (receivedChunks aktualisiert; Reihenfolge egal, wiederholbar)
POST /uploads/:id/complete               → 201 Media (status PROCESSING), Job `process-media` eingereiht
GET  /uploads/:id                        Session für Wiederaufnahme · DELETE /uploads/:id  Abbruch
```

- Chunk-Grösse: `UPLOAD_CHUNK_SIZE` (Standard 50 MB, Cloudflare-Limit 100 MB). Maximale Dateigrösse
  `MAX_UPLOAD_BYTES` (Standard 2 GB, Prisma `Int`).
- Sessions leben 24 h; dieselbe Datei desselben Uploaders liefert die offene Session zurück (Resume).
- `complete` prüft den SHA-256 beim Zusammenfügen; bei Abweichung 400 `HASH_MISMATCH` und die Session
  wird verworfen.
- Ein soft-gelöschtes Duplikat wird beim Neu-Upload endgültig entfernt, damit der Upload durchgeht.

### Verarbeitung (Worker)

`apps/api/src/worker.ts` (BullMQ, Queue `process-media`, Redis) ruft `MediaProcessor.process(mediaId)`:

- **Foto:** EXIF (`DateTimeOriginal` → `takenAt`, Orientierung), Masse, `thumb_400.webp`, `thumb_1600.webp`
  (sharp, `fit: inside`, ohne Vergrösserung). HEIC/HEIF wird vorher nach JPEG gewandelt: zuerst `heif-convert`
  (libheif, im Docker-Image installiert, behält EXIF), sonst `ffmpeg` ≥ 7.1. Das Original bleibt HEIC.
- **Video:** ffprobe (Dauer, Masse inkl. Rotation, `creation_time`), `preview.mp4` (H.264, max. 1920 px Kante,
  AAC, faststart), Poster-Frame bei 1 s → Thumbnails.
- Ergebnis `READY` (mit `width/height/durationSec/takenAt`) oder `FAILED` mit `processingError`.
  BullMQ wiederholt 3× mit Backoff.
- Ohne Redis (Entwicklung): `MEDIA_PROCESSING=inline` verarbeitet im API-Prozess.
- `takenAt`-Priorität: EXIF/creation_time → `takenAt`-Hinweis des Clients → Upload-Zeit.

### Timeline & Dateien

| Route | Recht |
|---|---|
| `GET /families/:id/timeline?limit=&cursor=&month=YYYY-MM&type=PHOTO\|VIDEO&commented=true` (Filter kombinierbar) | Mitglied |
| `GET /families/:id/timeline/months` → `[{ month, count }]` | Mitglied |
| `GET /media/:id` | Mitglied |
| `PATCH /media/:id` `{ caption?, takenAt? }` · `DELETE /media/:id` (Soft-Delete, Dateien weg) | Uploader oder Familien-Admin |
| `GET /media/:id/info` → Aufnahme-Metadaten (Kamera, Objektiv, Blende, Belichtung, ISO, Brennweite, GPS, Originalzeit) + Dateiinfos | Mitglied |
| `POST /families/:id/media/taken-at` `{ ids[], takenAt }` **oder** `{ ids[], shiftSeconds }` → `{ updated, skipped[] }` | Mitglied; wirkt nur auf eigene Medien bzw. alle als Familien-Admin, Rest landet in `skipped` |
| `GET /media/:id/thumb/400` · `/thumb/1600` (WebP) | Mitglied **oder** Signatur |
| `GET /media/:id/preview` (MP4, Range-Requests) | Mitglied **oder** Signatur |
| `GET /media/:id/original` (Content-Disposition, Range) | canDownload **oder** Signatur |

Timeline-Antwort: `{ groups: [{ month: 'YYYY-MM', items: Media[] }], nextCursor }`, neueste zuerst,
Cursor = `(takenAt, id)`. `PROCESSING` sehen alle (Platzhalter), `FAILED` nur der Uploader.

**Aufnahmedatum korrigieren:** `takenAt` ist die Sortier- und Gruppierungsgrundlage. Wer ein Medium bearbeiten darf,
kann es per `PATCH` auf einen Zeitpunkt setzen; für Serien (falsche Zeitzone, verstellte Kamera-Uhr) verschiebt
`shiftSeconds` alle gewählten Medien um denselben Betrag, die Abstände bleiben erhalten. Der Auszug aus den
Aufnahme-Metadaten (`Media.exif`, JSON) wird beim Verarbeiten gespeichert; für Altbestand liest `GET /media/:id/info`
ihn beim ersten Abruf aus der Originaldatei nach (nicht für HEIC). `exif.originalDateTime` ist die Zeit laut Datei und
bleibt von Korrekturen unberührt.

**Signierte URLs:** Jedes `Media` enthält `urls.{thumb400, thumb1600, preview, original}` als relative Pfade
mit `?exp=&sig=` (HMAC-SHA256 über Pfad + Ablauf, `SIGNED_URL_TTL_SECONDS`, Standard 24 h). Damit laden
`<img>`/Video-Player ohne Authorization-Header (Flutter Web, Caches). `original` wird nur an Mitglieder mit
`canDownload` ausgegeben; `thumb*`/`preview` erst ab `READY`. Der Entzug einer Mitgliedschaft wirkt auf
bereits ausgegebene Links erst nach Ablauf der TTL.

Dateiablage: `MEDIA_ROOT/<familyId>/<mediaId>/{original.<ext>, thumb_400.webp, thumb_1600.webp, preview.mp4, poster.jpg}`,
Chunks unter `MEDIA_ROOT/_uploads/<sessionId>/`.

## Profilbild

| Route | Recht |
|---|---|
| `PUT /me/avatar` (Body: JPEG/PNG/WebP als Rohdaten, max. 12 MB) → `{ avatarUrl }` | angemeldet |
| `DELETE /me/avatar` → `{ avatarUrl: null }` | angemeldet |
| `GET /users/:id/avatar` (signierter Link **oder** Bearer) | angemeldet |

Der Server schneidet quadratisch zu (Motiv-Erkennung), speichert 512×512 als WebP unter `_avatars/<userId>.webp` und
setzt `User.avatarUpdatedAt`. Jedes `UserBrief` (Kommentar-Autor, Uploader, Mitglied, Aktivität) und `User`/`Me` tragen
`avatarUrl`: ein signierter Link mit einer Woche Gültigkeit und `v=<Zeitstempel>` als Cache-Brecher, `null` ohne Bild.
HEIC wandelt die App vor dem Upload auf dem Gerät in JPEG.

## Rückblicke (M9)

| Route | Recht |
|---|---|
| `GET /families/:id/recaps` | Mitglied |
| `POST /families/:id/recaps` `{ kind: MONTH\|YEAR\|SECONDS, period: JJJJ-MM \| JJJJ }` → 202 | canUpload |
| `DELETE /recaps/:id` | Familien-Admin |
| `GET /recaps/:id/video`, `GET /recaps/:id/poster` (signiert **oder** Mitglied) | Mitglied |
| `GET /families/:id/on-this-day` → `{ groups: [{ label, date, monthsAgo, items: Media[] }] }` | Mitglied |

Der Worker wählt die Medien gleichmässig über den Zeitraum verteilt (Monat: ~32 pro Tag verteilt, Jahr: ~60 nach
Wochen, Sekunden-Film: genau eines pro Tag, je 1 s), bevorzugt Kommentiertes, begrenzt Videos, und baut mit ffmpeg
ein 1080p-Video: Titelkarte, Fotos mit Kamerafahrt vor unscharfem Hintergrund, Ausschnitte aus der Mitte der Videos,
Überblendungen, Abspann mit Musik-Nachweis. Musik: zufälliges Stück aus `MUSIC_PATH` (Standard `<Medien>/_music`,
eigene MP3s) oder den mitgelieferten Stücken von Kevin MacLeod (CC BY 4.0, Nachweis im Abspann).
Automatik über BullMQ-Job-Scheduler: am 1. jedes Monats 06:00 der Vormonat, am 2. Januar 07:00 das Vorjahr
(Europe/Zurich), nur für Familien mit Medien im Zeitraum. Fertige Videos lösen einen Push an alle Mitglieder aus
(`type: recap`, `recapId`). `POST` auf einen bestehenden Zeitraum baut das Video neu (409 `RECAP_EMPTY` ohne Medien).

## Export (M8)

| Route | Recht |
|---|---|
| `GET /families/:id/export-link/:scope` → `{ url, expiresAt, scope }` | canDownload |
| `GET /families/:id/export/:scope` (Bearer mit canDownload **oder** signierter Link) | canDownload |

`scope` ist `alle` oder ein Monat `JJJJ-MM`. Die Antwort ist ein ZIP-Stream ohne Kompression (Fotos und Videos sind
schon komprimiert): Originale unter `JJJJ/MM/JJJJ-MM-TT_HHMMSS_<Originalname>`, `index.json` mit allen Metadaten
(Aufnahmedatum, Uploader, Beschreibung, EXIF-Auszug) und Kommentaren, `kommentare.md` zum Lesen, `LIESMICH.txt`.
Der signierte Link ist eine Stunde gültig und braucht kein Token – so kann der Browser den Download direkt starten.
Gelöschte und noch nicht verarbeitete Medien fehlen. Das ist die Datenhoheit, die uns FamilyAlbum verweigert hat:
alles jederzeit in einem Rutsch, ohne App.

## Kommentare (M4)

| Route | Recht |
|---|---|
| `GET /media/:id/comments` (älteste zuerst) | Mitglied |
| `POST /media/:id/comments` `{ body }` (1–2000 Zeichen, nur bei `READY`) | canComment |
| `PATCH /comments/:id` `{ body }` | Autor, Familien-Admin oder globaler Admin |
| `DELETE /comments/:id` | Autor, Familien-Admin oder globaler Admin |

`Comment` enthält `canEdit`/`canDelete` für die App und `editedAt`, sobald der Text geändert wurde; der Autor bleibt
beim Bearbeiten erhalten. `Media.commentCount` zählt mit. Soft-gelöschte Medien liefern 404. Der globale Admin muss
Mitglied der Familie sein (ADR-0003) – ohne Mitgliedschaft sieht er weder Medien noch Kommentare.

## Push & Aktivität (M4)

- `POST /devices` `{ fcmToken, platform }` registriert ein Gerät (Upsert; ein Token gehört immer dem zuletzt
  angemeldeten Benutzer). `DELETE /devices` `{ fcmToken }` beim Abmelden.
- `GET /families/:id/activity?since=` → `{ newMedia, newComments, since, serverTime }` – zählt nur Beiträge **anderer**
  Mitglieder. Ohne `since` gilt der zuletzt gesehene Zeitpunkt (`FamilyMember.activitySeenAt`, sonst Beitritt) –
  das ist der Ungelesen-Zähler der Glocke. Web und Windows pollen damit jede Minute.
- `GET /families/:id/activity/feed?cursor=&limit=` → `{ items: FeedItem[], nextCursor, seenAt }`, neueste zuerst.
  `FeedItem` ist entweder eine **Upload-Serie** (`type: 'UPLOAD'`: gleiche Person, höchstens eine Stunde Abstand
  zwischen zwei Uploads; `count/photos/videos`, bis zu vier Vorschau-Medien) oder ein **Kommentar**
  (`type: 'COMMENT'`, `comment.body` gekürzt auf 200 Zeichen, `media[0]` ist das kommentierte Medium). `mine` markiert
  eigene Aktionen, `unread` alles Fremde nach `seenAt`. Der Cursor ist der Zeitpunkt des letzten Eintrags.
- `POST /families/:id/activity/seen` → `{ seenAt }` setzt den Zeitpunkt auf jetzt (App ruft es beim Öffnen des Verlaufs).

**Versand** (`src/services/notification.service.ts`):

- Neue Medien werden pro Familie und Uploader gebündelt: der Worker reiht nach jedem fertigen Medium einen
  verzögerten Job `notify` ein (`NOTIFY_DIGEST_SECONDS`, Standard 90 s, feste jobId → keine Duplikate).
  Beim Ausführen werden alle Medien mit `notifiedAt = null` gezählt, markiert und als eine Nachricht an alle
  anderen Mitglieder geschickt („Anna hat 3 neue Fotos und 1 neues Video hinzugefügt“).
- Kommentare gehen sofort an alle Mitglieder der Familie, nie an den Autor.
- FCM antwortet mit ungültigen Tokens → diese Geräte werden gelöscht.
- Ohne `FIREBASE_SERVICE_ACCOUNT` (Pfad zur Service-Account-JSON) ist Push aus; alles andere funktioniert,
  die Clients pollen.

Nachrichten-Daten (`data`): `type` = `media` | `comment`, `familyId`, bei Kommentaren `mediaId` und `commentId`.
Die App öffnet beim Antippen das betroffene Medium.
