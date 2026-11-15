/**
 * @vitest-environment node
 *
 * `DOCS_URL` is parsed with `new URL()` at module scope by `proxy.ts` and
 * `app/layout.tsx`. A malformed `NEXT_PUBLIC_DOCS_URL` therefore used to throw
 * while those modules loaded and take the docs site down before it served a
 * single request. These pin the guard that turns that into a logged fallback.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_DOCS_URL, resolveDocsUrl } from '../site';

describe('resolveDocsUrl', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the canonical default when the variable is unset', () => {
    expect(resolveDocsUrl(undefined)).toBe(DEFAULT_DOCS_URL);
  });

  it('returns a valid absolute URL unchanged, without adding a trailing slash', () => {
    // robots.ts and sitemap.ts concatenate paths onto this value.
    expect(resolveDocsUrl('https://docs-preview.spawnforge.ai')).toBe('https://docs-preview.spawnforge.ai');
  });

  it.each(['docs.spawnforge.ai', '', 'not a url', '://missing-scheme'])(
    'falls back to the default and logs instead of throwing for %j',
    (raw) => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => resolveDocsUrl(raw)).not.toThrow();
      expect(resolveDocsUrl(raw)).toBe(DEFAULT_DOCS_URL);
      expect(errorSpy).toHaveBeenCalled();
    },
  );
});
