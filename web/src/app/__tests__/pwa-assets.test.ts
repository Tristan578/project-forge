/**
 * @vitest-environment node
 *
 * The PWA surface — manifest.json and sw.js — is served as static files and is
 * exercised by nothing else. Both shipped broken to production:
 *
 *   * manifest.json declared /icon-192.png and /icon-512.png. Neither file has
 *     ever existed in web/public, so every page load logged
 *     "GET .../icon-192.png 404" and "Error while trying to use the following
 *     icon from the Manifest". A manifest can reference any path; nothing
 *     checks that the path resolves.
 *
 *   * sw.js intercepted navigations and answered them cache-first. That let it
 *     re-fetch a document whose redirect went off-origin — an unauthenticated
 *     /dashboard 307s to Clerk's account portal — which put the request under
 *     `connect-src` and got it blocked, surfacing as an opaque
 *     "Uncaught (in promise) TypeError: Failed to fetch at sw.js:94".
 *
 * Neither is reachable from a component test, and neither fails a build. They
 * are asserted here against the real files on disk.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC_DIR = join(__dirname, '..', '..', '..', 'public');
const APP_DIR = join(__dirname, '..');

/**
 * Resolve a manifest `src` to a file on disk.
 *
 * Next.js serves web/public/* at the root AND app-dir conventions such as
 * app/favicon.ico, so both roots count as "this path will resolve".
 */
function resolvesToAFile(src: string): boolean {
  const rel = src.replace(/^\//, '');
  return existsSync(join(PUBLIC_DIR, rel)) || existsSync(join(APP_DIR, rel));
}

describe('manifest.json', () => {
  const manifest = JSON.parse(
    readFileSync(join(PUBLIC_DIR, 'manifest.json'), 'utf8'),
  ) as { icons?: { src: string }[] };

  it('declares at least one icon', () => {
    // A manifest with no icons is not "trivially passing" the check below.
    expect(manifest.icons?.length ?? 0).toBeGreaterThan(0);
  });

  it.each((manifest.icons ?? []).map((i) => i.src))(
    'icon %s resolves to a file that exists',
    (src) => {
      expect(resolvesToAFile(src)).toBe(true);
    },
  );
});

describe('sw.js', () => {
  const sw = readFileSync(join(PUBLIC_DIR, 'sw.js'), 'utf8');

  it('does not intercept navigations', () => {
    // The document must be left to the browser. Intercepting it is what put a
    // cross-origin auth redirect under connect-src, and what allowed a
    // pre-authentication page to be served cache-first to a signed-in user.
    expect(sw).toMatch(/request\.mode === "navigate"|request\.destination === "document"/);
  });

  it('does not precache real application routes', () => {
    // "/" and "/dashboard" were precached at install — before sign-in — so the
    // stored documents were the signed-out shells.
    const precache = /const PRECACHE_URLS = \[([\s\S]*?)\]/.exec(sw)?.[1] ?? '';
    expect(precache).not.toMatch(/"\/dashboard"/);
    expect(precache).not.toMatch(/"\/"/);
  });

  it('attaches a rejection handler to the background revalidation', () => {
    // Without this a failed revalidation is an unhandled rejection, which is
    // how a CSP block reached the console pointing at the service worker
    // instead of at the blocked host.
    expect(sw).toMatch(/networkFetch\.catch\(/);
  });

  it('uses a cache name past v1, so poisoned v1 entries are dropped', () => {
    // `activate` deletes every key !== CACHE_NAME, so the rename IS the
    // migration. Without it, clients holding pre-auth documents in
    // spawnforge-v1 would keep serving them after the fix shipped.
    const name = /const CACHE_NAME = "([^"]+)"/.exec(sw)?.[1];
    expect(name).toBeDefined();
    expect(name).not.toBe('spawnforge-v1');
  });
});
