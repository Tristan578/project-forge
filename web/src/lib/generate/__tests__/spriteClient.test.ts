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
    expect(client).toBeDefined();
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
});
