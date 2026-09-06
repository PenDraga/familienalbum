import type { PrismaClient } from '@prisma/client';
import archiver, { type Archiver } from 'archiver';
import { MIME_EXTENSIONS, type MediaStorage } from '../lib/storage.js';
import { Errors } from '../lib/errors.js';
import { iso } from './dto.js';

/** `alle` oder ein Monat `YYYY-MM` */
export const EXPORT_SCOPE_ALL = 'alle';
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function parseExportScope(scope: string): { month: string | null; start?: Date; end?: Date } {
  if (scope === EXPORT_SCOPE_ALL) return { month: null };
  const m = MONTH_RE.exec(scope);
  if (!m) throw Errors.badRequest('Zeitraum muss "alle" oder ein Monat wie 2026-09 sein.', 'EXPORT_SCOPE_INVALID');
  const [y, mo] = [Number(m[1]), Number(m[2])];
  if (mo < 1 || mo > 12) throw Errors.badRequest('Ungültiger Monat.', 'EXPORT_SCOPE_INVALID');
  return { month: scope, start: new Date(Date.UTC(y, mo - 1, 1)), end: new Date(Date.UTC(y, mo, 1)) };
}

export interface ExportResult {
  filename: string;
  archive: Archiver;
  /** Anzahl exportierter Medien (bekannt, bevor gestreamt wird) */
  count: number;
}

/**
 * Export als ZIP-Stream: Originale nach `JJJJ/MM/` mit Aufnahmezeit im Dateinamen, dazu `index.json`
 * (alle Metadaten und Kommentare, maschinenlesbar) und `kommentare.md` (zum Lesen). Ohne Kompression –
 * Fotos und Videos sind bereits komprimiert, so bleibt der Server-Aufwand beim reinen Durchreichen.
 *
 * Genau das, was uns bei der Migration aus FamilyAlbum gefehlt hat: alles, jederzeit, in einem Rutsch.
 */
export class ExportService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: MediaStorage,
  ) {}

  async build(familyId: string, scope: string): Promise<ExportResult> {
    const { month, start, end } = parseExportScope(scope);
    const family = await this.prisma.family.findUnique({ where: { id: familyId }, select: { name: true } });
    if (!family) throw Errors.notFound('Familie nicht gefunden.', 'FAMILY_NOT_FOUND');

    const media = await this.prisma.media.findMany({
      where: {
        familyId,
        deletedAt: null,
        status: 'READY',
        ...(start && end ? { takenAt: { gte: start, lt: end } } : {}),
      },
      orderBy: [{ takenAt: 'asc' }, { uploadedAt: 'asc' }],
      include: {
        uploader: { select: { id: true, displayName: true } },
        comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, displayName: true } } } },
      },
    });

    const archive = archiver('zip', { zlib: { level: 0 }, store: true });
    const usedNames = new Set<string>();
    const index: object[] = [];
    const commentLines: string[] = [`# Kommentare – ${family.name}`, month ? `Monat ${month}` : 'Alle Medien', ''];

    for (const m of media) {
      const ext = MIME_EXTENSIONS[m.mimeType]?.ext ?? 'bin';
      const entryName = uniqueName(usedNames, entryPath(m.takenAt, m.originalName, ext));
      archive.file(this.storage.originalPath(m.familyId, m.id, ext), { name: entryName, date: m.takenAt });

      index.push({
        id: m.id,
        file: entryName,
        type: m.type,
        originalName: m.originalName,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        sha256: m.sha256,
        width: m.width,
        height: m.height,
        durationSec: m.durationSec,
        takenAt: iso(m.takenAt),
        uploadedAt: iso(m.uploadedAt),
        uploader: m.uploader,
        caption: m.caption,
        exif: m.exif ?? null,
        comments: m.comments.map((c) => ({
          id: c.id,
          author: c.author,
          body: c.body,
          createdAt: iso(c.createdAt),
          editedAt: c.editedAt ? iso(c.editedAt) : null,
        })),
      });

      if (m.comments.length > 0 || m.caption) {
        commentLines.push(`## ${entryName}`);
        if (m.caption) commentLines.push(`_${m.caption}_`, '');
        for (const c of m.comments) {
          const when = c.createdAt.toISOString().slice(0, 16).replace('T', ' ');
          commentLines.push(`- **${c.author.displayName}** (${when}${c.editedAt ? ', bearbeitet' : ''}): ${c.body}`);
        }
        commentLines.push('');
      }
    }

    const meta = {
      app: 'Familienalbum',
      format: 1,
      family: family.name,
      scope: month ?? EXPORT_SCOPE_ALL,
      exportedAt: new Date().toISOString(),
      count: media.length,
      media: index,
    };
    archive.append(JSON.stringify(meta, null, 2), { name: 'index.json' });
    archive.append(commentLines.join('\n'), { name: 'kommentare.md' });
    archive.append(readme(family.name), { name: 'LIESMICH.txt' });

    const safeFamily = family.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'Familie';
    return { filename: `Familienalbum-${safeFamily}-${month ?? EXPORT_SCOPE_ALL}.zip`, archive, count: media.length };
  }
}

/** `2026/09/2026-09-03_195012_IMG_0042.jpg` – sortiert sich chronologisch, Originalname bleibt erkennbar. */
function entryPath(takenAt: Date, originalName: string, ext: string): string {
  const d = takenAt.toISOString(); // 2026-09-03T19:50:12.000Z
  const stamp = `${d.slice(0, 10)}_${d.slice(11, 13)}${d.slice(14, 16)}${d.slice(17, 19)}`;
  const base = originalName.replace(/[\\/:*?"<>|]/g, '_').replace(/\.[^.]+$/, '') || 'medium';
  return `${d.slice(0, 4)}/${d.slice(5, 7)}/${stamp}_${base}.${ext}`;
}

function uniqueName(used: Set<string>, name: string): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  for (let i = 2; ; i++) {
    const candidate = `${name.slice(0, dot)}_${i}${name.slice(dot)}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

function readme(familyName: string): string {
  return [
    `Familienalbum – Export von «${familyName}»`,
    '',
    'Ordner JJJJ/MM/ enthalten die Originaldateien, benannt nach Aufnahmezeit und ursprünglichem Dateinamen.',
    'index.json enthält alle Metadaten (Aufnahmedatum, Uploader, Beschreibung, Kamera-Daten) und Kommentare',
    'maschinenlesbar; kommentare.md dieselben Kommentare zum Lesen.',
    '',
    'Die Aufnahmezeit in Dateinamen und index.json ist in UTC angegeben.',
    '',
  ].join('\n');
}
