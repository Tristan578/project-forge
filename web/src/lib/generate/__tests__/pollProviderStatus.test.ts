import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// Controllable provider-client doubles. pollProviderStatus constructs each
// client per call, so we drive their status methods directly.
const getTaskStatus = vi.fn();
const getTextureStatus = vi.fn();
vi.mock('@/lib/generate/meshyClient', () => ({
  MeshyClient: vi.fn(function (this: Record<string, unknown>) {
    this.getTaskStatus = getTaskStatus;
    this.getTextureStatus = getTextureStatus;
  }),
}));
const getReplicateStatus = vi.fn();
vi.mock('@/lib/generate/spriteClient', () => ({
  SpriteClient: vi.fn(function (this: Record<string, unknown>) { this.getReplicateStatus = getReplicateStatus; }),
}));

import { MeshyClient } from '@/lib/generate/meshyClient';
import { SpriteClient } from '@/lib/generate/spriteClient';
import { pollProviderStatus, ASYNC_TYPE_TO_DB_CAPABILITY, MUSIC_SYNC_TERMINAL_MESSAGE } from '../pollProviderStatus';
import { withRetryGuidance } from '@/lib/generate/retryGuidance';

const KEY = 'provider-key';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ASYNC_TYPE_TO_DB_CAPABILITY', () => {
  it('routes skybox to the texture provider and all sprite variants to sprite', () => {
    expect(ASYNC_TYPE_TO_DB_CAPABILITY).toEqual({
      model: 'model3d',
      texture: 'texture',
      skybox: 'texture',
      music: 'music',
      sprite: 'sprite',
      sprite_sheet: 'sprite',
      tileset: 'sprite',
    });
  });
});

describe('pollProviderStatus — model (Meshy 3D)', () => {
  it('SUCCEEDED with a glb url completes', async () => {
    getTaskStatus.mockResolvedValueOnce({ status: 'SUCCEEDED', progress: 100, modelUrls: { glb: 'https://x/m.glb' } });
    const r = await pollProviderStatus('model', 'job', KEY);
    expect(vi.mocked(MeshyClient)).toHaveBeenCalledWith({ apiKey: KEY });
    expect(r).toMatchObject({ status: 'completed', resultUrl: 'https://x/m.glb', succeededButEmpty: false });
  });

  it('SUCCEEDED without a glb maps to failed + succeededButEmpty (#8757)', async () => {
    getTaskStatus.mockResolvedValueOnce({ status: 'SUCCEEDED', progress: 100, modelUrls: undefined });
    const r = await pollProviderStatus('model', 'job', KEY);
    expect(r).toMatchObject({ status: 'failed', succeededButEmpty: true, errorMessage: withRetryGuidance('Model generation produced no file') });
  });

  it('FAILED and EXPIRED both map to failed (not succeededButEmpty)', async () => {
    for (const s of ['FAILED', 'EXPIRED']) {
      getTaskStatus.mockResolvedValueOnce({ status: s, progress: 0 });
      const r = await pollProviderStatus('model', 'job', KEY);
      expect(r).toMatchObject({ status: 'failed', succeededButEmpty: false });
    }
  });

  it('IN_PROGRESS maps to processing; anything else to pending', async () => {
    getTaskStatus.mockResolvedValueOnce({ status: 'IN_PROGRESS', progress: 40 });
    expect((await pollProviderStatus('model', 'job', KEY)).status).toBe('processing');
    getTaskStatus.mockResolvedValueOnce({ status: 'PENDING', progress: 0 });
    expect((await pollProviderStatus('model', 'job', KEY)).status).toBe('pending');
  });
});

describe('pollProviderStatus — texture (Meshy)', () => {
  it('SUCCEEDED with maps completes and carries resultMeta', async () => {
    const maps = { base_color: 'https://x/c.png', normal: 'https://x/n.png' };
    getTextureStatus.mockResolvedValueOnce({ status: 'SUCCEEDED', progress: 100, maps });
    const r = await pollProviderStatus('texture', 'job', KEY);
    expect(r).toMatchObject({ status: 'completed', resultMeta: maps, succeededButEmpty: false });
  });

  it('SUCCEEDED with an empty maps object is succeededButEmpty (Object.keys length 0)', async () => {
    getTextureStatus.mockResolvedValueOnce({ status: 'SUCCEEDED', progress: 100, maps: {} });
    const r = await pollProviderStatus('texture', 'job', KEY);
    expect(r).toMatchObject({ status: 'failed', succeededButEmpty: true, errorMessage: withRetryGuidance('Texture generation produced no maps') });
  });

  it('SUCCEEDED with no maps field is succeededButEmpty', async () => {
    getTextureStatus.mockResolvedValueOnce({ status: 'SUCCEEDED', progress: 100 });
    expect(await pollProviderStatus('texture', 'job', KEY)).toMatchObject({ status: 'failed', succeededButEmpty: true });
  });

  it('FAILED/EXPIRED map to failed (not empty); IN_PROGRESS to processing; else pending', async () => {
    for (const s of ['FAILED', 'EXPIRED']) {
      getTextureStatus.mockResolvedValueOnce({ status: s, progress: 0 });
      expect(await pollProviderStatus('texture', 'job', KEY)).toMatchObject({
        status: 'failed', succeededButEmpty: false, errorMessage: withRetryGuidance('Texture generation failed'),
      });
    }
    getTextureStatus.mockResolvedValueOnce({ status: 'IN_PROGRESS', progress: 60 });
    expect((await pollProviderStatus('texture', 'job', KEY)).status).toBe('processing');
    getTextureStatus.mockResolvedValueOnce({ status: 'PENDING', progress: 0 });
    expect((await pollProviderStatus('texture', 'job', KEY)).status).toBe('pending');
  });
});

describe('pollProviderStatus — skybox (Meshy single image)', () => {
  it('SUCCEEDED uses the first map value as the result url', async () => {
    getTextureStatus.mockResolvedValueOnce({ status: 'SUCCEEDED', progress: 100, maps: { sky: 'https://x/sky.png' } });
    const r = await pollProviderStatus('skybox', 'job', KEY);
    expect(r).toMatchObject({ status: 'completed', resultUrl: 'https://x/sky.png', succeededButEmpty: false });
  });

  it('SUCCEEDED with no image is succeededButEmpty', async () => {
    getTextureStatus.mockResolvedValueOnce({ status: 'SUCCEEDED', progress: 100, maps: {} });
    expect(await pollProviderStatus('skybox', 'job', KEY)).toMatchObject({
      status: 'failed', succeededButEmpty: true, errorMessage: withRetryGuidance('Skybox generation produced no image'),
    });
  });

  it('FAILED/EXPIRED map to failed (not empty); IN_PROGRESS to processing; else pending', async () => {
    for (const s of ['FAILED', 'EXPIRED']) {
      getTextureStatus.mockResolvedValueOnce({ status: s, progress: 0 });
      expect(await pollProviderStatus('skybox', 'job', KEY)).toMatchObject({
        status: 'failed', succeededButEmpty: false, errorMessage: withRetryGuidance('Skybox generation failed'),
      });
    }
    getTextureStatus.mockResolvedValueOnce({ status: 'IN_PROGRESS', progress: 60 });
    expect((await pollProviderStatus('skybox', 'job', KEY)).status).toBe('processing');
    getTextureStatus.mockResolvedValueOnce({ status: 'QUEUED', progress: 0 });
    expect((await pollProviderStatus('skybox', 'job', KEY)).status).toBe('pending');
  });
});

// #9522: music routes to ElevenLabs `/v1/music`, which returns audio inline —
// there is no async task to poll, so a music poll is a defensive terminal that
// makes no provider call and reports failed with the shared sync message.
describe('pollProviderStatus — music (ElevenLabs, synchronous)', () => {
  it('returns a terminal failed state without calling any provider client', async () => {
    const r = await pollProviderStatus('music', 'job', KEY);
    expect(r).toEqual({
      status: 'failed',
      progress: 0,
      succeededButEmpty: false,
      errorMessage: MUSIC_SYNC_TERMINAL_MESSAGE,
    });
    // No music status endpoint exists; the message carries retry guidance.
    expect(MUSIC_SYNC_TERMINAL_MESSAGE).toBe(
      withRetryGuidance('Music generation completes inline and has no job to poll'),
    );
  });
});

describe('pollProviderStatus — sprite / sprite_sheet / tileset (Replicate SDXL)', () => {
  it('constructs the SDXL sprite client and completes on output', async () => {
    getReplicateStatus.mockResolvedValueOnce({ status: 'succeeded', output: ['https://x/s.png'] });
    const r = await pollProviderStatus('sprite', 'pred', KEY);
    expect(vi.mocked(SpriteClient)).toHaveBeenCalledWith(KEY, 'sdxl');
    expect(r).toMatchObject({ status: 'completed', progress: 100, resultUrl: 'https://x/s.png' });
  });

  it('succeeded with empty output is succeededButEmpty with a per-type message', async () => {
    getReplicateStatus.mockResolvedValueOnce({ status: 'succeeded', output: [] });
    expect(await pollProviderStatus('sprite', 'p', KEY)).toMatchObject({
      status: 'failed', succeededButEmpty: true, errorMessage: withRetryGuidance('Sprite generation produced no image'),
    });
    getReplicateStatus.mockResolvedValueOnce({ status: 'succeeded', output: [] });
    expect(await pollProviderStatus('sprite_sheet', 'p', KEY)).toMatchObject({
      errorMessage: withRetryGuidance('Sprite sheet generation produced no image'),
    });
  });

  it('failed/canceled map to failed with a per-type message', async () => {
    getReplicateStatus.mockResolvedValueOnce({ status: 'canceled' });
    expect(await pollProviderStatus('tileset', 'p', KEY)).toMatchObject({
      status: 'failed', succeededButEmpty: false, errorMessage: withRetryGuidance('Tileset generation failed'),
    });
  });

  it('every Replicate type carries its own empty + failed message', async () => {
    const empty: Record<string, string> = {
      sprite: withRetryGuidance('Sprite generation produced no image'),
      sprite_sheet: withRetryGuidance('Sprite sheet generation produced no image'),
      tileset: withRetryGuidance('Tileset generation produced no image'),
    };
    const failed: Record<string, string> = {
      sprite: withRetryGuidance('Sprite generation failed'),
      sprite_sheet: withRetryGuidance('Sprite sheet generation failed'),
      tileset: withRetryGuidance('Tileset generation failed'),
    };
    for (const type of ['sprite', 'sprite_sheet', 'tileset'] as const) {
      getReplicateStatus.mockResolvedValueOnce({ status: 'succeeded', output: [] });
      expect(await pollProviderStatus(type, 'p', KEY)).toMatchObject({
        status: 'failed', succeededButEmpty: true, errorMessage: empty[type],
      });
      getReplicateStatus.mockResolvedValueOnce({ status: 'failed' });
      expect(await pollProviderStatus(type, 'p', KEY)).toMatchObject({
        status: 'failed', succeededButEmpty: false, errorMessage: failed[type],
      });
    }
  });

  it('processing maps to processing (50); unknown to pending (10)', async () => {
    getReplicateStatus.mockResolvedValueOnce({ status: 'processing' });
    expect(await pollProviderStatus('sprite', 'p', KEY)).toMatchObject({ status: 'processing', progress: 50 });
    getReplicateStatus.mockResolvedValueOnce({ status: 'starting' });
    expect(await pollProviderStatus('sprite', 'p', KEY)).toMatchObject({ status: 'pending', progress: 10 });
  });
});

describe('pollProviderStatus — transport errors propagate', () => {
  it('rethrows so the webhook returns 500 and QStash retries', async () => {
    getTaskStatus.mockRejectedValueOnce(new Error('network'));
    await expect(pollProviderStatus('model', 'job', KEY)).rejects.toThrow('network');
  });
});
