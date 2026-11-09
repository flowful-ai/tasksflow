import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import type { Context } from 'hono';
import { SPA_CSP } from './security-headers.js';

/** Paths the SPA fallback never answers. */
const EXCLUDED_PREFIXES = ['/api', '/.well-known', '/health', '/ready'];

const IMMUTABLE = 'public, max-age=31536000, immutable';
const SHORT = 'public, max-age=3600';
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml|manifest\+json)|image\/svg\+xml)/;
const MIN_GZIP_BYTES = 1024;

export function isSpaPath(path: string): boolean {
  return !EXCLUDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Directory holding the built SPA (index.html + assets/): WEB_DIST_DIR, else
 * apps/web/dist next to the API source (dev), else ./public next to the bundle
 * (Docker image). Null when none of them has an index.html.
 */
export function resolveWebDistDir(
  env: Record<string, string | undefined> = process.env
): string | null {
  const candidates = [
    env.WEB_DIST_DIR,
    join(import.meta.dir, '../../../web/dist'),
    join(import.meta.dir, 'public'),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, 'index.html'))) return resolve(candidate);
  }
  return null;
}

type CachedGzip = { mtimeMs: number; body: Uint8Array<ArrayBuffer> };

/**
 * Serves files from the built SPA with long-lived caching for hashed assets,
 * `no-cache` for index.html, and falls back to index.html for client-side
 * routes (paths without a file extension).
 */
export class SpaServer {
  private readonly gzipCache = new Map<string, CachedGzip>();

  constructor(readonly distDir: string) {}

  /** Response for a GET/HEAD on `path`, or null when the SPA should not answer. */
  async respond(c: Context, path: string): Promise<Response | null> {
    if (!isSpaPath(path)) return null;

    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return null;
    }
    const filePath = resolve(this.distDir, `.${decoded}`);
    const insideDist = filePath === this.distDir || filePath.startsWith(this.distDir + sep);
    if (!insideDist) return null;

    if (decoded !== '/' && decoded !== '/index.html' && this.isFile(filePath)) {
      const cacheControl = decoded.startsWith('/assets/') ? IMMUTABLE : SHORT;
      return this.serveFile(c, filePath, cacheControl);
    }
    // Unknown asset-like paths are 404s, not index.html (which would be served as JS/CSS).
    if (extname(decoded) !== '' && extname(decoded) !== '.html') return null;
    return this.serveIndex(c);
  }

  serveIndex(c: Context): Promise<Response> {
    return this.serveFile(c, join(this.distDir, 'index.html'), 'no-cache', SPA_CSP);
  }

  private isFile(filePath: string): boolean {
    return statSync(filePath, { throwIfNoEntry: false })?.isFile() ?? false;
  }

  private async serveFile(
    c: Context,
    filePath: string,
    cacheControl: string,
    csp?: string
  ): Promise<Response> {
    const file = Bun.file(filePath);
    const headers = new Headers({
      'Content-Type': file.type,
      'Cache-Control': cacheControl,
      Vary: 'Accept-Encoding',
    });
    if (csp) headers.set('Content-Security-Policy', csp);

    const acceptsGzip = /\bgzip\b/.test(c.req.header('accept-encoding') ?? '');
    if (acceptsGzip && COMPRESSIBLE.test(file.type) && file.size >= MIN_GZIP_BYTES) {
      headers.set('Content-Encoding', 'gzip');
      return new Response(await this.gzipped(filePath, file), { headers });
    }
    return new Response(file, { headers });
  }

  private async gzipped(
    filePath: string,
    file: ReturnType<typeof Bun.file>
  ): Promise<Uint8Array<ArrayBuffer>> {
    const mtimeMs = file.lastModified;
    const cached = this.gzipCache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) return cached.body;
    const body = Bun.gzipSync(new Uint8Array(await file.arrayBuffer()));
    this.gzipCache.set(filePath, { mtimeMs, body });
    return body;
  }
}
