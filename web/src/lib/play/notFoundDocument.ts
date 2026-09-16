/** Static, script-free missing-game document returned before a play render streams. */
import { NextResponse } from 'next/server';

/** Visible heading shared with the colocated React not-found boundary. */
export const GAME_NOT_FOUND_HEADING = 'Game Not Found';
/** Description shared with the colocated React not-found boundary. */
export const GAME_NOT_FOUND_DESCRIPTION = 'This game does not exist or is not currently published.';
/** Document title for an unavailable published game. */
export const GAME_NOT_FOUND_PAGE_TITLE = 'Game Not Found - SpawnForge';

// All interpolated values are trusted module constants, never route or database input.
const documentHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${GAME_NOT_FOUND_PAGE_TITLE}</title><style>html{color-scheme:dark}body{margin:0;background:#09090b;color:#e4e4e7;font:14px system-ui,sans-serif}main{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:0 16px;box-sizing:border-box}.message{max-width:448px;text-align:center}.face{font-size:60px;margin-bottom:16px}h1{font-size:20px;margin:0 0 8px}p{color:#a1a1aa;margin:0 0 24px}a{display:inline-flex;align-items:center;gap:8px;min-height:44px;box-sizing:border-box;border-radius:4px;padding:8px 16px;background:#27272a;color:#d4d4d8;text-decoration:none}a:hover{background:#3f3f46}a:focus-visible{outline:2px solid #fb923c;outline-offset:3px}</style></head><body><main><div class="message" role="alert"><div class="face" aria-hidden="true">:(</div><h1>${GAME_NOT_FOUND_HEADING}</h1><p>${GAME_NOT_FOUND_DESCRIPTION}</p><a href="/"><span aria-hidden="true">←</span>Back to SpawnForge</a></div></main></body></html>`;

/**
 * Return a literal 404 body, independent of App Router streaming and adapters.
 * Keep the proxy's CSP/security headers and discard its routing control headers.
 * @param response Existing authenticated/passthrough proxy response.
 * @param head Whether the request is HEAD, which must carry no document body.
 * @returns A no-store, noindex HTML response with HTTP status 404.
 */
export function gameNotFoundResponse(response: Response, head: boolean): NextResponse {
  const headers = new Headers(response.headers);
  for (const name of [...headers.keys()]) {
    if (name.startsWith('x-middleware-')) headers.delete(name);
  }
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', 'noindex');
  return new NextResponse(head ? null : documentHtml, { status: 404, headers });
}
