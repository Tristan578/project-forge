import { describe, it, expect } from 'vitest';
import robots from '../robots';
import sitemap from '../sitemap';

describe('docs robots', () => {
  it('declares a single wildcard rule', () => {
    const rules = robots().rules;
    const asArray = Array.isArray(rules) ? rules : [rules];

    expect(asArray).toHaveLength(1);
    expect(asArray[0].userAgent).toBe('*');
  });

  it('allows the two surfaces that are reachable without a session', () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;

    // Mirrors `isPublicRoute` in proxy.ts — everything else answers a crawler
    // with a sign-in redirect, so advertising it would waste crawl budget.
    expect(rule.allow).toEqual(['/', '/mcp']);
  });

  it('disallows the auth-gated paths without a trailing slash', () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    const disallow = rule.disallow as string[];

    expect(disallow).toContain('/sign-in');
    expect(disallow).toContain('/sign-up');
    expect(disallow).toContain('/api');
    // A `Disallow` value is a prefix match, so `/sign-in/` would leave the
    // canonical `/sign-in` crawlable.
    expect(disallow.filter((path) => path.endsWith('/'))).toEqual([]);
  });

  /**
   * A robots.txt that advertises a sitemap at one origin while the sitemap
   * declares its URLs at another is silently useless to a crawler. Both read
   * `DOCS_URL` from `lib/site.ts`; this pins that they still agree.
   */
  it('advertises a sitemap on the same origin the sitemap itself declares', () => {
    const advertised = robots().sitemap;
    expect(typeof advertised).toBe('string');

    const homepage = sitemap()[0].url;
    expect(advertised).toBe(`${homepage}/sitemap.xml`);
  });
});
