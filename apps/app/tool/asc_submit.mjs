// App-Store-Version zur Prüfung einreichen (nach tool/asc_listing.mjs, das Version, Texte und Build setzt).
//   node tool/asc_submit.mjs            → prüft Version (aus pubspec.yaml), Build und «Was ist neu», reicht ein
//   node tool/asc_submit.mjs --dry-run  → nur prüfen und anzeigen
// Braucht ios/asc.env (siehe ios/asc.env.example).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { SignJWT, importPKCS8 } = require('jose');
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const BUNDLE_ID = 'ch.familienalbum.familienalbum';

const env = Object.fromEntries(
  readFileSync(resolve(app, 'ios/asc.env'), 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => l.split(/=(.*)/s).slice(0, 2).map((s) => s.trim())),
);
const versionString = readFileSync(resolve(app, 'pubspec.yaml'), 'utf8').match(/^version:\s*([\d.]+)\+(\d+)/m);
if (!versionString) throw new Error('version in pubspec.yaml nicht gefunden');
const [, version, build] = versionString;

const keyPath = (env.ASC_KEY_PATH || `~/.appstoreconnect/private_keys/AuthKey_${env.ASC_KEY_ID}.p8`).replace(/^~/, homedir());
const privateKey = await importPKCS8(readFileSync(keyPath, 'utf8'), 'ES256');
async function api(method, path, body) {
  const jwt = await new SignJWT({ aud: 'appstoreconnect-v1' }).setProtectedHeader({ alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' }).setIssuer(env.ASC_ISSUER_ID).setIssuedAt().setExpirationTime('15m').sign(privateKey);
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, { method, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

const appId = (await api('GET', `/v1/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0]?.id;
const versions = await api('GET', `/v1/apps/${appId}/appStoreVersions?filter[versionString]=${version}&filter[platform]=IOS&include=build`);
const v = versions.data[0];
if (!v) throw new Error(`App-Store-Version ${version} fehlt – zuerst node tool/asc_listing.mjs`);
const attachedBuild = versions.included?.find((x) => x.type === 'builds');
console.log(`Version ${version}: ${v.attributes.appStoreState}, Build ${attachedBuild?.attributes.version ?? '–'}`);
if (attachedBuild?.attributes.version !== build) throw new Error(`Build ${build} ist nicht an Version ${version} gehängt – node tool/asc_listing.mjs ausführen, sobald Apple ihn verarbeitet hat`);

const locs = await api('GET', `/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`);
for (const l of locs.data) {
  console.log(`\n«Was ist neu» (${l.attributes.locale}):\n${l.attributes.whatsNew ?? '(leer)'}`);
  if (!l.attributes.whatsNew) throw new Error(`«Was ist neu» fehlt für ${l.attributes.locale}`);
}

// READY_FOR_REVIEW: Version liegt in einer vorbereiteten, noch nicht abgeschickten Einreichung (z. B. nach einem 500 von Apple)
if (!['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'].includes(v.attributes.appStoreState)) {
  console.log(`\nNichts einzureichen (Status ${v.attributes.appStoreState}).`);
  process.exit(0);
}
if (dryRun) {
  console.log('\n--dry-run: nicht eingereicht.');
  process.exit(0);
}

// Offene Einreichung wiederverwenden, sonst neue anlegen
const open = await api('GET', `/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW`);
let submission = open.data[0];
if (!submission) {
  submission = (await api('POST', '/v1/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: appId } } } } })).data;
}
const items = await api('GET', `/v1/reviewSubmissions/${submission.id}/items`);
if (!items.data.length) {
  await api('POST', '/v1/reviewSubmissionItems', {
    data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: submission.id } }, appStoreVersion: { data: { type: 'appStoreVersions', id: v.id } } } },
  });
}
await api('PATCH', `/v1/reviewSubmissions/${submission.id}`, { data: { type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true } } });
const after = await api('GET', `/v1/appStoreVersions/${v.id}`);
console.log(`\nEingereicht: Version ${version} (Build ${build}) – Status ${after.data.attributes.appStoreState}.`);
