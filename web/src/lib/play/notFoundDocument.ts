/** Static, script-free missing-game document returned before a play render streams. */
import { NextResponse } from 'next/server';

/** Visible heading shared with the colocated React not-found boundary. */
export const GAME_NOT_FOUND_HEADING = 'Game Not Found';
/** Description shared with the colocated React not-found boundary. */
export const GAME_NOT_FOUND_DESCRIPTION = 'This game may have been removed or is not published yet.';
/** Document title for an unavailable published game. */
export const GAME_NOT_FOUND_PAGE_TITLE = 'Game Not Found - SpawnForge';

// All interpolated values are trusted module constants, never route or database input.
const documentHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${GAME_NOT_FOUND_PAGE_TITLE}</title><style>html{color-scheme:dark}body{margin:0;background:#09090b;color:#e4e4e7;font:14px system-ui,sans-serif}main{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:0 16px;box-sizing:border-box}.message{max-width:448px;text-align:center}.face{font-size:60px;margin-bottom:16px}h1{font-size:20px;margin:0 0 8px}p{color:#a1a1aa;margin:0 0 24px}a{display:inline-flex;align-items:center;gap:8px;min-height:44px;box-sizing:border-box;border-radius:4px;padding:8px 16px;background:#27272a;color:#d4d4d8;text-decoration:none}a:hover{background:#3f3f46}a:focus-visible{outline:2px solid #fb923c;outline-offset:3px}</style></head><body><main><div class="message" role="alert"><div class="face" aria-hidden="true">:(</div><h1>${GAME_NOT_FOUND_HEADING}</h1><p>${GAME_NOT_FOUND_DESCRIPTION}</p><a href="/"><span aria-hidden="true">←</span>Back to SpawnForge</a></div></main></body></html>`;

// Replace only trusted constants; transient errors never enter the HTML document.
const unavailableHtml = documentHtml
  .replace('<meta name="robots" content="noindex">', '')
  .replace(GAME_NOT_FOUND_PAGE_TITLE, 'Game Temporarily Unavailable - SpawnForge')
  .replace(GAME_NOT_FOUND_HEADING, 'Game Temporarily Unavailable')
  .replace(GAME_NOT_FOUND_DESCRIPTION, 'Please try again shortly.');

/**
 * Build a static document while preserving auth cookies and security headers.
 * @param response Existing authenticated/passthrough proxy response.
 * @param head Whether to omit the document body for HEAD.
 * @param unavailable Whether a transient lookup failure requires a retryable503.
 * @returns A no-store404 absence or503 temporary-failure response.
 */
function gameDocumentResponse(response: Response, head: boolean, unavailable: boolean): NextResponse {
  const headers = new Headers(response.headers);
  for (const name of [...headers.keys()]) {
    if (name.startsWith('x-middleware-')) headers.delete(name);
  }
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  if (unavailable) {
    headers.delete('X-Robots-Tag');
    headers.set('Retry-After', '60');
  } else {
    headers.set('X-Robots-Tag', 'noindex');
  }
  return new NextResponse(head ? null : unavailable ? unavailableHtml : documentHtml, {
    status: unavailable ? 503 : 404, headers,
  });
}

/**
 * Return a literal 404 body, independent of App Router streaming and adapters.
 * Keep the proxy's CSP/security headers and discard its routing control headers.
 * @param response Existing authenticated/passthrough proxy response.
 * @param head Whether the request is HEAD, which must carry no document body.
 * @returns A no-store, noindex HTML response with HTTP status 404.
 */
export function gameNotFoundResponse(response: Response, head: boolean): NextResponse {
  return gameDocumentResponse(response, head, false);
}

/**
 * Return a retryable temporary-failure document without error details or noindex.
 * @param response Existing authenticated/passthrough proxy response.
 * @param head Whether the request is HEAD, which must carry no document body.
 * @returns A no-store HTML503 with Retry-After and the existing security headers.
 */
export function gameUnavailableResponse(response: Response, head: boolean): NextResponse {
  return gameDocumentResponse(response, head, true);
}
