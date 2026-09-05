# ADR-0001: Registrierung nur über Einladung

Status: akzeptiert · Datum: 2026-09-04

## Kontext

Der Projekt-Brief listet `POST /invites/:code/accept`, aber keine Registrierungs-Route. Ein neues
Familienmitglied (z.B. Grosseltern) hat aber noch kein Konto und soll ohne Umweg über den globalen
Admin beitreten können. Gleichzeitig ist die API über den Cloudflare Tunnel öffentlich erreichbar –
eine offene Registrierung ist unerwünscht.

## Entscheidung

`POST /invites/:code/accept` hat zwei Modi:

- **Mit Bearer-Token:** der angemeldete Benutzer wird Mitglied.
- **Ohne Token, mit `{ email, password, displayName }`:** Konto und Mitgliedschaft werden in einer
  Transaktion angelegt; die Antwort enthält zusätzlich `user` und `tokens`, sodass die App direkt
  angemeldet ist.

Es gibt keine separate `POST /auth/register`-Route. Konten entstehen ausschliesslich über Einladungen
oder `POST /admin/users`.

## Konsequenzen

- Ein Einladungscode ist damit ein Registrierungs-Token: Standard-Gültigkeit 7 Tage, standardmässig
  eine Nutzung, Rate-Limit auf der Route, lesbares 10-Zeichen-Alphabet mit ~49 Bit Entropie.
- Ist die E-Mail bereits vergeben, antwortet der Server 409 `EMAIL_TAKEN` mit dem Hinweis, sich zuerst
  anzumelden – die Einladung wird dabei nicht verbraucht.
- Die App zeigt vor dem Annehmen `GET /invites/:code` (Familienname, Rechte) als Vorschau an.
