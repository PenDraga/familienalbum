# ADR-0003: Kommentare bearbeiten und löschen durch Familien- und globale Admins

Status: akzeptiert · Datum: 2026-09-06

## Kontext

Der Projekt-Brief erlaubt das Löschen von Kommentaren nur dem Autor und dem Familien-Admin, Bearbeiten gab es
nicht. Globale Admins umgehen Familienrechte grundsätzlich nicht. In der Praxis betreibt eine Person den Server
und soll Kommentare aller Mitglieder moderieren können – auch in Familien, in denen sie nicht Familien-Admin ist,
und auch nachträglich korrigieren, statt nur zu löschen.

## Entscheidung

- Neue Route `PATCH /comments/:id` `{ body }`; `Comment` bekommt `editedAt`, `canEdit` und `canDelete`.
- Bearbeiten und Löschen dürfen: der Autor, der Familien-Admin und der globale Admin (`User.isAdmin`).
- Die Ausnahme gilt **nur für Kommentare**. Für Medien, Mitglieder und Einladungen bleibt der Grundsatz bestehen:
  globale Admins haben in einer Familie keine Sonderrechte.
- Der globale Admin muss weiterhin Mitglied der Familie sein; der Rechte-Hook (`member`) bleibt unverändert.
  Ohne Mitgliedschaft sieht er die Medien nicht und kommt auch an die Kommentare nicht heran.

## Konsequenzen

- Der Autor eines bearbeiteten Kommentars bleibt erhalten, `editedAt` macht die Änderung sichtbar („bearbeitet“).
- Die App blendet Stift und Papierkorb anhand von `canEdit`/`canDelete` ein; die Prüfung erfolgt serverseitig.
- Die Rechtematrix im Projekt-Brief wurde entsprechend angepasst.
