// Kleiner statischer Server für build/web (Release-Build) mit SPA-Fallback auf index.html.
// Aufruf: node tool/serve_web.mjs [port] [host]   – Standard 8080 auf 0.0.0.0 (im WLAN erreichbar)
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../build/web');
const port = Number(process.argv[2] ?? 8080);
const host = process.argv[3] ?? '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain',
};

if (!existsSync(join(root, 'index.html'))) {
  console.error(`Kein Build gefunden: ${root} – zuerst "flutter build web --release" ausführen.`);
  process.exit(1);
}

createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(root, urlPath));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html'); // SPA-Fallback
  const ext = extname(file).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // Kein Caching, damit neue Builds sofort ankommen
    'cache-control': ext === '.html' ? 'no-store' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}).listen(port, host, () => console.log(`Familienalbum Web (Release) auf http://${host}:${port}`));
