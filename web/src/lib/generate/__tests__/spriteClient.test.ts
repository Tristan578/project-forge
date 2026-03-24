import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpriteClient } from '../spriteClient';

describe('SpriteClient', () => {
  const mockApiKey = 'sk-test-123';
  
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('initializes correctly', () => {
    const client = new SpriteClient(mockApiKey, 'dalle3');
    expect(client).not.toBeUndefined();
  });

  describe('generateSprite with DALL-E 3', () => {
    it('calls DALL-E API with correct params', async () => {
      const client = new SpriteClient(mockApiKey, 'dalle3');
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ url: 'https://image.url' }] }),
      } as Response);

      const result = await client.generateSprite({
        prompt: 'a red cat',
        size: '512x512',
        style: 'pixel-art'
      });

      expect(result.taskId).toBe('https://image.url');
      expect(result.status).toBe('completed');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('openai.com'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': `Bearer ${mockApiKey}`
          }),
          body: expect.stringContaining('dall-e-3')
        })
      );
    });

    it('throws error on API failure', async () => {
      const client = new SpriteClient(mockApiKey, 'dalle3');
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Invalid API Key'),
      } as Response);

      await expect(client.generateSprite({ prompt: 'test', size: '1024x1024' }))
        .rejects.toThrow('DALL-E API error (401): Invalid API Key');
    });
  });

  describe('generateSprite with Replicate', () => {
    it('calls Replicate API with correct params', async () => {
      const client = new SpriteClient(mockApiKey, 'sdxl');
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'task_123', status: 'starting' }),
      } as Response);

      const result = await client.generateSprite({
        prompt: 'spaceship',
        size: '512x512'
      });

      expect(result.taskId).toBe('task_123');
      expect(result.status).toBe('starting');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('replicate.com'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('stability-ai/sdxl')
        })
      );
    });
  });

  it('generateSpriteSheet calculates correct dimensions', async () => {
    const client = new SpriteClient(mockApiKey, 'sdxl');
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'sheet_123', status: 'starting' }),
    } as Response);

    await client.generateSpriteSheet({
      prompt: 'walking man',
      frameCount: 8,
      size: '64x64'
    });

    // 64 * 8 = 512 width
    expect(fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining('"width":512')
      })
    );
  });

  it('getReplicateStatus calls status API', async () => {
    const client = new SpriteClient(mockApiKey, 'sdxl');
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'succeeded', output: ['https://result.url'] }),
    } as Response);

    const result = await client.getReplicateStatus('task_123');

    expect(result.status).toBe('succeeded');
    expect(result.output).toContain('https://result.url');
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ href: expect.stringContaining('task_123') }),
      expect.anything()
    );
  });

  it('getReplicateStatus throws on API failure', async () => {
    const client = new SpriteClient(mockApiKey, 'sdxl');
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    } as Response);

    await expect(client.getReplicateStatus('task_123'))
      .rejects.toThrow('Replicate status error (500)');
  });

  describe('generateTileset', () => {
    it('calls Replicate with tileset prompt', async () => {
      const client = new SpriteClient(mockApiKey, 'sdxl');
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'tile_123', status: 'starting' }),
      } as Response);

      const result = await client.generateTileset({
        prompt: 'dungeon floor',
        tileSize: 32,
        gridSize: '8x8',
      });

      expect(result.taskId).toBe('tile_123');
      expect(result.status).toBe('starting');
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.input.width).toBe(512);
      expect(body.input.height).toBe(512);
      expect(body.input.prompt).toContain('tileset');
      expect(body.input.prompt).toContain('dungeon floor');
    });

    it('throws on API failure', async () => {
      const client = new SpriteClient(mockApiKey, 'sdxl');
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve('Service Unavailable'),
      } as Response);

      await expect(client.generateTileset({ prompt: 'test', tileSize: 16, gridSize: '4x4' }))
        .rejects.toThrow('Replicate API error (503)');
    });
  });

  describe('removeBackground', () => {
    it('calls remove.bg API and returns base64 result', async () => {
      const mockBlob = new Blob(['png-data'], { type: 'image/png' });
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      } as Response);

      const client = new SpriteClient(mockApiKey, 'removebg');
      const result = await client.removeBackground('https://example.com/image.png');

      // FileReader in jsdom converts blob to data URL
      expect(result.resultUrl).toContain('data:');
      expect(fetch).toHaveBeenCalledWith(
        'https://api.remove.bg/v1.0/removebg',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-Api-Key': mockApiKey }),
        })
      );
    });

    it('throws on API failure', async () => {
      const client = new SpriteClient(mockApiKey, 'removebg');
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 402,
        text: () => Promise.resolve('Insufficient credits'),
      } as Response);

      await expect(client.removeBackground('https://example.com/image.png'))
        .rejects.toThrow('remove.bg API error (402)');
    });
  });

  describe('generateSpriteSheet', () => {
    it('clamps frame count to max dimension', async () => {
      const client = new SpriteClient(mockApiKey, 'sdxl');
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'sheet_456', status: 'starting' }),
      } as Response);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // 256px frames, max 1024/256 = 4 frames. Requesting 8 should clamp.
      await client.generateSpriteSheet({
        prompt: 'running',
        frameCount: 8,
        size: '256x256',
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('reduced from 8 to 4')
      );
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.input.width).toBe(1024); // 256 * 4
      warnSpy.mockRestore();
    });

    it('throws on API failure', async () => {
      const client = new SpriteClient(mockApiKey, 'sdxl');
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limited'),
      } as Response);

      await expect(client.generateSpriteSheet({
        prompt: 'running',
        frameCount: 4,
        size: '64x64',
      })).rejects.toThrow('Replicate API error (429)');
    });
  });

  describe('generateSprite style variations', () => {
    it('enhances prompt with hand-drawn style', async () => {
      const client = new SpriteClient(mockApiKey, 'dalle3');
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ url: 'https://img.url' }] }),
      } as Response);

      await client.generateSprite({ prompt: 'cat', size: '512x512', style: 'hand-drawn' });
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.prompt).toContain('hand-drawn');
    });

    it('enhances prompt with vector style', async () => {
      const client = new SpriteClient(mockApiKey, 'dalle3');
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ url: 'https://img.url' }] }),
      } as Response);

      await client.generateSprite({ prompt: 'cat', size: '512x512', style: 'vector' });
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.prompt).toContain('vector art');
    });

    it('enhances prompt with realistic style', async () => {
      const client = new SpriteClient(mockApiKey, 'dalle3');
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ url: 'https://img.url' }] }),
      } as Response);

      await client.generateSprite({ prompt: 'cat', size: '512x512', style: 'realistic' });
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.prompt).toContain('realistic');
    });

    it('uses default enhancement when no style is specified', async () => {
      const client = new SpriteClient(mockApiKey, 'dalle3');
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ url: 'https://img.url' }] }),
      } as Response);

      await client.generateSprite({ prompt: 'cat', size: '512x512' });
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.prompt).toContain('game sprite');
      expect(body.prompt).toContain('transparent background');
    });

    it('uses Replicate error path on failure', async () => {
      const client = new SpriteClient(mockApiKey, 'sdxl');
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal error'),
      } as Response);

      await expect(client.generateSprite({ prompt: 'test', size: '512x512' }))
        .rejects.toThrow('Replicate API error (500)');
    });
  });
});
