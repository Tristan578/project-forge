/**
 * Tests for root page (/) marketing SEO metadata (regression for PF-693).
 *
 * Verifies that unauthenticated visitors get proper marketing metadata
 * including OG images and Twitter cards — not just a bare title/description.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';

describe('root page metadata (PF-693)', () => {
  it('exports metadata with a marketing-specific title', async () => {
    const mod = await import('../page');
    const meta = mod.metadata;
    expect(typeof meta.title).toBe('string');
    expect((meta.title as string).toLowerCase()).toContain('spawnforge');
  });

  it('exports metadata with a descriptive description', async () => {
    const mod = await import('../page');
    const meta = mod.metadata;
    expect(typeof meta.description).toBe('string');
    expect((meta.description as string).length).toBeGreaterThan(40);
  });

  it('exports metadata with keywords array (regression for PF-693)', async () => {
    const mod = await import('../page');
    const meta = mod.metadata;
    expect(Array.isArray(meta.keywords)).toBe(true);
    expect((meta.keywords as string[]).length).toBeGreaterThan(0);
    // Must include game-engine-specific keywords for SEO
    const keywords = (meta.keywords as string[]).map((k) => k.toLowerCase());
    expect(keywords.some((k) => k.includes('game'))).toBe(true);
  });

  it('exports openGraph metadata with image for social sharing (regression for PF-693)', async () => {
    const mod = await import('../page');
    const meta = mod.metadata;
    const og = meta.openGraph as Record<string, unknown>;
    expect(og).not.toBeUndefined();
    expect(og.title).not.toBeUndefined();
    expect(og.type).toBe('website');
    // OG image is required for proper social media sharing
    const images = og.images as Array<{ url: string; width: number; height: number; alt: string }>;
    expect(Array.isArray(images)).toBe(true);
    expect(images.length).toBeGreaterThan(0);
    expect(typeof images[0].url).toBe('string');
    expect(images[0].url).toContain('og-image.png');
    expect(images[0].width).toBe(1200);
    expect(images[0].height).toBe(630);
  });

  it('exports twitter card metadata for Twitter/X sharing (regression for PF-693)', async () => {
    const mod = await import('../page');
    const meta = mod.metadata;
    const twitter = meta.twitter as Record<string, unknown>;
    expect(twitter).not.toBeUndefined();
    // summary_large_image is the correct card type for landing pages
    expect(twitter.card).toBe('summary_large_image');
    expect(typeof twitter.title).toBe('string');
    expect(typeof twitter.description).toBe('string');
    const images = twitter.images as string[];
    expect(Array.isArray(images)).toBe(true);
    expect(images[0]).toContain('og-image.png');
  });

  it('marketing layout does not export redundant conflicting metadata (regression for PF-693)', async () => {
    // The marketing layout exported duplicate incomplete metadata that shadowed the
    // root page's complete metadata object. It should export no metadata now.
    const mod = await import('../(marketing)/layout');
    expect('metadata' in mod).toBe(false);
  });
});
