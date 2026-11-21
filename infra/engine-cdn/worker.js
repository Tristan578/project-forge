// engine-cdn Cloudflare Worker — serves the SpawnForge WASM engine from the
// `spawnforge-engine` R2 bucket at https://engine.spawnforge.ai/*.
//
// This file is a from-SOURCE reconstruction of the manually-deployed worker,
// authored to match the behavior DOCUMENTED in
// .claude/skills/infra-services/references/runbook.md (ACAO `*`), SKILL.md, and
// web/next.config.ts (COEP `require-corp` / COOP `same-origin`). Before any
// `wrangler deploy` from this source, diff it against the live worker
// (`wrangler deployments list --name engine-cdn` / Cloudflare dashboard worker
// code) so a redeploy does not silently change production behavior.
//
// SECURITY INVARIANTS (asserted by worker.test.mjs — do not weaken):
//   * GET/HEAD only. Every write/mutating method (PUT/POST/DELETE/PATCH) → 405.
//   * No bucket listing. A bare `/` or a directory-style path → 404; the worker
//     NEVER calls `env.ENGINE_BUCKET.list()`.
//   * Bind ONLY `spawnforge-engine`. `spawnforge-assets` is signed-URL/
//     server-side only and must never be reachable through this public edge.
//
// The consuming editor page is cross-origin-isolated (COEP require-corp + COOP
// same-origin, see web/next.config.ts), so every served object MUST carry
// `Cross-Origin-Resource-Policy: cross-origin` AND pass CORS, or the isolated
// page refuses to instantiate the WASM and SharedArrayBuffer breaks. Omitting
// CORP is the most likely subtle break: the binary 200s but won't load.

const ALLOWED_METHODS = 'GET, HEAD';
const CORS_METHODS = 'GET, HEAD, OPTIONS';

/**
 * Normalize a request URL pathname to an R2 object key.
 *
 * Returns `null` for anything that must NOT map to a single object — a bare
 * root, an empty path, a directory-style trailing-slash request, or a path that
 * tries to traverse (`..`). Callers treat `null` as 404 so the worker never
 * enumerates the bucket.
 *
 * @param {string} pathname URL pathname, e.g. "/abc123/engine-pkg-webgpu/forge_engine_bg.wasm"
 * @returns {string | null} the R2 key, or null if the path is not a fetchable object
 */
export function pathToKey(pathname) {
  if (typeof pathname !== 'string' || pathname.length === 0) return null;
  // Strip exactly one leading slash to form the key.
  const key = pathname.replace(/^\/+/, '');
  // Empty (bare "/") or directory-style ("foo/") → no object, never a listing.
  if (key.length === 0) return null;
  if (key.endsWith('/')) return null;
  // Reject path traversal in any segment.
  const segments = key.split('/');
  if (segments.some((seg) => seg === '..' || seg === '.')) return null;
  return key;
}

/**
 * Build the response headers for a successfully-fetched object.
 *
 * @param {string} key the R2 object key (used for the *.wasm content-type branch)
 * @param {{ contentType?: string } | undefined} httpMetadata R2 object httpMetadata
 * @returns {Headers}
 */
export function buildObjectHeaders(key, httpMetadata) {
  const headers = new Headers();

  const isWasm = typeof key === 'string' && key.endsWith('.wasm');
  const contentType = isWasm
    ? 'application/wasm'
    : (httpMetadata && httpMetadata.contentType) || 'application/octet-stream';
  headers.set('Content-Type', contentType);

  // CORS — public, immutable, no credentials, so `*` is appropriate.
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', CORS_METHODS);

  // Cross-origin isolation: the consuming page is COEP require-corp / COOP
  // same-origin, so the embedded resource must be CORP cross-origin and echo the
  // isolation headers.
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');

  // Immutable, content-addressed assets (keyed by sha or pinned version).
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return headers;
}

/**
 * Build a CORS preflight (OPTIONS) response.
 * @returns {Response}
 */
export function preflightResponse() {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', CORS_METHODS);
  headers.set('Access-Control-Allow-Headers', '*');
  headers.set('Access-Control-Max-Age', '86400');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return new Response(null, { status: 204, headers });
}

/**
 * Build a 405 Method Not Allowed response. Carries `Allow: GET, HEAD` and never
 * touches the bucket.
 * @returns {Response}
 */
export function methodNotAllowedResponse() {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: {
      Allow: ALLOWED_METHODS,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': CORS_METHODS,
    },
  });
}

/**
 * Build a 404 Not Found response.
 * @returns {Response}
 */
export function notFoundResponse() {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': CORS_METHODS,
    },
  });
}

export default {
  /**
   * @param {Request} request
   * @param {{ ENGINE_BUCKET: { get(key: string): Promise<any> } }} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const method = request.method;

    if (method === 'OPTIONS') {
      return preflightResponse();
    }

    // GET/HEAD only. Writes (PUT/POST/DELETE/PATCH) and any LIST attempt are
    // refused at the method gate — they never reach the bucket.
    if (method !== 'GET' && method !== 'HEAD') {
      return methodNotAllowedResponse();
    }

    const url = new URL(request.url);
    const key = pathToKey(url.pathname);
    if (key === null) {
      // Bare root / directory / traversal → 404. NO bucket listing.
      return notFoundResponse();
    }

    const object = await env.ENGINE_BUCKET.get(key);
    if (object === null || object === undefined) {
      return notFoundResponse();
    }

    const headers = buildObjectHeaders(key, object.httpMetadata);
    // Propagate the R2 etag when present (helps conditional caching).
    if (object.httpEtag) {
      headers.set('ETag', object.httpEtag);
    }

    // HEAD: headers only, no body.
    const body = method === 'HEAD' ? null : object.body;
    return new Response(body, { status: 200, headers });
  },
};
