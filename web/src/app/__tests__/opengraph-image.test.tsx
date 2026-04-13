/**
 * Tests for root opengraph-image.tsx
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Root OG Image', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports correct size (1200x630)', async () => {
    const mod = await import('../opengraph-image');
    expect(mod.size).toEqual({ width: 1200, height: 630 });
  });

  it('exports alt text', async () => {
    const mod = await import('../opengraph-image');
    expect(mod.alt).toBe('SpawnForge — AI-Powered Game Creation Platform');
  });

  it('exports image/png content type', async () => {
    const mod = await import('../opengraph-image');
    expect(mod.contentType).toBe('image/png');
  });

  it('default export returns an ImageResponse', async () => {
    const mod = await import('../opengraph-image');
    const response = mod.default();
    // ImageResponse extends Response
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get('content-type')).toContain('image/png');
  });
});
