// Rahmt rohe Simulator-Screenshots für die Stores: Überschrift in Baloo 2, Gerät mit runden Ecken, Kinderbuch-Farben.
//   node tool/frame_screenshots.mjs --lang=de --in=<ordner mit s1_timeline.png …> [--ios] [--play]
// Erwartete Rohdateien: s1_timeline, s5_detail, s2_comments, s3_recap, s4_settings (PNG, Hochformat).
// Ausgabe: store/ios/<de-DE|en-US>/APP_IPHONE_67 und _65 (--ios), store/screenshots/<de-DE|en-US>/ 1080×1920 (--play).
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => (a.includes('=') ? a.replace(/^--/, '').split(/=(.*)/s).slice(0, 2) : [a.replace(/^--/, ''), true])));
const lang = args.lang ?? 'de';
const input = resolve(args.in ?? '.');
const FONT = resolve(app, 'assets/fonts/Baloo2-ExtraBold.ttf');
const locale = lang === 'en' ? 'en-US' : 'de-DE';

const CAPTIONS = {
  de: [
    ['s1_timeline', '01-timeline', 'Alle Fotos der Familie,', 'nach Monat sortiert'],
    ['s5_detail', '02-foto', 'Fotos und Videos', 'in voller Grösse'],
    ['s2_comments', '03-kommentare', 'Kommentare von Oma,', 'Onkel und allen'],
    ['s3_recap', '04-rueckblick', 'Monats-Rückblick', 'als Video, automatisch'],
    ['s4_settings', '05-einstellungen', 'Rechte, Einladungen', 'und Auto-Upload'],
  ],
  en: [
    ['s1_timeline', '01-timeline', 'All family photos,', 'sorted by month'],
    ['s5_detail', '02-photo', 'Photos and videos', 'in full size'],
    ['s2_comments', '03-comments', 'Comments from grandma,', 'uncle and everyone'],
    ['s3_recap', '04-recap', 'Monthly recap', 'as a video, automatically'],
    ['s4_settings', '05-settings', 'Permissions, invitations', 'and auto-upload'],
  ],
}[lang];
if (!CAPTIONS) throw new Error('--lang=de|en');

async function frame(src, W, H, l1, l2, out) {
  const shotH = Math.round(H * 0.81), radius = Math.round(W * 0.052), fontPx = Math.round(W * 0.065);
  const meta = await sharp(src).metadata();
  const shotW = Math.round(meta.width * shotH / meta.height);
  const mask = Buffer.from(`<svg width="${shotW}" height="${shotH}"><rect width="${shotW}" height="${shotH}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`);
  const shot = await sharp(src).resize(shotW, shotH).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const x = Math.round((W - shotW) / 2), y = H - shotH - Math.round(H * 0.02);
  const headline = await sharp({ text: { text: `<span foreground="#2E2A3A">${l1}</span>\n<span foreground="#FF7A59">${l2}</span>`, font: `Baloo 2 ExtraBold ${fontPx}`, fontfile: FONT, rgba: true, dpi: 72, align: 'centre', spacing: 6 } }).png().toBuffer();
  const hm = await sharp(headline).metadata();
  const svg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="24"/></filter></defs>
    <rect width="${W}" height="${H}" fill="#FFF8E7"/>
    <circle cx="${W * 0.08}" cy="${H * 0.07}" r="${W * 0.11}" fill="#FFC93C" opacity="0.35"/>
    <circle cx="${W * 0.94}" cy="${H * 0.135}" r="${W * 0.085}" fill="#2BB3A3" opacity="0.3"/>
    <rect x="${x + 6}" y="${y + 20}" width="${shotW}" height="${shotH}" rx="${radius}" fill="#2E2A3A" opacity="0.28" filter="url(#sh)"/>
  </svg>`);
  await sharp(svg).composite([{ input: headline, left: Math.round((W - hm.width) / 2), top: Math.round((y - hm.height) / 2) }, { input: shot, left: x, top: y }]).png().toFile(out);
}

const targets = [];
if (args.ios) targets.push(['store/ios/' + locale + '/APP_IPHONE_67', 1290, 2796], ['store/ios/' + locale + '/APP_IPHONE_65', 1242, 2688]);
if (args.play) targets.push(['store/screenshots/' + locale, 1080, 1920]);
if (!targets.length) throw new Error('--ios und/oder --play angeben');
for (const [dir, W, H] of targets) {
  mkdirSync(resolve(app, dir), { recursive: true });
  for (const [src, name, l1, l2] of CAPTIONS) {
    const file = resolve(input, src + '.png');
    if (!existsSync(file)) { console.warn(`fehlt: ${file}`); continue; }
    await frame(file, W, H, l1, l2, resolve(app, dir, name + '.png'));
  }
  console.log(`${dir}: ${W}×${H}`);
}
