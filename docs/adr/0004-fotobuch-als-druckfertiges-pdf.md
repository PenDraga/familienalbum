# ADR-0004: Fotobuch als druckfertiges PDF statt Anbindung an eine Druckerei

Status: akzeptiert · Datum: 2026-10-12

## Kontext

Familien möchten aus dem Album ein gedrucktes Fotobuch machen. Die Schweizer und deutschen Fotobuch-Anbieter
(CEWE/Pixum, ifolor, Bookfactory, Saal Digital, Photobox) bieten keine öffentliche Bestell-API; echte Druck-APIs
gibt es nur bei Print-on-Demand-Plattformen (Peecho, Gelato, Print API), deren Lieferung in die Schweiz und deren
Formatvorgaben nicht offen dokumentiert sind. Eine direkte Anbindung würde die App an einen Anbieter binden und
Zahlungsabwicklung in die App holen.

## Entscheidung

- Der Server erzeugt ein **druckfertiges PDF** («Fotobuch»), das bei jedem Anbieter mit PDF-Upload bestellt werden
  kann. Keine Druckerei-API, keine Bezahlung in der App. Eine spätere Anbindung (z. B. Peecho-Checkout-Link) bleibt
  als zweiter Schritt möglich und ändert am Datenmodell nichts.
- **Formate:** 21 × 21 cm, A4 quer (29,7 × 21 cm), 30 × 30 cm; je 3 mm Beschnitt, 10 mm Sicherheitsabstand, sRGB,
  Bilder in Originalauflösung bis 300 dpi. Schriften Baloo 2 und Nunito werden eingebettet.
- **Automatischer Layoutvorschlag** auf dem Server: Umschlag (Albumname, Zeitraum, Titelbild), Kapitelseite pro
  Monat, Fotos nach Aufnahmedatum. Die **Anordnung** ist wählbar, nach dem Vorbild gängiger Anbieter (CEWE leitet die
  Fotos pro Seite aus der Seitenzahl ab, Shutterfly empfiehlt 1–4 pro Seite im Wechsel mit ganzseitigen Bildern,
  Lightroom/Blurb bieten «ein Foto pro Seite» als Regel): `SINGLE` (gerahmt), `MIXED` (1–4, Tage bleiben zusammen,
  ein ganzseitiges Highlight pro Monat), `COLLAGE` (bis 6). Die Vorlage `auto` setzt die Fotos in Reihen oder
  Spalten nach ihrem Seitenverhältnis (wie Google Fotos), ohne Beschnitt. Der Vorschlag ist deterministisch.
- **Assistent** in der App: Zeitraum (nur Monate mit Fotos), einzelne Fotos abwählen, Gestaltung mit
  Seitenschätzung des Servers. **Kontroll-Assistent** danach: jede Seite mit Server-Vorschau (`preview-page`),
  Ausschnitt pro Foto als Fokuspunkt und Zoom (`crop`), Fotos entfernen oder verschieben, Text pro Seite ausblenden,
  Umschlagfoto und Titel; ohne gesetzten Ausschnitt schneidet der Server auf den bildwichtigsten Bereich.
- **Entwurf zuerst:** Anlegen und jede Änderung ergeben einen Entwurf (`DRAFT`) ohne Rendern; geprüft wird mit
  schnellen Einzelseiten-Vorschauen. Das Druck-PDF entsteht erst über «PDF erstellen» (`RENDERING` → `READY`), damit
  nie ein ungeprüftes PDF bereitliegt und der Server nicht doppelt rechnet.
- **Texte** werden beim Erzeugen gewählt: keine, Bildunterschriften, Bildunterschriften mit Kommentaren. Der Schalter
  bestimmt das Layout; in der Bearbeitung können Texte pro Seite ausgeblendet und einzelne Kommentare entfernt werden.
- **Gespeichert** wird ein `PhotoBook` pro Album (Titel, Format, Optionen, Seitenliste als JSON, Status, PDF-Pfad).
  Die Seitenliste ist die Wahrheit; PDF und Seitenvorschauen (WebP) werden daraus gerendert und bei Änderungen neu
  gebaut. Bearbeitung in Stufe 1: Bild entfernen, Reihenfolge ändern, Vorlage pro Seite wechseln, Titel und
  Kapiteltexte, Bildunterschrift im Buch überschreiben (das Original bleibt unverändert).
- **Rechte:** neues Mitglieder-Flag `canCreateBooks` («Fotobuch erstellen»), auch in Einladungen. Bearbeiten und
  Löschen darf, wer das Buch angelegt hat, oder der Album-Admin. Sehen und PDF laden dürfen alle Mitglieder.
- **Grenzen:** höchstens 200 Seiten pro Buch; nur Fotos (Videos liefern ihr Poster-Bild nicht ins Buch).

## Konsequenzen

- Neue Routen unter `/families/:id/books` und `/books/:id` (Anlegen, Liste, Detail mit Seiten, Seiten ändern, PDF
  erzeugen, PDF und Seitenvorschau laden, Löschen); BullMQ-Job `render-book`.
- Der Layout-Teil ist reine Berechnung (`services/book-layout.ts`), der Renderer (`services/book-render.ts`) zeichnet
  PDF (pdfkit) und Vorschauen (sharp) aus denselben Rechtecken.
- Dateien unter `/data/media/<familyId>/books/<bookId>/{book.pdf, page_<n>.webp}`.
- Die Rechtematrix im Projekt-Brief wird um `canCreateBooks` ergänzt.
