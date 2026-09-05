// Dev-Werkzeug: Datei(en) per Chunk-Upload in eine Familie laden.
//   npx tsx scripts/upload-file.ts <familyId> <datei> [<datei> …]
// Anmeldung mit ADMIN_EMAIL/ADMIN_PASSWORD aus der .env (oder UPLOAD_EMAIL/UPLOAD_PASSWORD), API_URL (Standard http://localhost:3000).
import { createHash } from 'node:crypto';
import { openAsBlob, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

try {
  process.loadEnvFile();
} catch {
  /* keine .env */
}

const API = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '') + '/api/v1';
const email = process.env.UPLOAD_EMAIL ?? process.env.ADMIN_EMAIL;
const password = process.env.UPLOAD_PASSWORD ?? process.env.ADMIN_PASSWORD;
const [familyId, ...files] = process.argv.slice(2);

if (!familyId || files.length === 0 || !email || !password) {
  console.error('Aufruf: tsx scripts/upload-file.ts <familyId> <datei> [...]  (ADMIN_EMAIL/ADMIN_PASSWORD in .env)');
  process.exit(1);
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
};

async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${res.status} ${body?.code ?? ''}: ${body?.detail ?? text}`);
  return body as T;
}

const login = await api<{ tokens: { accessToken: string } }>('/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const token = login.tokens.accessToken;

for (const file of files) {
  const buf = await readFile(file);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const mimeType = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const takenAt = statSync(file).mtime.toISOString();

  let session: { id: string; chunkSize: number; totalChunks: number; receivedChunks: number[] };
  try {
    session = await api(`/families/${familyId}/uploads`, {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sha256, sizeBytes: buf.length, originalName: basename(file), mimeType, takenAt }),
    });
  } catch (err) {
    console.log(`${basename(file)}: ${(err as Error).message}`);
    continue;
  }

  for (let i = 0; i < session.totalChunks; i++) {
    if (session.receivedChunks.includes(i)) continue;
    const chunk = buf.subarray(i * session.chunkSize, (i + 1) * session.chunkSize);
    await api(`/uploads/${session.id}/chunks/${i}`, {
      method: 'PUT',
      token,
      headers: { 'content-type': 'application/octet-stream' },
      body: new Blob([chunk]),
    });
    process.stdout.write(`\r${basename(file)}: Chunk ${i + 1}/${session.totalChunks}`);
  }
  const media = await api<{ id: string; status: string }>(`/uploads/${session.id}/complete`, { method: 'POST', token });
  console.log(`\r${basename(file)}: ${media.id} (${media.status})`);
}

void openAsBlob;
