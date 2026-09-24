/**
 * Loopback static server for the exported-fixture performance capture
 * (#10013). Serves one generated exported-game page plus the runtime engine
 * packages from `web/public/engine-pkg-*-runtime/`, with the headers the
 * production CDN sends for engine binaries (long-lived immutable cache,
 * `application/wasm`), so a fresh browser context is a genuinely cold run and
 * a reload in the same context is a genuinely warm one.
 *
 * Deliberate environment delta from production (stated in every run's
 * `run-environment.json`): loopback instead of a CDN round trip, and the
 * uncompressed binary instead of brotli transfer encoding.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.html': 'text/html; charset=utf-8',
};

/** The stripped runtime engine packages exported games load first. */
export const RUNTIME_PACKAGES = ['engine-pkg-webgpu-runtime', 'engine-pkg-webgl2-runtime'] as const;

/**
 * The editor engine packages: what `/play` loads for published games, and what
 * the export template falls back to when a runtime package is absent.
 */
export const EDITOR_PACKAGES = ['engine-pkg-webgpu', 'engine-pkg-webgl2'] as const;

export interface PerfCaptureServer {
  origin: string;
  /** Replace the page served at `/index.html`. */
  setPage(html: string): void;
  close(): Promise<void>;
}

/**
 * Start the server on an ephemeral loopback port.
 * @param publicDir Absolute path to `web/public`.
 * @param packages Engine package directories to serve; anything else is a 404,
 *   which is how a run is steered onto the export template's fallback package.
 * @returns The running server.
 */
export async function startPerfCaptureServer(publicDir: string, packages: readonly string[]): Promise<PerfCaptureServer> {
  let page = '<!doctype html><title>no page</title>';
  const server = http.createServer((req, res) => {
    void (async () => {
      let url: string;
      try {
        url = decodeURIComponent((req.url ?? '/').split('?')[0]);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      if (url === '/' || url === '/index.html') {
        const body = Buffer.from(page, 'utf8');
        res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'], 'Content-Length': body.length, 'Cache-Control': 'no-store' });
        res.end(body);
        return;
      }
      const [, pkg, ...rest] = url.split('/');
      if (!packages.includes(pkg) || rest.length !== 1 || rest[0].includes('..')) {
        res.writeHead(404);
        res.end();
        return;
      }
      const file = path.join(publicDir, pkg, rest[0]);
      try {
        const info = await stat(file);
        const body = await readFile(file);
        res.writeHead(200, {
          'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
          'Content-Length': info.size,
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end();
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('perf capture server has no port');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    setPage: (html) => {
      page = html;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
