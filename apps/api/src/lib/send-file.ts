import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Errors } from './errors.js';

export interface SendFileOptions {
  contentType: string;
  /** Setzt Content-Disposition: attachment */
  downloadName?: string;
  cacheSeconds?: number;
  etag?: string;
}

/** Streamt eine Datei mit Range-Unterstützung (Video-Scrubbing) und Cache-Headern. */
export async function sendFile(request: FastifyRequest, reply: FastifyReply, filePath: string, opts: SendFileOptions) {
  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile()) throw Errors.notFound('Die Datei ist (noch) nicht vorhanden.', 'FILE_MISSING');

  reply.header('accept-ranges', 'bytes');
  reply.header('content-type', opts.contentType);
  reply.header('cache-control', `private, max-age=${opts.cacheSeconds ?? 3600}`);
  if (opts.etag) {
    reply.header('etag', `"${opts.etag}"`);
    if (request.headers['if-none-match'] === `"${opts.etag}"`) {
      return reply.code(304).send();
    }
  }
  if (opts.downloadName) {
    const ascii = opts.downloadName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
    reply.header(
      'content-disposition',
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}`,
    );
  }

  const range = parseRange(request.headers.range, st.size);
  if (range === 'invalid') {
    reply.header('content-range', `bytes */${st.size}`);
    return reply.code(416).send();
  }
  if (range) {
    reply.code(206);
    reply.header('content-range', `bytes ${range.start}-${range.end}/${st.size}`);
    reply.header('content-length', range.end - range.start + 1);
    return reply.send(createReadStream(filePath, { start: range.start, end: range.end }));
  }

  reply.header('content-length', st.size);
  if (request.method === 'HEAD') return reply.send();
  return reply.send(createReadStream(filePath));
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid';
  const [, s, e] = m;
  if (s === '' && e === '') return 'invalid';
  let start: number;
  let end: number;
  if (s === '') {
    // Suffix: letzte N Bytes
    const n = Number(e);
    if (n === 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(s);
    end = e === '' ? size - 1 : Math.min(Number(e), size - 1);
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return 'invalid';
  return { start, end };
}
