// Rendert assets/branding/logo.svg zu den PNGs für App-Icon, Splash und In-App-Logo.
// Aufruf aus apps/app:  node tool/render_branding.mjs   (nutzt sharp aus dem Monorepo-node_modules)
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '../../../node_modules/'));
const sharp = require('sharp');

const out = resolve(here, '../assets/branding');
mkdirSync(out, { recursive: true });
const svg = readFileSync(resolve(out, 'logo.svg'), 'utf8');
const withoutBackground = svg.replace(/<g id="background">[\s\S]*?<\/g>/, '');

const render = async (source, size, file, opts = {}) => {
  const buf = await sharp(Buffer.from(source), { density: 300 }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const final = opts.pad
    ? await sharp({ create: { width: opts.pad, height: opts.pad, channels: 4, background: opts.background ?? { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: buf, gravity: 'centre' }])
        .png()
        .toBuffer()
    : buf;
  writeFileSync(resolve(out, file), final);
  console.log(`${file}  ${opts.pad ?? size}px`);
};

await render(svg, 1024, 'icon.png');
// Android adaptive: Vordergrund auf 66 % der Fläche (Safe Zone)
await render(withoutBackground, 680, 'icon_foreground.png', { pad: 1024 });
await render(withoutBackground, 400, 'splash.png', { pad: 640 });
