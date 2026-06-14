import { afterEach, describe, expect, it, vi } from 'vitest';

// PixelArtClient imports 'server-only'; stub it so this node-environment suite can
// import the client without tripping the Client Component guard.
vi.mock('server-only', () => ({}));

import { MeshyClient } from '@/lib/generate/meshyClient';
import { SunoClient } from '@/lib/generate/sunoClient';
import { ElevenLabsClient } from '@/lib/generate/elevenlabsClient';
import { SpriteClient } from '@/lib/generate/spriteClient';
import { PixelArtClient } from '@/lib/generate/pixelArtClient';

describe('generate clients SSRF guards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('anchors Meshy status URLs to api.meshy.ai', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'succeeded', progress: 1, model_urls: {}, thumbnail_url: '' }),
    } as Response);

    const client = new MeshyClient({ apiKey: 'key' });
    await client.getTaskStatus('safe_task-id');
    await client.getTextureStatus('safe_texture-id');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ origin: 'https://api.meshy.ai', pathname: '/openapi/v2/text-to-3d/safe_task-id' }),
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ origin: 'https://api.meshy.ai', pathname: '/openapi/v2/text-to-texture/safe_texture-id' }),
      expect.any(Object),
    );
  });

  it('anchors Suno status URLs to api.suno.ai', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'running', progress: 42 }),
    } as Response);

    const client = new SunoClient({ apiKey: 'key' });
    await client.getStatus('safe_task-id');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'https://api.suno.ai', pathname: '/v1/generation/safe_task-id' }),
      expect.any(Object),
    );
  });

  it('anchors ElevenLabs TTS URLs to api.elevenlabs.io', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    } as Response);

    const client = new ElevenLabsClient({ apiKey: 'key' });
    await client.generateVoice({ text: 'hello', voiceId: 'safe_voice-id' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'https://api.elevenlabs.io', pathname: '/v1/text-to-speech/safe_voice-id' }),
      expect.any(Object),
    );
  });

  it('anchors Replicate status URLs to api.replicate.com', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'succeeded', output: [] }),
    } as Response);

    const client = new SpriteClient('key', 'sdxl');
    await client.getReplicateStatus('safe_prediction-id');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'https://api.replicate.com', pathname: '/v1/predictions/safe_prediction-id' }),
      expect.any(Object),
    );
  });

  it('anchors PixelArt Replicate status URLs to api.replicate.com', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'succeeded', output: [] }),
    } as Response);

    const client = new PixelArtClient('key', 'replicate');
    await client.getReplicateStatus('safe_prediction-id');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'https://api.replicate.com', pathname: '/v1/predictions/safe_prediction-id' }),
      expect.any(Object),
    );
  });

  it('rejects a path-traversal jobId before any fetch (PixelArt + Sprite)', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'succeeded', output: [] }),
    } as Response);

    const pixelArt = new PixelArtClient('key', 'replicate');
    const sprite = new SpriteClient('key', 'sdxl');

    await expect(pixelArt.getReplicateStatus('../models/evil')).rejects.toThrow(/Invalid resource ID/);
    await expect(sprite.getReplicateStatus('../models/evil')).rejects.toThrow(/Invalid resource ID/);

    // Validation must throw BEFORE the authenticated request leaves the process.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
