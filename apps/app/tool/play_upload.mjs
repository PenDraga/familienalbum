// Lädt das App Bundle in die Google Play Console (Standard: interner Test).
//   node tool/play_upload.mjs                 → build/app/outputs/bundle/release/app-release.aab, Track "internal"
//   node tool/play_upload.mjs --track=alpha   → anderer Track (internal | alpha | beta | production)
//   node tool/play_upload.mjs --notes="Text"  → Versionshinweis (de-CH)
// Braucht android/play-service-account.json (Service-Account mit Release-Recht in der Play Console; nicht im Git).
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '../../../node_modules/'));
const { JWT } = require('google-auth-library');

const PACKAGE = 'ch.familienalbum.familienalbum';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const track = args.track ?? 'internal';
const bundle = resolve(here, '..', args.file ?? 'build/app/outputs/bundle/release/app-release.aab');
const keyPath = resolve(here, '..', 'android', 'play-service-account.json');

const key = JSON.parse(readFileSync(keyPath, 'utf8'));
const client = new JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
const { token } = await client.getAccessToken();
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;

async function call(method, url, body, contentType = 'application/json') {
  const res = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': contentType }, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

const size = statSync(bundle).size;
console.log(`Lade ${bundle} (${(size / 1024 / 1024).toFixed(1)} MB) nach Track "${track}" …`);
const edit = await call('POST', `${base}/edits`, '{}');
const uploaded = await call(
  'POST',
  `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}/edits/${edit.id}/bundles?uploadType=media`,
  readFileSync(bundle),
  'application/octet-stream',
);
console.log(`Bundle hochgeladen: versionCode ${uploaded.versionCode}`);
const release = { status: 'completed', versionCodes: [String(uploaded.versionCode)] };
if (args.notes) release.releaseNotes = [{ language: 'de-CH', text: args.notes }];
await call('PUT', `${base}/edits/${edit.id}/tracks/${track}`, JSON.stringify({ track, releases: [release] }));
await call('POST', `${base}/edits/${edit.id}:commit`, '{}');
console.log(`Fertig: versionCode ${uploaded.versionCode} ist im Track "${track}" freigegeben.`);
