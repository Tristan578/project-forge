/**
 * Tests for sitemap.ts metadata API route.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import sitemap from '../sitemap';

describe('sitemap', () => {
  it('returns an array of sitemap entries', () => {
    const result = sitemap();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes the homepage with priority 1.0', () => {
    const result = sitemap();
    // The first entry should be the root with highest priority
    expect(result[0].priority).toBe(1.0);
  });

  it('includes public pages', () => {
    const result = sitemap();
    const urls = result.map((entry) => entry.url);

    expect(urls.some((u) => u.includes('/pricing'))).toBe(true);
    expect(urls.some((u) => u.includes('/community'))).toBe(true);
    expect(urls.some((u) => u.includes('/docs'))).toBe(true);
    expect(urls.some((u) => u.includes('/privacy'))).toBe(true);
    expect(urls.some((u) => u.includes('/terms'))).toBe(true);
  });

  it('all entries have lastModified and changeFrequency', () => {
    const result = sitemap();
    for (const entry of result) {
      expect(entry.lastModified).toBeInstanceOf(Date);
      expect(typeof entry.changeFrequency).toBe('string');
    }
  });

  it('does not include private routes', () => {
    const result = sitemap();
    const urls = result.map((entry) => entry.url);

    expect(urls.some((u) => u.includes('/api/'))).toBe(false);
    expect(urls.some((u) => u.includes('/admin'))).toBe(false);
    expect(urls.some((u) => u.includes('/dev'))).toBe(false);
    expect(urls.some((u) => u.includes('/editor'))).toBe(false);
    expect(urls.some((u) => u.includes('/settings'))).toBe(false);
  });
});
