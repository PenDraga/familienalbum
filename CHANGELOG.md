# Changelog

Alle nennenswerten Änderungen. Versionen folgen [SemVer](https://semver.org/lang/de/); bis 1.0 sind Änderungen an
der API ohne Ankündigung möglich. Docker-Images tragen dieselben Tags wie die Releases.

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
