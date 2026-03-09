// web/src/lib/generate/__tests__/pixelArtClient.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock server-only before importing the module
vi.mock('server-only', () => ({}));

import { PixelArtClient, buildPixelArtPrompt } from '../pixelArtClient';

describe('pixelArtClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('buildPixelArtPrompt', () => {
    it('should include pixel art style keywords', () => {
      const prompt = buildPixelArtPrompt('a knight', 'character');
      expect(prompt).toContain('pixel art');
      expect(prompt).toContain('knight');
    });

    it('should include character-specific terms for character style', () => {
      const prompt = buildPixelArtPrompt('a warrior', 'character');
      expect(prompt).toContain('sprite');
    });

    it('should include tile-specific terms for tile style', () => {
      const prompt = buildPixelArtPrompt('grass', 'tile');
      expect(prompt).toContain('tileable');
    });

    it('should include prop-specific terms for prop style', () => {
      const prompt = buildPixelArtPrompt('sword', 'prop');
      expect(prompt).toContain('game item');
    });

    it('should include icon-specific terms for icon style', () => {
      const prompt = buildPixelArtPrompt('heart', 'icon');
      expect(prompt).toContain('icon');
    });

    it('should include environment terms for environment style', () => {
      const prompt = buildPixelArtPrompt('forest', 'environment');
      expect(prompt).toContain('background');
    });
  });

  describe('PixelArtClient', () => {
    it('should call DALL-E endpoint for openai provider', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [{ b64_json: 'base64data' }],
        }),
      } as Response);

      const client = new PixelArtClient('test-key', 'openai');
      const result = await client.generate({
        prompt: 'a knight',
        style: 'character',
        size: 1024,
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('openai.com'),
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.base64).toBe('base64data');
    });

    it('should call Replicate endpoint for replicate provider', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'pred-123',
          status: 'starting',
        }),
      } as Response);

      const client = new PixelArtClient('test-key', 'replicate');
      const result = await client.generate({
        prompt: 'a sword',
        style: 'prop',
        size: 1024,
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('replicate.com'),
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.predictionId).toBe('pred-123');
      expect(result.status).toBe('starting');
    });

    it('should throw on API error', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limited'),
      } as Response);

      const client = new PixelArtClient('test-key', 'openai');
      await expect(client.generate({
        prompt: 'test',
        style: 'character',
        size: 1024,
      })).rejects.toThrow('429');
    });

    it('should include pixel art prompt enhancement', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ b64_json: 'x' }] }),
      } as Response);

      const client = new PixelArtClient('test-key', 'openai');
      await client.generate({ prompt: 'a cat', style: 'character', size: 512 });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.prompt).toContain('pixel art');
    });
  });
});
