// Store-Eintrag für Google Play setzen: Titel, Beschreibungen (de-DE), Icon, Feature-Grafik, Screenshots.
//   node tool/play_listing.mjs                    → Texte + Icon + Feature-Grafik
//   node tool/play_listing.mjs --screenshots      → zusätzlich store/screenshots/*.png als Phone-Screenshots
// Braucht android/play-service-account.json mit dem Recht «Store-Präsenz verwalten».
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '../../../node_modules/'));
const { JWT } = require('google-auth-library');

const PACKAGE = 'ch.familienalbum.familienalbum';
const LANG = 'de-DE';
const store = resolve(here, '..', 'store');
const args = new Set(process.argv.slice(2));

const listing = {
  language: LANG,
  title: 'Familienalbum',
  shortDescription: 'Das private Familienalbum: Fotos, Videos und Kommentare auf eurem eigenen Server.',
  fullDescription: [
    'Familienalbum ist das private Fotoalbum für die Familie – selbst gehostet, ohne Werbung, ohne Fremdzugriff.',
    '',
    '• Fotos und Videos hochladen, chronologisch nach Aufnahmedatum',
    '• Kommentare und Mitteilungen bei neuen Bildern',
    '• Rückblick-Videos pro Monat und Jahr, Sekunden-Film, «An diesem Tag»',
    '• Automatischer Upload neuer Aufnahmen im Hintergrund',
    '• Export aller Fotos und Kommentare als ZIP – eure Daten gehören euch',
    '• Familien mit eigenen Rechten: Hochladen, Herunterladen, Kommentieren',
    '',
    'Der Zugang erfolgt ausschliesslich per Einladung durch die Familie. Die App verbindet sich mit dem eigenen Familienalbum-Server.',
  ].join('\n'),
};

const key = JSON.parse(readFileSync(resolve(here, '..', 'android', 'play-service-account.json'), 'utf8'));
const client = new JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
const { token } = await client.getAccessToken();
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const upload = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}`;

async function call(method, url, body, contentType = 'application/json') {
  const res = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': contentType }, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url.replace(base, '').replace(upload, '')} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const edit = await call('POST', `${base}/edits`, '{}');
await call('PUT', `${base}/edits/${edit.id}/listings/${LANG}`, JSON.stringify(listing));
console.log('Texte gesetzt');

async function replaceImages(type, files) {
  await call('DELETE', `${base}/edits/${edit.id}/listings/${LANG}/${type}`);
  for (const f of files) {
    await call('POST', `${upload}/edits/${edit.id}/listings/${LANG}/${type}?uploadType=media`, readFileSync(f), 'image/png');
    console.log(`${type}: ${f.split('/').pop()}`);
  }
}
await replaceImages('icon', [resolve(store, 'icon-512.png')]);
await replaceImages('featureGraphic', [resolve(store, 'feature-1024x500.png')]);
if (args.has('--screenshots') && existsSync(resolve(store, 'screenshots'))) {
  const shots = readdirSync(resolve(store, 'screenshots')).filter((f) => f.endsWith('.png')).sort().map((f) => resolve(store, 'screenshots', f));
  if (shots.length) await replaceImages('phoneScreenshots', shots);
}
await call('POST', `${base}/edits/${edit.id}:commit`, '{}');
console.log('Store-Eintrag gespeichert.');
