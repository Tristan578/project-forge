/**
 * Tests for sitemap.ts metadata API route.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWhere = vi.fn(() => Promise.resolve([]));

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: mockWhere,
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

  describe('dynamic game entries', () => {
    beforeEach(() => {
      mockWhere.mockReset();
    });

    it('includes published games from the database', async () => {
      const updatedAt = new Date('2026-04-01');
      mockWhere.mockResolvedValueOnce([
        { slug: 'cool-game', clerkId: 'user_abc', updatedAt },
        { slug: 'another-game', clerkId: 'user_xyz', updatedAt },
      ]);

      const result = await sitemap();
      const urls = result.map((e) => e.url);

      expect(urls).toContain('https://spawnforge.ai/play/user_abc/cool-game');
      expect(urls).toContain('https://spawnforge.ai/play/user_xyz/another-game');
    });

    it('sets weekly changeFrequency and 0.6 priority for game entries', async () => {
      mockWhere.mockResolvedValueOnce([
        { slug: 'my-game', clerkId: 'user_1', updatedAt: new Date() },
      ]);

      const result = await sitemap();
      const gameEntry = result.find((e) => e.url.includes('/play/'));

      expect(gameEntry).toBeDefined();
      expect(gameEntry!.changeFrequency).toBe('weekly');
      expect(gameEntry!.priority).toBe(0.6);
    });

    it('uses game updatedAt as lastModified', async () => {
      const updatedAt = new Date('2026-03-15T10:00:00Z');
      mockWhere.mockResolvedValueOnce([
        { slug: 'dated-game', clerkId: 'user_2', updatedAt },
      ]);

      const result = await sitemap();
      const gameEntry = result.find((e) => e.url.includes('/play/'));

      expect(gameEntry!.lastModified).toBe(updatedAt);
    });

    it('returns only static pages when DB query fails', async () => {
      mockWhere.mockRejectedValueOnce(new Error('DB unavailable'));

      const result = await sitemap();
      const gameEntries = result.filter((e) => e.url.includes('/play/'));

      expect(gameEntries).toHaveLength(0);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
