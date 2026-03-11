import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ElevenLabsClient } from '../elevenlabsClient';

describe('ElevenLabsClient', () => {
  const mockApiKey = 'elevenlabs-test-key-456';

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('generateSfx', () => {
    it('sends correct request and returns audio result', async () => {
      const fakeBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeBuffer),
      } as Response);

      const client = new ElevenLabsClient({ apiKey: mockApiKey });
      const result = await client.generateSfx({ prompt: 'explosion sound', durationSeconds: 3 });

      expect(result.durationSeconds).toBe(3);
      expect(typeof result.audioBase64).toBe('string');
      expect(fetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/sound-generation',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'xi-api-key': mockApiKey,
          }),
          body: expect.stringContaining('"text":"explosion sound"'),
        })
      );
    });

    it('defaults durationSeconds to 5 when not specified', async () => {
      const fakeBuffer = new Uint8Array([]).buffer;
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeBuffer),
      } as Response);

      const client = new ElevenLabsClient({ apiKey: mockApiKey });
      const result = await client.generateSfx({ prompt: 'wind' });

      expect(result.durationSeconds).toBe(5);
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.duration_seconds).toBe(5);
    });

    it('encodes the audio buffer as non-empty base64 string', async () => {
      const fakeBuffer = new Uint8Array([72, 101, 108, 108, 111]).buffer;
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeBuffer),
      } as Response);

      const client = new ElevenLabsClient({ apiKey: mockApiKey });
      const result = await client.generateSfx({ prompt: 'test' });

      // Should be a non-empty base64 string
      expect(typeof result.audioBase64).toBe('string');
      expect(result.audioBase64.length).toBeGreaterThan(0);
      // Valid base64 characters only
      expect(result.audioBase64).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('throws on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Invalid API key'),
      } as Response);

      const client = new ElevenLabsClient({ apiKey: mockApiKey });
      await expect(client.generateSfx({ prompt: 'rain' })).rejects.toThrow(
        'ElevenLabs SFX API error (401): Invalid API key'
      );
    });

    it('falls back to "Unknown error" when response.text() rejects', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.reject(new Error('body error')),
      } as unknown as Response);

      const client = new ElevenLabsClient({ apiKey: mockApiKey });
      await expect(client.generateSfx({ prompt: 'thunder' })).rejects.toThrow(
        'ElevenLabs SFX API error (503): Unknown error'
      );
    });

    it('throws on rate limit response (429)', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limit exceeded'),
      } as Response);

      const client = new ElevenLabsClient({ apiKey: mockApiKey });
      await expect(client.generateSfx({ prompt: 'beep' })).rejects.toThrow(
        'ElevenLabs SFX API error (429): Rate limit exceeded'
      );
    });
  });

  describe('generateVoice', () => {
    it('sends correct request with default voiceId and returns audio', async () => {
      const fakeBuffer = new Uint8Array([10, 20]).buffer;
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeBuffer),
      } as Response);

      const client = new ElevenLabsClient({ apiKey: mockApiKey });
      const result = await client.generateVoice({ text: 'Hello world' });

      expect(typeof result.audioBase64).toBe('string');
      expect(result.durationSeconds).toBeGreaterThanOrEqual(1);
      // Default voiceId: JBFqnCBsd6RMkjVDRZzb
      expect(fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          href: expect.stringContaining('JBFqnCBsd6RMkjVDRZzb'),
        }),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'xi-api-key': mockApiKey,
          }),
        })
      );
    });

    it('uses provided voiceId in URL', async () => {
      const fakeBuffer = new Uint8Array([]).buffer;
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeBuffer),
      } as Response);

      const client = new ElevenLabsClient({ apiKey: mockApiKey });
      await client.generateVoice({ text: 'Testing voice', voiceId: 'MyCustomVoiceId' });

      expect(fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          href: expect.stringContaining('MyCustomVoiceId'),
        }),
        expect.anything()
      );
    });

    it('passes voice settings to API body', async () => {
      const fakeBuffer = new Uint8Array([]).buffer;
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeBuffer),
      } as Response);

      const client = new ElevenLabsClient({ apiKey: mockApiKey });
      await client.generateVoice({
        text: 'Test',
        stability: 0.8,
        similarityBoost: 0.9,
        style: 0.5,
      });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.voice_settings.stability).toBe(0.8);
      expect(body.voice_settings.similarity_boost).toBe(0.9);
      expect(body.voice_settings.style).toBe(0.5);
    });

    it('uses default voice settings when not provided', async () => {
      const fakeBuffer = new Uint8Array([]).buffer;
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeBuffer),
      } as Response);

      const client = new ElevenLabsClient({ apiKey: mockApiKey });
      await client.generateVoice({ text: 'hello' });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.voice_settings.stability).toBe(0.5);
      expect(body.voice_settings.similarity_boost).toBe(0.75);
      expect(body.voice_settings.style).toBe(0);
    });

    it('uses eleven_multilingual_v2 model', async () => {
      const fakeBuffer = new Uint8Array([]).buffer;
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeBuffer),
      } as Response);

      const client = new ElevenLabsClient({ apiKey: mockApiKey });
      await client.generateVoice({ text: 'test' });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.model_id).toBe('eleven_multilingual_v2');
    });

    it('estimates duration from word count', async () => {
      const fakeBuffer = new Uint8Array([]).buffer;
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeBuffer),
      } as Response);

      const client = new ElevenLabsClient({ apiKey: mockApiKey });
      // 150 words → 60 seconds
      const words = Array(150).fill('word').join(' ');
      const result = await client.generateVoice({ text: words });

      expect(result.durationSeconds).toBe(60);
    });

    it('returns minimum 1 second duration for short text', async () => {
      const fakeBuffer = new Uint8Array([]).buffer;
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeBuffer),
      } as Response);

      const client = new ElevenLabsClient({ apiKey: mockApiKey });
      const result = await client.generateVoice({ text: 'Hi' });

      expect(result.durationSeconds).toBeGreaterThanOrEqual(1);
    });

    it('throws on invalid voiceId with path traversal', async () => {
      const client = new ElevenLabsClient({ apiKey: mockApiKey });
      await expect(
        client.generateVoice({ text: 'hello', voiceId: '../admin' })
      ).rejects.toThrow('Invalid resource ID');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('throws on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 402,
        text: () => Promise.resolve('Payment required'),
      } as Response);

      const client = new ElevenLabsClient({ apiKey: mockApiKey });
      await expect(client.generateVoice({ text: 'Hello there' })).rejects.toThrow(
        'ElevenLabs TTS API error (402): Payment required'
      );
    });

    it('falls back to "Unknown error" when response.text() rejects', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('no body')),
      } as unknown as Response);

      const client = new ElevenLabsClient({ apiKey: mockApiKey });
      await expect(client.generateVoice({ text: 'test' })).rejects.toThrow(
        'ElevenLabs TTS API error (500): Unknown error'
      );
    });
  });
});
