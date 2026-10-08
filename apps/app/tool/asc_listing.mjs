// App-Store-Connect-Eintrag pflegen (Texte, Kategorie, Copyright, Inhaltsrechte, TestFlight-Infos, Screenshots, neuster Build).
// Preis (kostenlos, Basisregion CHE) wurde einmalig per API gesetzt; Datenschutz-Angaben und Altersfreigabe nur in der Console.
//   node tool/asc_listing.mjs                → Texte, Kategorie, Datenschutz-URL, TestFlight-Beschreibung setzen
//   node tool/asc_listing.mjs --screenshots  → zusätzlich Screenshots hochladen: store/ios/<locale>/<DISPLAY_TYPE>/*.png,
//                                              ohne Sprachordner gilt store/ios/<DISPLAY_TYPE>/ für alle Sprachen (de-DE, en-US)
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
const LOCALES = ['de-DE', 'en-US'];
const BUNDLE_ID = 'ch.familienalbum.familienalbum';

// ---------- Konfiguration (persönliche Werte in ios/asc.env, nicht im Git) ----------
const env = Object.fromEntries(
  readFileSync(resolve(app, 'ios/asc.env'), 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => l.split(/=(.*)/s).slice(0, 2).map((s) => s.trim())),
);
for (const k of ['ASC_SERVER_URL', 'ASC_CONTACT_FIRST', 'ASC_CONTACT_LAST', 'ASC_CONTACT_EMAIL', 'ASC_COPYRIGHT', 'ASC_DEMO_ACCOUNT']) {
  if (!env[k]) { console.error(`${k} in ios/asc.env setzen (siehe asc.env.example)`); process.exit(1); }
}
const SERVER = env.ASC_SERVER_URL.replace(/\/+$/, '');

const listing = {
  subtitle: 'Fotos nur für eure Familie',
  privacyPolicyUrl: `${SERVER}/datenschutz.html`,
  supportUrl: 'https://github.com/PenDraga/familienalbum/issues',
  marketingUrl: 'https://github.com/PenDraga/familienalbum',
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
    'Open Source: Familienalbum ist ein Client für den eigenen Server, vergleichbar mit Nextcloud oder Immich. Quellcode und Anleitung für den eigenen Server auf GitHub: https://github.com/PenDraga/familienalbum',
    '',
    'Wer einen Server betreibt, ist dessen Admin und lädt die Familie per Link ein. Es gibt bewusst keine öffentliche Registrierung. Beim ersten Start wird die Adresse des eigenen Servers eingetragen.',
  ].join('\n'),
  whatsNew: [
    'Zwei-Finger-Zoom im Foto-Viewer funktioniert wieder.',
    'Die Zahl auf dem App-Symbol zeigt nur noch ungelesene Einträge und verschwindet nach dem Öffnen des Verlaufs.',
    'Einladungs-Screen erklärt falsche Codes und verlinkt zur Anmeldung; Server-Adresse wird nicht mehr vorbelegt.',
    'Konto löschen für Admins, Speicherplatz-Anzeige, Open-Source-Hinweis.',
  ].join('\n'),
  copyright: env.ASC_COPYRIGHT,
  // Rückblick-Musik von Kevin MacLeod (CC BY 4.0) ist Drittinhalt mit Nutzungsrecht
  contentRightsDeclaration: 'USES_THIRD_PARTY_CONTENT',
  beta: {
    description: 'Privates, selbst gehostetes Familienalbum: Fotos, Videos, Kommentare und Rückblick-Videos. Zum Anmelden braucht ihr die Server-Adresse und einen Einladungslink vom Album-Admin.',
    feedbackEmail: env.ASC_CONTACT_EMAIL,
  },
  betaReviewNotes: [
    'HOW TO SIGN IN (please do not use the "Einladung" / invitation screen):',
    `1. Open the app. On the login screen enter the server address ${SERVER} in the field "Server" (first field).`,
    '2. Enter the demo account e-mail and password from this form, then tap "Anmelden".',
    '3. You land in the album "Demo" with sample photos, comments and settings.',
    'The invitation code screen ("Ich habe einen Einladungscode") is only for new users invited by a family admin; it is not needed for review.',
    'The app is an open-source client for a self-hosted family photo server (source and setup guide: https://github.com/PenDraga/familienalbum); anyone can run a server and becomes its admin. Only invited family members can join an album.',
  ].join('\n'),
};

/** Englische Fassung der sprachabhängigen Felder; alles andere kommt aus `listing`. */
const EN = {
  subtitle: 'Photos just for your family',
  keywords: 'family,album,photos,videos,private,self-hosted,comments,recap,kids,grandparents',
  promotionalText: 'A private family album on your own server: photos, videos, comments and recap videos. Access by invitation only.',
  description: [
    'Familienalbum is a private photo album for your own family. The app connects to a server that the family runs itself. No ads, no tracking, no third-party access.',
    '',
    '• Upload photos and videos, sorted by capture date',
    '• Comments and notifications for new pictures',
    '• Recap videos per month and year, a one-second film, "On this day"',
    '• Automatic background upload of new captures',
    '• Export of all photos and comments as a ZIP. Your data stays yours.',
    '• Albums with their own permissions: upload, download, comment',
    '',
    `Open source: Familienalbum is a client for your own server, comparable to Nextcloud or Immich. Source code and setup guide on GitHub: ${listing.marketingUrl}`,
    '',
    'Whoever runs a server is its admin and invites the family by link. There is deliberately no public sign-up. On first launch you enter the address of your own server.',
  ].join('\n'),
  whatsNew: [
    'The app now speaks English as well as German and follows your device language.',
    'Two-finger zoom in the photo viewer, unread badge on the app icon, clearer invitation screen.',
  ].join('\n'),
  betaDescription: 'Private, self-hosted family album: photos, videos, comments and recap videos. To sign in you need the server address and an invitation link from your album admin.',
};
const texts = (locale) => (locale === 'en-US'
  ? { subtitle: EN.subtitle, keywords: EN.keywords, promotionalText: EN.promotionalText, description: EN.description, whatsNew: EN.whatsNew, betaDescription: EN.betaDescription }
  : { subtitle: listing.subtitle, keywords: listing.keywords, promotionalText: listing.promotionalText, description: listing.description, whatsNew: listing.whatsNew, betaDescription: listing.beta.description });


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

// ---------- Version: Beschreibung, Keywords, Support ----------
let versions = await api('GET', `/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&include=appStoreVersionLocalizations&limit=3`);
let version = versions.data.find((v) => !['READY_FOR_SALE', 'REPLACED_WITH_NEW_VERSION', 'REMOVED_FROM_SALE'].includes(v.attributes.appStoreState));
const pubspecVersionEarly = /^version:\s*([\d.]+)\+/m.exec(readFileSync(resolve(app, 'pubspec.yaml'), 'utf8'))?.[1];
if (!version) {
  // Alles veröffentlicht → neue Version mit der Nummer aus der pubspec anlegen (Texte werden von der letzten übernommen)
  const created = await api('POST', '/v1/appStoreVersions', { data: { type: 'appStoreVersions', attributes: { platform: 'IOS', versionString: pubspecVersionEarly, releaseType: 'AFTER_APPROVAL' }, relationships: { app: { data: { type: 'apps', id: appId } } } } });
  console.log(`Neue App-Store-Version ${pubspecVersionEarly} angelegt`);
  versions = await api('GET', `/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&include=appStoreVersionLocalizations&limit=3`);
  version = versions.data.find((v) => v.id === created.data.id);
}
// Versionsnummer in App Store Connect an die pubspec angleichen (Build muss dieselbe Nummer tragen)
const pubspecVersion = /^version:\s*([\d.]+)\+/m.exec(readFileSync(resolve(app, 'pubspec.yaml'), 'utf8'))?.[1];
if (pubspecVersion && version.attributes.versionString !== pubspecVersion && version.attributes.appStoreState === 'PREPARE_FOR_SUBMISSION') {
  await patch('appStoreVersions', version.id, { versionString: pubspecVersion });
  version.attributes.versionString = pubspecVersion;
  console.log(`App-Store-Version heisst jetzt ${pubspecVersion}`);
}
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
const vlocs = {};
for (const LOCALE of LOCALES) {
  const t = texts(LOCALE);
  const vattrs = { description: t.description, keywords: t.keywords, promotionalText: t.promotionalText, supportUrl: listing.supportUrl, marketingUrl: listing.marketingUrl, whatsNew: t.whatsNew };
  let vloc = (versions.included ?? []).find((l) => l.type === 'appStoreVersionLocalizations' && l.attributes.locale === LOCALE && version.relationships.appStoreVersionLocalizations.data.some((d) => d.id === l.id));
  if (vloc) await patchVersionLoc(vloc.id, vattrs);
  else vloc = (await api('POST', '/v1/appStoreVersionLocalizations', { data: { type: 'appStoreVersionLocalizations', attributes: { locale: LOCALE, ...vattrs }, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } } })).data;
  vlocs[LOCALE] = vloc;
}
await patch('appStoreVersions', version.id, { copyright: listing.copyright });
await patch('apps', appId, { contentRightsDeclaration: listing.contentRightsDeclaration });
console.log(`Version ${version.attributes.versionString}: Beschreibung, Keywords, Support-URL, Copyright, Inhaltsrechte gesetzt (${LOCALES.join(', ')})`);

// ---------- App-Info: Untertitel, Datenschutz, Kategorie (erst nach der Versionsanlage, dann ist eine bearbeitbare Info da) ----------
const infos = await api('GET', `/v1/apps/${appId}/appInfos?include=appInfoLocalizations`);
const info = infos.data.find((i) => ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'WAITING_FOR_REVIEW'].includes(i.attributes.state)) ?? infos.data[0];
try {
  for (const LOCALE of LOCALES) {
    const infoLoc = (infos.included ?? []).find((l) => l.type === 'appInfoLocalizations' && l.attributes.locale === LOCALE && info.relationships.appInfoLocalizations.data.some((d) => d.id === l.id));
    const attrs = { subtitle: texts(LOCALE).subtitle, privacyPolicyUrl: listing.privacyPolicyUrl };
    if (infoLoc) await patch('appInfoLocalizations', infoLoc.id, attrs);
    else await api('POST', '/v1/appInfoLocalizations', { data: { type: 'appInfoLocalizations', attributes: { locale: LOCALE, ...attrs }, relationships: { appInfo: { data: { type: 'appInfos', id: info.id } } } } });
  }
  await patch('appInfos', info.id, undefined, { primaryCategory: { data: { type: 'appCategories', id: listing.primaryCategory } } });
  console.log('App-Info: Untertitel, Datenschutz-URL, Kategorie gesetzt');
} catch (e) {
  if (!String(e).includes('can not be modified')) throw e;
  console.log('App-Info: veröffentlicht, unverändert');
}

// ---------- Neuster verarbeiteter Build an die App-Store-Version hängen ----------
// Nur Builds mit derselben Versionsnummer wie die App-Store-Version kommen in Frage
const builds = await api('GET', `/v1/builds?filter[app]=${appId}&filter[preReleaseVersion.version]=${version.attributes.versionString}&sort=-uploadedDate&limit=5&fields[builds]=version,processingState,expired`);
const latest = builds.data.find((b) => b.attributes.processingState === 'VALID' && !b.attributes.expired);
const current = (await api('GET', `/v1/appStoreVersions/${version.id}/relationships/build`)).data?.id;
const editable = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'].includes(version.attributes.appStoreState);
if (latest && latest.id !== current && editable) {
  await api('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, { data: { type: 'builds', id: latest.id } });
  console.log(`Version ${version.attributes.versionString}: Build ${latest.attributes.version} angehängt`);
} else if (latest && latest.id !== current) {
  console.log(`Version ${version.attributes.versionString} ist ${version.attributes.appStoreState}: Build bleibt, neuster wäre ${latest.attributes.version}`);
} else if (!latest) {
  console.log(`Version ${version.attributes.versionString}: noch kein verarbeiteter Build mit dieser Nummer – später erneut ausführen`);
}

// ---------- App-Review-Informationen (Kontakt, Demo-Konto-Name, Notizen; Passwort bleibt, wie in ASC hinterlegt) ----------
const reviewAttrs = { contactFirstName: env.ASC_CONTACT_FIRST, contactLastName: env.ASC_CONTACT_LAST, contactEmail: env.ASC_CONTACT_EMAIL, demoAccountRequired: true, demoAccountName: env.ASC_DEMO_ACCOUNT, notes: listing.betaReviewNotes };
const detail = await api('GET', `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`).catch(() => null);
if (detail?.data) await patch('appStoreReviewDetails', detail.data.id, reviewAttrs);
else await api('POST', '/v1/appStoreReviewDetails', { data: { type: 'appStoreReviewDetails', attributes: reviewAttrs, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } } });
console.log('App-Review-Informationen gesetzt (Demo-Passwort nur in App Store Connect)');

// ---------- TestFlight: Beschreibung, Feedback, Review-Notizen ----------
const beta = await api('GET', `/v1/apps/${appId}/betaAppLocalizations`);
for (const LOCALE of LOCALES) {
  const bloc = beta.data.find((b) => b.attributes.locale === LOCALE);
  const battrs = { description: texts(LOCALE).betaDescription, feedbackEmail: listing.beta.feedbackEmail, privacyPolicyUrl: listing.privacyPolicyUrl };
  if (bloc) await patch('betaAppLocalizations', bloc.id, battrs);
  else await api('POST', '/v1/betaAppLocalizations', { data: { type: 'betaAppLocalizations', attributes: { locale: LOCALE, ...battrs }, relationships: { app: { data: { type: 'apps', id: appId } } } } });
}
const review = await api('GET', `/v1/apps/${appId}/betaAppReviewDetail`);
await patch('betaAppReviewDetails', review.data.id, { demoAccountRequired: true, notes: listing.betaReviewNotes });
console.log('TestFlight: Beschreibung, Feedback-Adresse, Review-Notizen gesetzt (Demo-Konto bitte in App Store Connect eintragen)');

// ---------- Screenshots ----------
for (const LOCALE of args.has('--screenshots') ? LOCALES : []) {
  const vloc = vlocs[LOCALE];
  const root = existsSync(resolve(app, 'store/ios', LOCALE)) ? resolve(app, 'store/ios', LOCALE) : resolve(app, 'store/ios');
  console.log(`Screenshots ${LOCALE} aus ${root.replace(app + '/', '')}`);
  const sets = await api('GET', `/v1/appStoreVersionLocalizations/${vloc.id}/appScreenshotSets?include=appScreenshots`);
  for (const dir of readdirSync(root).filter((d) => d.startsWith('APP_') && statSync(resolve(root, d)).isDirectory())) {
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
