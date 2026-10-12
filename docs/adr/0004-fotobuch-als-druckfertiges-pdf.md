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
- **Automatischer Layoutvorschlag** im Worker: Umschlag (Albumname, Zeitraum, Titelbild), Kapitelseite pro Monat,
  Bilder nach Aufnahmedatum gruppiert nach Tag; Vorlagen «eins», «zwei», «vier», «Bild mit Text». Der Vorschlag ist
  deterministisch (gleiche Eingabe → gleiches Buch).
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
