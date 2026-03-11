import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SunoClient } from '../sunoClient';

describe('SunoClient', () => {
  const mockApiKey = 'suno-test-key-789';

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('createMusic', () => {
    it('sends correct request and returns taskId from task_id field', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ task_id: 'suno-task-001' }),
      } as Response);

      const client = new SunoClient({ apiKey: mockApiKey });
      const result = await client.createMusic({ prompt: 'upbeat electronic music' });

      expect(result).toEqual({ taskId: 'suno-task-001' });
      expect(fetch).toHaveBeenCalledWith(
        'https://api.suno.ai/v1/generation',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mockApiKey}`,
          }),
          body: expect.stringContaining('"prompt":"upbeat electronic music"'),
        })
      );
    });

    it('returns taskId from id field when task_id is absent', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'suno-alt-id' }),
      } as Response);

      const client = new SunoClient({ apiKey: mockApiKey });
      const result = await client.createMusic({ prompt: 'calm ambient' });

      expect(result).toEqual({ taskId: 'suno-alt-id' });
    });

    it('defaults durationSeconds to 30 when not specified', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ task_id: 'task-2' }),
      } as Response);

      const client = new SunoClient({ apiKey: mockApiKey });
      await client.createMusic({ prompt: 'jazz' });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.duration_seconds).toBe(30);
    });

    it('sends provided durationSeconds', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ task_id: 'task-3' }),
      } as Response);

      const client = new SunoClient({ apiKey: mockApiKey });
      await client.createMusic({ prompt: 'rock', durationSeconds: 60 });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.duration_seconds).toBe(60);
    });

    it('defaults instrumental to true when not specified', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ task_id: 'task-4' }),
      } as Response);

      const client = new SunoClient({ apiKey: mockApiKey });
      await client.createMusic({ prompt: 'classical' });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.instrumental).toBe(true);
    });

    it('allows instrumental=false for vocal tracks', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ task_id: 'task-5' }),
      } as Response);

      const client = new SunoClient({ apiKey: mockApiKey });
      await client.createMusic({ prompt: 'pop song', instrumental: false });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.instrumental).toBe(false);
    });

    it('throws on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      } as Response);

      const client = new SunoClient({ apiKey: mockApiKey });
      await expect(client.createMusic({ prompt: 'hip hop' })).rejects.toThrow(
        'Suno API error (401): Unauthorized'
      );
    });

    it('throws on rate limit response (429)', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Too Many Requests'),
      } as Response);

      const client = new SunoClient({ apiKey: mockApiKey });
      await expect(client.createMusic({ prompt: 'blues' })).rejects.toThrow(
        'Suno API error (429): Too Many Requests'
      );
    });

    it('falls back to "Unknown error" when response.text() rejects', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.reject(new Error('body gone')),
      } as unknown as Response);

      const client = new SunoClient({ apiKey: mockApiKey });
      await expect(client.createMusic({ prompt: 'metal' })).rejects.toThrow(
        'Suno API error (503): Unknown error'
      );
    });
  });

  describe('getStatus', () => {
    it('returns completed status with audioUrl', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'succeeded',
            progress: 100,
            audio_url: 'https://cdn.suno.ai/track.mp3',
            duration_seconds: 30,
          }),
      } as Response);

      const client = new SunoClient({ apiKey: mockApiKey });
      const status = await client.getStatus('valid-task-id');

      expect(status).toEqual({
        status: 'succeeded',
        progress: 100,
        audioUrl: 'https://cdn.suno.ai/track.mp3',
        durationSeconds: 30,
      });
    });

    it('returns pending status without audioUrl', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'processing',
            progress: 45,
          }),
      } as Response);

      const client = new SunoClient({ apiKey: mockApiKey });
      const status = await client.getStatus('valid-task-id');

      expect(status.status).toBe('processing');
      expect(status.progress).toBe(45);
      expect(status.audioUrl).toBeUndefined();
      expect(status.durationSeconds).toBeUndefined();
    });

    it('defaults progress to 0 when missing from response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'queued' }),
      } as Response);

      const client = new SunoClient({ apiKey: mockApiKey });
      const status = await client.getStatus('valid-id');

      expect(status.progress).toBe(0);
    });

    it('uses correct GET endpoint with Authorization header', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'succeeded', progress: 100 }),
      } as Response);

      const client = new SunoClient({ apiKey: mockApiKey });
      await client.getStatus('my-task-abc');

      expect(fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          href: expect.stringContaining('my-task-abc'),
        }),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockApiKey}`,
          }),
        })
      );
    });

    it('throws on invalid taskId containing path traversal', async () => {
      const client = new SunoClient({ apiKey: mockApiKey });
      await expect(client.getStatus('../../../etc/passwd')).rejects.toThrow(
        'Invalid resource ID'
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it('throws on taskId with spaces', async () => {
      const client = new SunoClient({ apiKey: mockApiKey });
      await expect(client.getStatus('task id with spaces')).rejects.toThrow(
        'Invalid resource ID'
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it('allows alphanumeric task IDs with hyphens and underscores', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'succeeded', progress: 100 }),
      } as Response);

      const client = new SunoClient({ apiKey: mockApiKey });
      // Should not throw
      await expect(client.getStatus('task-123_ABC')).resolves.toBeDefined();
    });

    it('throws on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Task not found'),
      } as Response);

      const client = new SunoClient({ apiKey: mockApiKey });
      await expect(client.getStatus('valid-id')).rejects.toThrow(
        'Suno status error (404): Task not found'
      );
    });

    it('falls back to "Unknown error" when response.text() rejects on status check', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('body gone')),
      } as unknown as Response);

      const client = new SunoClient({ apiKey: mockApiKey });
      await expect(client.getStatus('valid-id')).rejects.toThrow(
        'Suno status error (500): Unknown error'
      );
    });
  });
});
