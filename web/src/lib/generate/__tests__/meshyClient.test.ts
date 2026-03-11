import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeshyClient } from '../meshyClient';

describe('MeshyClient', () => {
  const mockApiKey = 'meshy-test-key-123';

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('createTextTo3D', () => {
    it('sends correct request and returns taskId', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'task-abc-123' }),
      } as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      const result = await client.createTextTo3D({ prompt: 'a red dragon' });

      expect(result).toEqual({ taskId: 'task-abc-123' });
      expect(fetch).toHaveBeenCalledWith(
        'https://api.meshy.ai/openapi/v2/text-to-3d',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mockApiKey}`,
          }),
          body: expect.stringContaining('"prompt":"a red dragon"'),
        })
      );
    });

    it('uses default art style "realistic" when not specified', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'task-1' }),
      } as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      await client.createTextTo3D({ prompt: 'castle' });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.art_style).toBe('realistic');
    });

    it('uses high polycount for quality=high', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'task-2' }),
      } as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      await client.createTextTo3D({ prompt: 'tree', quality: 'high' });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.target_polycount).toBe(50000);
    });

    it('uses standard polycount for quality=standard', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'task-3' }),
      } as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      await client.createTextTo3D({ prompt: 'rock', quality: 'standard' });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.target_polycount).toBe(30000);
    });

    it('throws on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      } as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      await expect(client.createTextTo3D({ prompt: 'sword' })).rejects.toThrow(
        'Meshy API error (401): Unauthorized'
      );
    });

    it('falls back to "Unknown error" when response.text() rejects', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('body gone')),
      } as unknown as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      await expect(client.createTextTo3D({ prompt: 'gem' })).rejects.toThrow(
        'Meshy API error (500): Unknown error'
      );
    });

    it('passes negativePrompt and artStyle in body', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'task-4' }),
      } as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      await client.createTextTo3D({
        prompt: 'spaceship',
        artStyle: 'cartoon',
        negativePrompt: 'blurry',
      });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.art_style).toBe('cartoon');
      expect(body.negative_prompt).toBe('blurry');
    });
  });

  describe('createImageTo3D', () => {
    it('sends imageBase64 and returns taskId', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'img-task-1' }),
      } as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      const result = await client.createImageTo3D({
        imageBase64: 'data:image/png;base64,abc123',
        prompt: 'from image',
      });

      expect(result).toEqual({ taskId: 'img-task-1' });
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.image_url).toBe('data:image/png;base64,abc123');
    });

    it('throws on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limit exceeded'),
      } as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      await expect(
        client.createImageTo3D({ imageBase64: 'abc' })
      ).rejects.toThrow('Meshy API error (429): Rate limit exceeded');
    });
  });

  describe('getTaskStatus', () => {
    it('returns task status with progress and modelUrls', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'succeeded',
            progress: 100,
            model_urls: { glb: 'https://cdn.meshy.ai/model.glb' },
            thumbnail_url: 'https://cdn.meshy.ai/thumb.jpg',
          }),
      } as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      const status = await client.getTaskStatus('valid-task-id');

      expect(status).toEqual({
        status: 'succeeded',
        progress: 100,
        modelUrls: { glb: 'https://cdn.meshy.ai/model.glb' },
        thumbnailUrl: 'https://cdn.meshy.ai/thumb.jpg',
      });
    });

    it('defaults progress to 0 when missing', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'pending' }),
      } as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      const status = await client.getTaskStatus('valid-task-id');

      expect(status.progress).toBe(0);
    });

    it('throws on invalid taskId containing path traversal', async () => {
      const client = new MeshyClient({ apiKey: mockApiKey });
      await expect(client.getTaskStatus('../etc/passwd')).rejects.toThrow(
        'Invalid resource ID'
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it('throws on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Task not found'),
      } as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      await expect(client.getTaskStatus('valid-id-123')).rejects.toThrow(
        'Meshy status error (404): Task not found'
      );
    });
  });

  describe('createTextToTexture', () => {
    it('sends correct request and returns taskId', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'tex-task-1' }),
      } as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      const result = await client.createTextToTexture({ prompt: 'rusty metal' });

      expect(result).toEqual({ taskId: 'tex-task-1' });
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.prompt).toBe('rusty metal');
      expect(body.resolution).toBe('1024');
      expect(body.style).toBe('realistic');
      expect(body.tiling).toBe(true);
    });

    it('uses provided resolution and style', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'tex-task-2' }),
      } as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      await client.createTextToTexture({
        prompt: 'wood',
        resolution: '2048',
        style: 'cartoon',
        tiling: false,
        generateMaps: { normal: true },
      });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.resolution).toBe('2048');
      expect(body.style).toBe('cartoon');
      expect(body.tiling).toBe(false);
      expect(body.generate_maps).toEqual({ normal: true });
    });

    it('throws on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 402,
        text: () => Promise.resolve('Payment required'),
      } as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      await expect(client.createTextToTexture({ prompt: 'stone' })).rejects.toThrow(
        'Meshy texture API error (402): Payment required'
      );
    });
  });

  describe('getTextureStatus', () => {
    it('returns texture status with maps', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'succeeded',
            progress: 100,
            texture_urls: {
              albedo: 'https://cdn.meshy.ai/albedo.png',
              normal: 'https://cdn.meshy.ai/normal.png',
            },
          }),
      } as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      const status = await client.getTextureStatus('valid-tex-id');

      expect(status.status).toBe('succeeded');
      expect(status.progress).toBe(100);
      expect(status.maps).toEqual({
        albedo: 'https://cdn.meshy.ai/albedo.png',
        normal: 'https://cdn.meshy.ai/normal.png',
      });
    });

    it('throws on invalid taskId with special characters', async () => {
      const client = new MeshyClient({ apiKey: mockApiKey });
      await expect(client.getTextureStatus('id/with/slashes')).rejects.toThrow(
        'Invalid resource ID'
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it('throws on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      } as Response);

      const client = new MeshyClient({ apiKey: mockApiKey });
      await expect(client.getTextureStatus('valid-id')).rejects.toThrow(
        'Meshy texture status error (500): Server error'
      );
    });
  });
});
