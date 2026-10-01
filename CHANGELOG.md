# Changelog

Alle nennenswerten Änderungen. Versionen folgen [SemVer](https://semver.org/lang/de/); bis 1.0 sind Änderungen an
der API ohne Ankündigung möglich. Docker-Images tragen dieselben Tags wie die Releases.

## [Unreleased]

### Server
- Push trägt als Badge die Anzahl ungelesener Einträge des Empfängers (vorher immer 1)

### App
- Zahl auf dem App-Symbol (iOS) folgt dem Ungelesen-Zähler und verschwindet nach dem Öffnen des Verlaufs; Build 31
- Login-Screen belegt die Server-Adresse aus dem Build vor (`API_BASE_URL` in `firebase.env`); Einladungs-Screen erklärt
  falsche Codes und verlinkt zur Anmeldung (Rückmeldung von App Review); Build 30

## [1.0.0] – 2026-09-15

Erste Version für App Store und Google Play (offener Test). Seit der ersten Beta:

### Server
- Rückblick-Videos (Monat, Jahr, Sekunden-Film) per ffmpeg im Worker, automatisch am Monatsersten / 2. Januar
  und per Knopf; «An diesem Tag»; Musik von Kevin MacLeod (CC BY 4.0) mit Nachweis im Abspann
- Export als ZIP (gesamt oder pro Monat) mit Originalen, `index.json` und Kommentaren; signierter Link
- Profilbilder (`PUT /me/avatar`, 512×512 WebP), `avatarUrl` in allen Benutzer-DTOs
- Kommentare bearbeiten; Familien- und globale Admins moderieren alle Kommentare (ADR-0003);
  Kommentar-Push an alle Mitglieder
- Timeline-Filter `type` und `commented`
- `GET /families/:id/storage`: belegter Speicher pro Familie (Fotos/Videos), freier Platz unter `MEDIA_ROOT` für Admins
- `GET /admin/families` liefert Fotos, Videos und Bytes pro Album; Fehlermeldungen sprechen von «Album»
- Caddy liefert `/.well-known/apple-app-site-association` als JSON (Universal Links)
- Robustes Löschen auf FUSE-Dateisystemen (Unraid), fehlgeschlagene Medien werden beim Start neu eingereiht,
  Bildformat wird an den Bytes erkannt; Image auf Debian Trixie (libheif 1.19, ffmpeg 7.1) für iOS-17/18-HEIC
- Unbrauchbarer Firebase-Schlüssel legt die API nicht mehr lahm; `SECRETS_PATH` für Stack-Manager

### App
- Redesign «Kinderbuch»: neues Logo und App-Icon, Vanille/Koralle/Lagune/Sonne, Baloo 2 und Nunito gebündelt
- Push auf iOS (APNs-Registrierung, Token-Typ aus dem Profil) und Android
- Sammlungen-Leiste: «An diesem Tag», Rückblicke, «Rückblick erstellen»; Rückblick-Player mit Teilen
- Export in den Einstellungen (auf dem Handy in der App geladen, dann Teilen-Blatt)
- Profilbild wählen; Avatare bei Kommentaren, Aktivität, Mitgliedern; «Zuletzt im Album»
- Kommentare bearbeiten/löschen, Sprechblasen, Text-Emoji (♥️ ✈️ ⚠️ …) farbig, Sheet weicht der Tastatur aus
- Start hängt nicht mehr bei unerreichbarem Server; Server wechseln in den Einstellungen
- Einladungs-Screen erklärt das neue Konto; Version in den Einstellungen; Filter-Chips; Einstellungen im
  neuen Design; Android-Build mit Release-Signierung
- Einstellungen → «Speicherplatz»: Verbrauch des Albums nach Fotos/Videos, für Admins zusätzlich freier Platz auf dem Server
- Play-Store-Eintrag mit Screenshots; Android-Name «Familienalbum»; Build 21 auf beiden Plattformen
- Begriff «Album» statt «Familie» in allen Texten; Album umbenennen (Album-Admin) in Mitglieder und Verwaltung → Alben
- Verwaltung → Alben zeigt Fotos, Videos und belegten Speicher pro Album
- Einladung als Link teilen (`https://<server>/invite?code=…&server=…`): öffnet die Web-App mit vorbelegtem Server
  und Code, prüft die Einladung sofort und bietet «In der App öffnen» (Schema `familienalbum://`); Universal/App Links
  per `tool/set_domain.sh <domain>` und `web/.well-known/`; «Einladen» in der Hauptmaske nutzt denselben Teilen-Dialog; Build 23
- Automatischer Upload nur mit Recht «Hochladen»: Schalter sonst gesperrt, Album-Auswahl zeigt nur erlaubte Alben,
  bei Entzug des Rechts schaltet sich der Auto-Upload ab (auch im Hintergrund-Lauf, der das Recht vor jedem Upload prüft); Build 24
- `tool/testflight_upload.mjs`: IPA per App-Store-Connect-API hochladen, auf Verarbeitung warten, Testhinweise setzen,
  Build an die TestFlight-Gruppe hängen (kein Xcode-Organizer mehr nötig); Build 25 als erster Durchlauf
- Universal Links / App Links für `album.depaolis.digital`: Einladungslink öffnet die installierte App direkt; Build 26
- App Store Connect per Skript gepflegt (`tool/asc_listing.mjs`): Untertitel, Kategorie Foto & Video, Datenschutz-URL,
  Beschreibung, Keywords, TestFlight-Beschreibung, zehn Screenshots (6,7" und 6,5"); App nur noch für iPhone (kein iPad)
- App Store: Copyright, Inhaltsrechte, Preis kostenlos (Basisregion CH), Build 28 ohne iPad an Version 1.0
- Version 1.0.0 (Build 29) auf allen Plattformen; App-Store-Version heisst ebenfalls 1.0.0
- Konto löschen (globaler Admin): `DELETE /admin/users/:id` anonymisiert das Konto, Fotos und Kommentare bleiben als
  «Gelöschtes Konto»; in der App unter Benutzer mit Sicherheitsabfrage; Migration `m12_user_deleted`; Build 27

## [0.1.0-beta.1] – 2026-09-05

Erste Beta für den Familientest: Server im Dauerbetrieb, Web-App und iOS-App im Einsatz.

### Server
- Auth mit E-Mail/Argon2id, Access- und Refresh-Token mit Rotation und Wiederverwendungs-Erkennung
- Familien, Mitglieder-Rechte, Einladungslinks; globale Admins verwalten Benutzer und Familien
- Chunk-Upload (wiederaufnehmbar, Duplikat-Erkennung per SHA-256), HEIC/HEIF-Umwandlung, iPhone-Videos mit
  nicht dekodierbaren Tonspuren, Rotation aus den Stream-Metadaten
- Worker mit BullMQ/Redis: Thumbnails 400/1600 als WebP, Video-Preview H.264 bis 1080p, Poster-Frame
- Timeline nach Monat, signierte Medien-URLs, Kommentare, Push-Digest über Firebase Cloud Messaging (optional)
- Aufnahme-Metadaten (EXIF bzw. QuickTime-Tags) als Auszug gespeichert; Aufnahmedatum einzeln oder gesammelt
  setzen/verschieben
- Aktivitäts-Verlauf (Upload-Serien, Kommentare), Ungelesen-Zähler pro Mitglied
- RFC-7807-Fehler, OpenAPI aus den Zod-Schemas, 180 Integrationstests (Vitest + Testcontainers)

### App (Flutter: iOS, Android, Web)
- Immersive Timeline mit Mosaik, Vollbild mit Wischen/Zoom/Tastatur, Videos mit Spulen, Mehrfachauswahl
- Upload mit Warteschlange, Wiederholung und Fortsetzung; Auto-Upload im Hintergrund (iOS, Android)
- Info-Sheet mit Kamera, Belichtung, Ort (Karte) und Datei; Dialog „Datum und Uhrzeit ändern“ (setzen/verschieben)
- Original in die Fotos-Mediathek sichern oder teilen (nativ), Teilen-Blatt bzw. Download im Browser
- Aktivität: Glocke mit Zähler, Verlauf nach Tagen, Sprung zum Foto oder Kommentar
- Verwaltung in der App: Mitglieder-Rechte, Einladungen, Benutzer, Familien
- Hell/Dunkel, Branding (Icon, Splash), Server-URL im Login wählbar

### Betrieb
- Docker-Compose-Stack: PostgreSQL 16, Redis 7, API, Worker, Caddy mit Web-Build, Cloudflare Tunnel (Profil)
- Images aus GitHub Actions in der GitHub Container Registry (`familienalbum-api`, `familienalbum-web`)
- Alle Werte per Variablen-Ersetzung (kompatibel mit Dockhand/Portainer), Standard-Port 8090
- Entrypoint übergibt den Medien-Mount dem Laufzeit-Benutzer; Migrationen und Nach-Einreihen beim Start
- Backup-Skript (`pg_dump` + `rsync`)

### Bekannte Einschränkungen
- Push braucht ein eigenes Firebase-Projekt (APNs-Schlüssel, Dienstkonto); ohne dieses pollen die Clients
- Original im Browser lädt die Datei komplett in den Speicher; sehr grosse Videos können auf dem iPhone abbrechen
- Android-Build und Windows-Build sind noch nicht erstellt; TestFlight-Verteilung offen
- Kein Import aus FamilyAlbum, kein Export-Zip, kein Monats-Rückblick
