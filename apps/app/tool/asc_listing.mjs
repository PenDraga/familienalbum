// App-Store-Connect-Eintrag pflegen (Texte, Kategorie, Copyright, Inhaltsrechte, TestFlight-Infos, Screenshots, neuster Build).
// Preis (kostenlos, Basisregion CHE) wurde einmalig per API gesetzt; Datenschutz-Angaben und Altersfreigabe nur in der Console.
//   node tool/asc_listing.mjs                → Texte, Kategorie, Datenschutz-URL, TestFlight-Beschreibung setzen
//   node tool/asc_listing.mjs --screenshots  → zusätzlich store/ios/<DISPLAY_TYPE>/*.png hochladen (ersetzt vorhandene)
// Braucht ios/asc.env (siehe ios/asc.env.example). Texte stehen unten in `listing`.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { SignJWT, importPKCS8 } = require('jose');
const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const args = new Set(process.argv.slice(2));
const LOCALE = 'de-DE';
const BUNDLE_ID = 'ch.familienalbum.familienalbum';
const SERVER = 'https://album.depaolis.digital';

const listing = {
  subtitle: 'Fotos nur für eure Familie',
  privacyPolicyUrl: `${SERVER}/datenschutz.html`,
  supportUrl: `${SERVER}/datenschutz.html`,
  primaryCategory: 'PHOTO_AND_VIDEO',
  keywords: 'Familie,Album,Fotos,Videos,privat,selbst gehostet,Kommentare,Rückblick,Kinder,Grosseltern',
  promotionalText: 'Privates Familienalbum auf eurem eigenen Server: Fotos, Videos, Kommentare und Rückblick-Videos. Zugang nur per Einladung.',
  description: [
    'Familienalbum ist ein privates Fotoalbum für die eigene Familie. Die App verbindet sich mit einem Server, den die Familie selbst betreibt. Ohne Werbung, ohne Tracking, ohne Fremdzugriff.',
    '',
    '• Fotos und Videos hochladen, chronologisch nach Aufnahmedatum',
    '• Kommentare und Mitteilungen bei neuen Bildern',
    '• Rückblick-Videos pro Monat und Jahr, Sekunden-Film, «An diesem Tag»',
    '• Automatischer Upload neuer Aufnahmen im Hintergrund',
    '• Export aller Fotos und Kommentare als ZIP. Eure Daten gehören euch.',
    '• Alben mit eigenen Rechten: Hochladen, Herunterladen, Kommentieren',
    '',
    'Der Zugang erfolgt ausschliesslich per Einladung durch die Familie. Beim ersten Start wird die Adresse des eigenen Familienalbum-Servers eingetragen.',
  ].join('\n'),
  whatsNew: 'Erste Version für den Familientest.',
  copyright: '2026 Philippe Ingold',
  // Rückblick-Musik von Kevin MacLeod (CC BY 4.0) ist Drittinhalt mit Nutzungsrecht
  contentRightsDeclaration: 'USES_THIRD_PARTY_CONTENT',
  beta: {
    description: 'Privates, selbst gehostetes Familienalbum: Fotos, Videos, Kommentare und Rückblick-Videos. Zum Anmelden braucht ihr die Server-Adresse und einen Einladungslink vom Album-Admin.',
    feedbackEmail: 'philippe@ingolds.ch',
  },
  betaReviewNotes: `Self-hosted app: on the first screen enter the server address ${SERVER}, then sign in with the demo account. The account is a view-only member of the album "Demo".`,
};

// ---------- API ----------
const env = Object.fromEntries(
  readFileSync(resolve(app, 'ios/asc.env'), 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => l.split(/=(.*)/s).slice(0, 2).map((s) => s.trim())),
);
const keyPath = (env.ASC_KEY_PATH || `~/.appstoreconnect/private_keys/AuthKey_${env.ASC_KEY_ID}.p8`).replace(/^~/, homedir());
const privateKey = await importPKCS8(readFileSync(keyPath, 'utf8'), 'ES256');
async function api(method, path, body) {
  const jwt = await new SignJWT({ aud: 'appstoreconnect-v1' }).setProtectedHeader({ alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' }).setIssuer(env.ASC_ISSUER_ID).setIssuedAt().setExpirationTime('15m').sign(privateKey);
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, { method, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}
const patch = (type, id, attributes, relationships) => api('PATCH', `/v1/${type}/${id}`, { data: { type, id, attributes, ...(relationships ? { relationships } : {}) } });

const appId = (await api('GET', `/v1/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0]?.id;
if (!appId) throw new Error('App nicht gefunden');

// ---------- App-Info: Untertitel, Datenschutz, Kategorie ----------
const infos = await api('GET', `/v1/apps/${appId}/appInfos?include=appInfoLocalizations`);
const info = infos.data.find((i) => ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'WAITING_FOR_REVIEW'].includes(i.attributes.state)) ?? infos.data[0];
const infoLoc = (infos.included ?? []).find((l) => l.type === 'appInfoLocalizations' && l.attributes.locale === LOCALE && infos.data.find((i) => i.id === info.id));
if (infoLoc) await patch('appInfoLocalizations', infoLoc.id, { subtitle: listing.subtitle, privacyPolicyUrl: listing.privacyPolicyUrl });
else await api('POST', '/v1/appInfoLocalizations', { data: { type: 'appInfoLocalizations', attributes: { locale: LOCALE, subtitle: listing.subtitle, privacyPolicyUrl: listing.privacyPolicyUrl }, relationships: { appInfo: { data: { type: 'appInfos', id: info.id } } } } });
await patch('appInfos', info.id, undefined, { primaryCategory: { data: { type: 'appCategories', id: listing.primaryCategory } } });
console.log('App-Info: Untertitel, Datenschutz-URL, Kategorie gesetzt');

// ---------- Version: Beschreibung, Keywords, Support ----------
const versions = await api('GET', `/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&include=appStoreVersionLocalizations&limit=3`);
const version = versions.data.find((v) => !['READY_FOR_SALE', 'REPLACED_WITH_NEW_VERSION', 'REMOVED_FROM_SALE'].includes(v.attributes.appStoreState)) ?? versions.data[0];
// Versionsnummer in App Store Connect an die pubspec angleichen (Build muss dieselbe Nummer tragen)
const pubspecVersion = /^version:\s*([\d.]+)\+/m.exec(readFileSync(resolve(app, 'pubspec.yaml'), 'utf8'))?.[1];
if (pubspecVersion && version.attributes.versionString !== pubspecVersion && version.attributes.appStoreState === 'PREPARE_FOR_SUBMISSION') {
  await patch('appStoreVersions', version.id, { versionString: pubspecVersion });
  version.attributes.versionString = pubspecVersion;
  console.log(`App-Store-Version heisst jetzt ${pubspecVersion}`);
}
let vloc = (versions.included ?? []).find((l) => l.type === 'appStoreVersionLocalizations' && l.attributes.locale === LOCALE);
const vattrs = { description: listing.description, keywords: listing.keywords, promotionalText: listing.promotionalText, supportUrl: listing.supportUrl, whatsNew: listing.whatsNew };
// «Neue Funktionen» gibt es erst ab der zweiten Version; bei 1.0 lehnt Apple das Feld ab
async function patchVersionLoc(id, attrs) {
  try {
    await patch('appStoreVersionLocalizations', id, attrs);
  } catch (e) {
    if (!String(e).includes("'whatsNew'")) throw e;
    const { whatsNew, ...rest } = attrs;
    await patch('appStoreVersionLocalizations', id, rest);
  }
}
if (vloc) await patchVersionLoc(vloc.id, vattrs);
else vloc = (await api('POST', '/v1/appStoreVersionLocalizations', { data: { type: 'appStoreVersionLocalizations', attributes: { locale: LOCALE, ...vattrs }, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } } })).data;
await patch('appStoreVersions', version.id, { copyright: listing.copyright });
await patch('apps', appId, { contentRightsDeclaration: listing.contentRightsDeclaration });
console.log(`Version ${version.attributes.versionString}: Beschreibung, Keywords, Support-URL, Copyright, Inhaltsrechte gesetzt`);

// ---------- Neuster verarbeiteter Build an die App-Store-Version hängen ----------
const builds = await api('GET', `/v1/builds?filter[app]=${appId}&sort=-uploadedDate&limit=5&fields[builds]=version,processingState,expired`);
const latest = builds.data.find((b) => b.attributes.processingState === 'VALID' && !b.attributes.expired);
const current = (await api('GET', `/v1/appStoreVersions/${version.id}/relationships/build`)).data?.id;
const editable = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'].includes(version.attributes.appStoreState);
if (latest && latest.id !== current && editable) {
  await api('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, { data: { type: 'builds', id: latest.id } });
  console.log(`Version ${version.attributes.versionString}: Build ${latest.attributes.version} angehängt`);
} else if (latest && latest.id !== current) {
  console.log(`Version ${version.attributes.versionString} ist ${version.attributes.appStoreState}: Build bleibt, neuster wäre ${latest.attributes.version}`);
}

// ---------- TestFlight: Beschreibung, Feedback, Review-Notizen ----------
const beta = await api('GET', `/v1/apps/${appId}/betaAppLocalizations`);
const bloc = beta.data.find((b) => b.attributes.locale === LOCALE);
const battrs = { description: listing.beta.description, feedbackEmail: listing.beta.feedbackEmail, privacyPolicyUrl: listing.privacyPolicyUrl };
if (bloc) await patch('betaAppLocalizations', bloc.id, battrs);
else await api('POST', '/v1/betaAppLocalizations', { data: { type: 'betaAppLocalizations', attributes: { locale: LOCALE, ...battrs }, relationships: { app: { data: { type: 'apps', id: appId } } } } });
const review = await api('GET', `/v1/apps/${appId}/betaAppReviewDetail`);
await patch('betaAppReviewDetails', review.data.id, { demoAccountRequired: true, notes: listing.betaReviewNotes });
console.log('TestFlight: Beschreibung, Feedback-Adresse, Review-Notizen gesetzt (Demo-Konto bitte in App Store Connect eintragen)');

// ---------- Screenshots ----------
if (args.has('--screenshots')) {
  const root = resolve(app, 'store/ios');
  const sets = await api('GET', `/v1/appStoreVersionLocalizations/${vloc.id}/appScreenshotSets?include=appScreenshots`);
  for (const dir of readdirSync(root).filter((d) => statSync(resolve(root, d)).isDirectory())) {
    const files = readdirSync(resolve(root, dir)).filter((f) => f.endsWith('.png')).sort();
    if (!files.length) continue;
    let set = sets.data.find((s) => s.attributes.screenshotDisplayType === dir);
    if (!set) set = (await api('POST', '/v1/appScreenshotSets', { data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: dir }, relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: vloc.id } } } } })).data;
    for (const old of set.relationships?.appScreenshots?.data ?? []) await api('DELETE', `/v1/appScreenshots/${old.id}`);
    const ids = [];
    for (const f of files) {
      const buf = readFileSync(resolve(root, dir, f));
      const reserved = (await api('POST', '/v1/appScreenshots', { data: { type: 'appScreenshots', attributes: { fileName: f, fileSize: buf.length }, relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } } } })).data;
      for (const op of reserved.attributes.uploadOperations) {
        const headers = Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value]));
        const res = await fetch(op.url, { method: op.method, headers, body: buf.subarray(op.offset, op.offset + op.length) });
        if (!res.ok) throw new Error(`Upload ${f}: ${res.status}`);
      }
      await patch('appScreenshots', reserved.id, { uploaded: true, sourceFileChecksum: createHash('md5').update(buf).digest('hex') });
      ids.push(reserved.id);
      console.log(`${dir}: ${f}`);
    }
    await api('PATCH', `/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, { data: ids.map((id) => ({ type: 'appScreenshots', id })) });
  }
}
console.log('App-Store-Eintrag gespeichert.');
