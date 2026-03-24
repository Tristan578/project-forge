/**
 * Tests for robots.ts metadata API route.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import robots from '../robots';

describe('robots', () => {
  it('returns valid robots configuration', () => {
    const result = robots();

    expect(Array.isArray(result.rules)).toBe(true);
  });

  it('allows crawling of root path', () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const mainRule = rules[0];

    expect(mainRule.userAgent).toBe('*');
    expect(mainRule.allow).toBe('/');
  });

  it('disallows api, admin, dev, and settings paths', () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const mainRule = rules[0];
    const disallow = mainRule.disallow as string[];

    expect(disallow).toContain('/api/');
    expect(disallow).toContain('/admin/');
    expect(disallow).toContain('/dev/');
    expect(disallow).toContain('/settings/');
  });

  it('includes sitemap URL', () => {
    const result = robots();
    expect(result.sitemap).toContain('/sitemap.xml');
  });
});
