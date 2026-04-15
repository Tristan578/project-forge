/**
 * Tests for sitemap.ts metadata API route.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest';

// Mock DB to avoid real database calls in tests
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
  })),
  queryWithResilience: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import sitemap from '../sitemap';

describe('sitemap', () => {
  it('returns an array of sitemap entries', async () => {
    const result = await sitemap();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes the homepage with priority 1.0', async () => {
    const result = await sitemap();
    expect(result[0].priority).toBe(1.0);
  });

  it('includes public pages', async () => {
    const result = await sitemap();
    const urls = result.map((entry) => entry.url);

    expect(urls.some((u: string) => u.includes('/pricing'))).toBe(true);
    expect(urls.some((u: string) => u.includes('/community'))).toBe(true);
    expect(urls.some((u: string) => u.includes('/docs'))).toBe(true);
    expect(urls.some((u: string) => u.includes('/privacy'))).toBe(true);
    expect(urls.some((u: string) => u.includes('/terms'))).toBe(true);
  });

  it('all entries have lastModified and changeFrequency', async () => {
    const result = await sitemap();
    for (const entry of result) {
      expect(entry.lastModified).toBeDefined();
      expect(entry.changeFrequency).toBeDefined();
    }
  });

  it('does not include private routes', async () => {
    const result = await sitemap();
    const urls = result.map((entry) => entry.url);

    expect(urls.some((u: string) => u.includes('/api/'))).toBe(false);
    expect(urls.some((u: string) => u.includes('/admin'))).toBe(false);
    expect(urls.some((u: string) => u.includes('/dev'))).toBe(false);
    expect(urls.some((u: string) => u.includes('/editor'))).toBe(false);
    expect(urls.some((u: string) => u.includes('/settings'))).toBe(false);
  });
});
