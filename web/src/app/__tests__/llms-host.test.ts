/**
 * `public/llms.txt` and `public/llms-full.txt` are crawler-facing, like the
 * sitemap: every site URL in them must use the canonical www host, not the apex
 * host that redirects to it.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public');

describe.each(['llms.txt', 'llms-full.txt'])('%s', (file) => {
  const text = readFileSync(path.join(publicDir, file), 'utf8');
  const siteUrls = text.match(/https?:\/\/[^\s)>\]]*spawnforge\.ai[^\s)>\]]*/g) ?? [];

  it('links to the site at all (vacuity guard)', () => {
    expect(siteUrls.some((u) => u.startsWith('https://www.spawnforge.ai'))).toBe(true);
  });

  it('never links the apex host, which redirects to www', () => {
    expect(siteUrls.filter((u) => /^https?:\/\/spawnforge\.ai(?:[/?#]|$)/.test(u))).toEqual([]);
  });
});
