// TestFlight-Upload ohne Xcode-Organizer:
//   tool/build.sh ipa && node tool/testflight_upload.mjs --notes="Was neu ist"
//
// 1. lädt build/ios/ipa/familienalbum.ipa mit `xcrun altool` zu App Store Connect hoch
// 2. wartet, bis Apple den Build verarbeitet hat
// 3. setzt die Testhinweise («Was ist zu testen») und hängt den Build an die TestFlight-Gruppe
//
// Braucht ios/asc.env (nicht im Git, siehe ios/asc.env.example) mit dem App-Store-Connect-API-Schlüssel:
//   ASC_KEY_ID=ABC123DEFG        Schlüssel-ID
//   ASC_ISSUER_ID=…              Issuer-ID (UUID)
//   ASC_KEY_PATH=…               Pfad zur .p8-Datei (Standard: ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8)
//   ASC_GROUP=Familie            TestFlight-Gruppe (Standard: Familie)
// Optionen: --notes="…" (Testhinweise), --group=Name, --no-wait (nur hochladen), --skip-upload (nur Gruppe/Notizen)
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { SignJWT, importPKCS8 } = require('jose');

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const args = new Map(process.argv.slice(2).map((a) => (a.includes('=') ? a.split(/=(.*)/s).slice(0, 2) : [a, true])));

// ---------- Konfiguration ----------
const envFile = resolve(app, 'ios/asc.env');
if (!existsSync(envFile)) {
  console.error('ios/asc.env fehlt. Vorlage: ios/asc.env.example');
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => l.split(/=(.*)/s).slice(0, 2).map((s) => s.trim().replace(/^["']|["']$/g, ''))),
);
const keyId = env.ASC_KEY_ID;
const issuerId = env.ASC_ISSUER_ID;
const keyPath = (env.ASC_KEY_PATH || `~/.appstoreconnect/private_keys/AuthKey_${keyId}.p8`).replace(/^~/, homedir());
const groupName = String(args.get('--group') ?? env.ASC_GROUP ?? 'Familie');
const notes = args.get('--notes');
if (!keyId || !issuerId) {
  console.error('ASC_KEY_ID und ASC_ISSUER_ID in ios/asc.env setzen.');
  process.exit(1);
}
if (!existsSync(keyPath)) {
  console.error(`Schlüsseldatei fehlt: ${keyPath}`);
  process.exit(1);
}

const plist = readFileSync(resolve(app, 'ios/Runner/Info.plist'), 'utf8');
const bundleId = 'ch.familienalbum.familienalbum';
const pubspec = readFileSync(resolve(app, 'pubspec.yaml'), 'utf8');
const [, version, buildNumber] = /^version:\s*([\d.]+)\+(\d+)/m.exec(pubspec) ?? [];
if (!version) throw new Error('Version in pubspec.yaml nicht lesbar');
const ipa = resolve(app, 'build/ios/ipa/familienalbum.ipa');
if (!plist.includes('ITSAppUsesNonExemptEncryption')) console.warn('Hinweis: ITSAppUsesNonExemptEncryption fehlt in Info.plist, Apple fragt dann nach Verschlüsselung.');

// ---------- 1. Upload ----------
if (!args.has('--skip-upload')) {
  if (!existsSync(ipa)) {
    console.error(`IPA fehlt: ${ipa} (zuerst tool/build.sh ipa)`);
    process.exit(1);
  }
  console.log(`Lade ${ipa} (${(statSync(ipa).size / 1e6).toFixed(1)} MB), Version ${version} (${buildNumber}) …`);
  // altool sucht den Schlüssel in ~/.appstoreconnect/private_keys, ./private_keys, ~/private_keys
  execFileSync('xcrun', ['altool', '--upload-app', '-f', ipa, '-t', 'ios', '--apiKey', keyId, '--apiIssuer', issuerId], {
    stdio: 'inherit',
    env: { ...process.env, API_PRIVATE_KEYS_DIR: dirname(keyPath) },
  });
  console.log('Upload angenommen. Apple verarbeitet den Build jetzt (meist 5–15 Minuten).');
}
if (args.has('--no-wait')) process.exit(0);

// ---------- 2. App Store Connect API ----------
const privateKey = await importPKCS8(readFileSync(keyPath, 'utf8'), 'ES256');
async function token() {
  return new SignJWT({ aud: 'appstoreconnect-v1' })
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: 'JWT' })
    .setIssuer(issuerId)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);
}
async function api(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}

const apps = await api('GET', `/v1/apps?filter[bundleId]=${bundleId}`);
const appId = apps.data[0]?.id;
if (!appId) throw new Error(`App ${bundleId} nicht in App Store Connect gefunden`);

process.stdout.write(`Warte auf Build ${buildNumber} `);
let build;
for (let i = 0; i < 90; i++) {
  const res = await api('GET', `/v1/builds?filter[app]=${appId}&filter[version]=${buildNumber}&filter[preReleaseVersion.version]=${version}&limit=1`);
  build = res.data[0];
  if (build && build.attributes.processingState === 'VALID') break;
  if (build && ['FAILED', 'INVALID'].includes(build.attributes.processingState)) throw new Error(`Build ${buildNumber}: ${build.attributes.processingState}`);
  process.stdout.write('.');
  await new Promise((r) => setTimeout(r, 20000));
}
console.log();
if (!build || build.attributes.processingState !== 'VALID') throw new Error('Build nach 30 Minuten noch nicht verarbeitet – später mit --skip-upload erneut ausführen.');
console.log(`Build ${buildNumber} verarbeitet (${build.id}).`);

// Verschlüsselungsfrage (falls Info.plist sie nicht schon beantwortet)
if (build.attributes.usesNonExemptEncryption === null) {
  await api('PATCH', `/v1/builds/${build.id}`, { data: { type: 'builds', id: build.id, attributes: { usesNonExemptEncryption: false } } });
  console.log('Exportbestimmungen: keine nicht-exempte Verschlüsselung.');
}

// ---------- 3. Testhinweise + Gruppe ----------
if (notes) {
  const loc = await api('GET', `/v1/builds/${build.id}/betaBuildLocalizations`);
  const existing = loc.data.find((l) => l.attributes.locale === 'de-DE');
  if (existing) await api('PATCH', `/v1/betaBuildLocalizations/${existing.id}`, { data: { type: 'betaBuildLocalizations', id: existing.id, attributes: { whatToTest: String(notes) } } });
  else await api('POST', '/v1/betaBuildLocalizations', { data: { type: 'betaBuildLocalizations', attributes: { locale: 'de-DE', whatToTest: String(notes) }, relationships: { build: { data: { type: 'builds', id: build.id } } } } });
  console.log('Testhinweise gesetzt.');
}

const groups = await api('GET', `/v1/betaGroups?filter[app]=${appId}&filter[name]=${encodeURIComponent(groupName)}`);
const group = groups.data.find((g) => g.attributes.name === groupName);
if (!group) {
  console.warn(`TestFlight-Gruppe «${groupName}» nicht gefunden – Build nur hochgeladen.`);
  process.exit(0);
}
await api('POST', `/v1/builds/${build.id}/relationships/betaGroups`, { data: [{ type: 'betaGroups', id: group.id }] });
console.log(`Build ${buildNumber} an Gruppe «${groupName}» gehängt.`);
if (!group.attributes.isInternalGroup) {
  try {
    await api('POST', '/v1/betaAppReviewSubmissions', { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } } });
    console.log('Zur Beta-Prüfung eingereicht (externe Gruppe).');
  } catch (e) {
    console.log(`Beta-Prüfung: ${String(e).includes('409') ? 'bereits eingereicht oder nicht nötig' : e}`);
  }
}
console.log('Fertig.');
