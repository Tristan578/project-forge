// @vitest-environment jsdom
/**
 * Tests for generationHandlers — AI asset generation commands.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMockStore } from './handlerTestUtils';
import { generationHandlers } from '../generationHandlers';

// ---------------------------------------------------------------------------
// Mock generationStore
// ---------------------------------------------------------------------------
const mockAddJob = vi.fn();
const mockUpdateJob = vi.fn();
const mockGenJobs: Record<string, Record<string, unknown>> = {};

vi.mock('@/stores/generationStore', () => ({
  useGenerationStore: {
    getState: () => ({
      addJob: mockAddJob,
      updateJob: mockUpdateJob,
      jobs: mockGenJobs,
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock prompt enrichers
// ---------------------------------------------------------------------------
vi.mock('@/lib/generate/promptEnricher', () => ({
  enrichPrompt: vi.fn((_prompt: string, _type: string, _store: unknown) => 'enriched-prompt'),
  enrichSfxPrompt: vi.fn((_prompt: string, _entityName: string | undefined, _store: unknown) => 'enriched-sfx'),
  enrichMusicPrompt: vi.fn((_prompt: string, _store: unknown) => 'enriched-music'),
  enrichVoiceStyle: vi.fn((_speaker: string | undefined, _style: string) => 'enriched-voice-style'),
}));

// ---------------------------------------------------------------------------
// Mock post-processing
// ---------------------------------------------------------------------------
vi.mock('@/lib/generate/postProcess', () => ({
  inferSfxCategory: vi.fn().mockReturnValue('impact'),
  getSpatialDefaults: vi.fn().mockReturnValue({
    volume: 1.0,
    loopAudio: false,
    spatial: true,
    maxDistance: 50,
    refDistance: 1,
    rolloffFactor: 1,
  }),
}));

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();

beforeAll(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function makeGenStore(overrides: Record<string, unknown> = {}) {
  return {
    sceneGraph: {
      nodes: {
        'ent-1': { name: 'Player' },
      } as Record<string, { name: string }>,
      rootIds: [],
    },
    importAudio: vi.fn(),
    setAudio: vi.fn(),
    setCustomSkybox: vi.fn(),
    ...overrides,
  };
}

async function invoke(
  name: string,
  args: Record<string, unknown> = {},
  storeOverrides: Record<string, unknown> = {},
) {
  const store = createMockStore({ ...makeGenStore(), ...storeOverrides });
  const result = await generationHandlers[name](args, {
    store,
    dispatchCommand: vi.fn(),
  });
  return { result, store };
}

function mockFetchSuccess(data: Record<string, unknown> = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({
      jobId: 'job-123',
      estimatedSeconds: 30,
      provider: 'meshy',
      usageId: 'usage-1',
      ...data,
    }),
  });
}

function mockFetchFailure(error = 'Provider error') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    json: () => Promise.resolve({ error }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Clear jobs
  Object.keys(mockGenJobs).forEach(k => delete mockGenJobs[k]);
});

// ===========================================================================
// generate_3d_model
// ===========================================================================
describe('generationHandlers', () => {
  describe('generate_3d_model', () => {
    it('calls API and tracks job', async () => {
      mockFetchSuccess();
      const { result } = await invoke('generate_3d_model', { prompt: 'a sword' });
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('/api/generate/model', expect.objectContaining({
        method: 'POST',
      }));
      expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({
        type: 'model',
        prompt: 'a sword',
        status: 'pending',
        provider: 'meshy',
      }));
      const r = result.result as Record<string, unknown>;
      expect(r.jobId).toBe('job-123');
    });

    it('passes quality and artStyle', async () => {
      mockFetchSuccess();
      await invoke('generate_3d_model', {
        prompt: 'a shield',
        quality: 'high',
        artStyle: 'cartoon',
        negativePrompt: 'no skulls',
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.quality).toBe('high');
      expect(body.artStyle).toBe('cartoon');
      expect(body.negativePrompt).toBe('no skulls');
    });

    it('returns error on API failure', async () => {
      mockFetchFailure('Rate limited');
      const { result } = await invoke('generate_3d_model', { prompt: 'a sword' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limited');
    });

    it('fails without prompt', async () => {
      const { result } = await invoke('generate_3d_model', {});
      expect(result.success).toBe(false);
    });

    it('defaults autoPlace to true when not specified', async () => {
      mockFetchSuccess();
      await invoke('generate_3d_model', { prompt: 'a sword' });
      expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({
        autoPlace: true,
      }));
    });

    it('respects explicit autoPlace: false', async () => {
      mockFetchSuccess();
      await invoke('generate_3d_model', { prompt: 'a sword', autoPlace: false });
      expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({
        autoPlace: false,
      }));
    });

    it('passes targetEntityId from entityId param', async () => {
      mockFetchSuccess();
      await invoke('generate_3d_model', { prompt: 'a sword', entityId: 'ent-1' });
      expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({
        targetEntityId: 'ent-1',
      }));
    });
  });

  // =========================================================================
  // generate_3d_from_image
  // =========================================================================
  describe('generate_3d_from_image', () => {
    it('sends image to API', async () => {
      mockFetchSuccess();
      const { result } = await invoke('generate_3d_from_image', {
        imageBase64: 'base64data',
        prompt: 'refine this model',
      });
      expect(result.success).toBe(true);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.imageBase64).toBe('base64data');
    });

    it('works without optional prompt', async () => {
      mockFetchSuccess();
      const { result } = await invoke('generate_3d_from_image', { imageBase64: 'data' });
      expect(result.success).toBe(true);
    });

    it('fails without imageBase64', async () => {
      const { result } = await invoke('generate_3d_from_image', {});
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // generate_texture
  // =========================================================================
  describe('generate_texture', () => {
    it('generates texture with defaults', async () => {
      mockFetchSuccess();
      const { result } = await invoke('generate_texture', { prompt: 'brick wall' });
      expect(result.success).toBe(true);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.resolution).toBe('1024');
      expect(body.style).toBe('realistic');
      expect(body.tiling).toBe(false);
    });

    it('passes entityId and custom options', async () => {
      mockFetchSuccess();
      await invoke('generate_texture', {
        prompt: 'grass',
        entityId: 'ent-1',
        resolution: '2048',
        style: 'cartoon',
        tiling: true,
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.entityId).toBe('ent-1');
      expect(body.resolution).toBe('2048');
      expect(body.tiling).toBe(true);
    });

    it('returns error on API failure', async () => {
      mockFetchFailure('Quota exceeded');
      const { result } = await invoke('generate_texture', { prompt: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Quota exceeded');
    });

    it('rejects empty materialSlot string via validation', async () => {
      const { result } = await invoke('generate_texture', { prompt: 'rock', entityId: 'ent-1', materialSlot: '' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('accepts valid materialSlot', async () => {
      mockFetchSuccess();
      await invoke('generate_texture', { prompt: 'rock', entityId: 'ent-1', materialSlot: 'normal_map' });
      expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({
        materialSlot: 'normal_map',
      }));
    });

    it('rejects invalid materialSlot', async () => {
      const { result } = await invoke('generate_texture', {
        prompt: 'rock',
        entityId: 'ent-1',
        materialSlot: 'diffuse',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid materialSlot');
    });

    it('defaults autoPlace to true when entityId is set', async () => {
      mockFetchSuccess();
      await invoke('generate_texture', { prompt: 'rock', entityId: 'ent-1' });
      expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({
        autoPlace: true,
      }));
    });

    it('defaults autoPlace to false when no entityId', async () => {
      mockFetchSuccess();
      await invoke('generate_texture', { prompt: 'rock' });
      expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({
        autoPlace: false,
      }));
    });
  });

  // =========================================================================
  // generate_pbr_maps
  // =========================================================================
  describe('generate_pbr_maps', () => {
    it('generates PBR maps', async () => {
      mockFetchSuccess();
      const { result } = await invoke('generate_pbr_maps', {
        prompt: 'metal surface',
        entityId: 'ent-1',
      });
      expect(result.success).toBe(true);
      expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({
        type: 'texture',
      }));
    });

    it('fails without prompt', async () => {
      const { result } = await invoke('generate_pbr_maps', {});
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // generate_sfx
  // =========================================================================
  describe('generate_sfx', () => {
    it('generates SFX and attaches to entity', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ audioBase64: 'base64audio' }),
      });
      const { result, store } = await invoke('generate_sfx', {
        prompt: 'explosion',
        entityId: 'ent-1',
      });
      expect(result.success).toBe(true);
      expect(store.importAudio).toHaveBeenCalledWith('base64audio', expect.stringContaining('sfx-'));
      expect(store.setAudio).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        bus: 'sfx',
      }));
    });

    it('generates SFX without entity attachment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ audioBase64: 'base64audio' }),
      });
      const { result, store } = await invoke('generate_sfx', { prompt: 'boom' });
      expect(result.success).toBe(true);
      expect(store.importAudio).toHaveBeenCalled();
      expect(store.setAudio).not.toHaveBeenCalled();
    });

    it('uses custom duration', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ audioBase64: 'base64audio' }),
      });
      await invoke('generate_sfx', { prompt: 'boom', durationSeconds: 10 });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.durationSeconds).toBe(10);
    });

    it('returns error on API failure', async () => {
      mockFetchFailure('No provider');
      const { result } = await invoke('generate_sfx', { prompt: 'boom' });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // generate_voice
  // =========================================================================
  describe('generate_voice', () => {
    it('generates voice and attaches to entity', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ audioBase64: 'base64voice' }),
      });
      const { result, store } = await invoke('generate_voice', {
        text: 'Hello, adventurer!',
        entityId: 'ent-1',
        speaker: 'NPC_Guard',
        voiceStyle: 'gruff',
      });
      expect(result.success).toBe(true);
      expect(store.importAudio).toHaveBeenCalledWith('base64voice', expect.stringContaining('voice-'));
      expect(store.setAudio).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        bus: 'voice',
      }));
    });

    it('works without entity attachment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ audioBase64: 'base64voice' }),
      });
      const { result, store } = await invoke('generate_voice', { text: 'Hello' });
      expect(result.success).toBe(true);
      expect(store.setAudio).not.toHaveBeenCalled();
    });

    it('fails without text', async () => {
      const { result } = await invoke('generate_voice', {});
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // generate_skybox
  // =========================================================================
  describe('generate_skybox', () => {
    it('generates skybox', async () => {
      mockFetchSuccess();
      const { result } = await invoke('generate_skybox', { prompt: 'sunset over ocean' });
      expect(result.success).toBe(true);
      expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({
        type: 'skybox',
      }));
    });

    it('passes style option', async () => {
      mockFetchSuccess();
      await invoke('generate_skybox', { prompt: 'night sky', style: 'stylized' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.style).toBe('stylized');
    });
  });

  // =========================================================================
  // generate_music
  // =========================================================================
  describe('generate_music', () => {
    it('imports audio directly when sync response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ audioBase64: 'base64music' }),
      });
      const { result, store } = await invoke('generate_music', {
        prompt: 'epic battle theme',
        entityId: 'ent-1',
      });
      expect(result.success).toBe(true);
      expect(store.importAudio).toHaveBeenCalledWith('base64music', expect.stringContaining('music-'));
      expect(store.setAudio).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        bus: 'music',
        loopAudio: true,
        autoplay: true,
      }));
    });

    it('tracks async job when no audioBase64', async () => {
      mockFetchSuccess({ audioBase64: undefined });
      const { result } = await invoke('generate_music', { prompt: 'calm ambient' });
      expect(result.success).toBe(true);
      expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({
        type: 'music',
      }));
    });

    it('uses default duration and instrumental', async () => {
      mockFetchSuccess();
      await invoke('generate_music', { prompt: 'battle' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.durationSeconds).toBe(30);
      expect(body.instrumental).toBe(true);
    });

    it('passes autoPlace and targetEntityId to trackJob on async path', async () => {
      mockFetchSuccess({ audioBase64: undefined });
      await invoke('generate_music', {
        prompt: 'boss theme',
        targetEntityId: 'ent-2',
        autoPlace: true,
      });
      expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({
        type: 'music',
        autoPlace: true,
        targetEntityId: 'ent-2',
      }));
    });

    it('autoPlace defaults to true when targetEntityId is set (async)', async () => {
      mockFetchSuccess({ audioBase64: undefined });
      await invoke('generate_music', { prompt: 'ambient', targetEntityId: 'ent-3' });
      expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({
        autoPlace: true,
        targetEntityId: 'ent-3',
      }));
    });

    it('autoPlace defaults to false when no entity (async)', async () => {
      mockFetchSuccess({ audioBase64: undefined });
      await invoke('generate_music', { prompt: 'ambient loop' });
      expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({
        autoPlace: false,
      }));
    });
  });

  // =========================================================================
  // generate_sprite
  // =========================================================================
  describe('generate_sprite', () => {
    it('generates sprite', async () => {
      mockFetchSuccess();
      const { result } = await invoke('generate_sprite', { prompt: 'pixel knight' });
      expect(result.success).toBe(true);
      expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({
        type: 'sprite',
      }));
    });

    it('uses defaults for size and removeBackground', async () => {
      mockFetchSuccess();
      await invoke('generate_sprite', { prompt: 'coin' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.size).toBe('64x64');
      expect(body.removeBackground).toBe(true);
    });
  });

  // =========================================================================
  // generate_sprite_sheet
  // =========================================================================
  describe('generate_sprite_sheet', () => {
    it('generates sprite sheet', async () => {
      mockFetchSuccess();
      const { result } = await invoke('generate_sprite_sheet', {
        sourceAssetId: 'asset-knight',
        frameCount: 8,
      });
      expect(result.success).toBe(true);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.frameCount).toBe(8);
      expect(body.sourceAssetId).toBe('asset-knight');
    });

    it('uses defaults', async () => {
      mockFetchSuccess();
      await invoke('generate_sprite_sheet', { sourceAssetId: 'asset-1' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.frameCount).toBe(4);
      expect(body.size).toBe('64x64');
    });

    it('fails without sourceAssetId', async () => {
      const { result } = await invoke('generate_sprite_sheet', {});
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // generate_character
  // =========================================================================
  describe('generate_character', () => {
    it('generates poses as separate jobs', async () => {
      mockFetchSuccess();
      mockFetchSuccess();
      const { result } = await invoke('generate_character', {
        prompt: 'warrior',
        poses: ['idle', 'attack'],
      });
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const r = result.result as Record<string, unknown>;
      expect((r.jobIds as string[]).length).toBe(2);
    });

    it('returns error when all poses fail', async () => {
      mockFetchFailure('API down');
      mockFetchFailure('API down');
      const { result } = await invoke('generate_character', {
        prompt: 'warrior',
        poses: ['idle', 'attack'],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to start');
    });

    it('partially succeeds when some poses fail', async () => {
      mockFetchSuccess();
      mockFetchFailure('timeout');
      const { result } = await invoke('generate_character', {
        prompt: 'warrior',
        poses: ['idle', 'attack'],
      });
      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect((r.jobIds as string[]).length).toBe(1);
    });

    it('fails without poses', async () => {
      const { result } = await invoke('generate_character', { prompt: 'warrior' });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // generate_tileset
  // =========================================================================
  describe('generate_tileset', () => {
    it('generates tileset', async () => {
      mockFetchSuccess();
      const { result } = await invoke('generate_tileset', { prompt: 'dungeon tiles' });
      expect(result.success).toBe(true);
      expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({
        type: 'tileset',
      }));
    });

    it('uses defaults for tileSize and gridSize', async () => {
      mockFetchSuccess();
      await invoke('generate_tileset', { prompt: 'grass' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tileSize).toBe(32);
      expect(body.gridSize).toBe('8x8');
    });
  });

  // =========================================================================
  // Status endpoints
  // =========================================================================
  describe('get_generation_status', () => {
    it('queries status by type', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          status: 'completed',
          progress: 100,
          resultUrl: 'https://cdn.example.com/model.glb',
        }),
      });
      const { result } = await invoke('get_generation_status', {
        jobId: 'job-123',
        type: 'model',
      });
      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.status).toBe('completed');
      expect(r.resultUrl).toBe('https://cdn.example.com/model.glb');
    });

    it('falls back to trying all endpoints when no type', async () => {
      // First endpoint fails
      mockFetch.mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) });
      // Second endpoint succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'processing', progress: 50 }),
      });
      const { result } = await invoke('get_generation_status', { jobId: 'job-456' });
      expect(result.success).toBe(true);
    });

    it('returns error when job not found anywhere', async () => {
      // Mock all status endpoints to fail
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) });
      }
      const { result } = await invoke('get_generation_status', { jobId: 'bad-id' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not find');
    });

    it('fails without jobId', async () => {
      const { result } = await invoke('get_generation_status', {});
      expect(result.success).toBe(false);
    });
  });

  describe('get_sprite_generation_status', () => {
    it('queries sprite status endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'pending', progress: 0 }),
      });
      const { result } = await invoke('get_sprite_generation_status', { jobId: 'sprite-job-1' });
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/generate/sprite/status'),
      );
    });
  });

  // =========================================================================
  // Utility commands
  // =========================================================================
  describe('remove_background', () => {
    it('returns guidance when API fails', async () => {
      mockFetchFailure('Not supported');
      const { result } = await invoke('remove_background', { assetId: 'asset-1' });
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).message).toContain('generate_sprite');
    });

    it('returns jobId when API succeeds', async () => {
      mockFetchSuccess();
      const { result } = await invoke('remove_background', { assetId: 'asset-1' });
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).jobId).toBe('job-123');
    });

    it('fails without assetId', async () => {
      const { result } = await invoke('remove_background', {});
      expect(result.success).toBe(false);
    });
  });

  describe('apply_style_transfer', () => {
    it('returns suggestion instead of performing transfer', async () => {
      const { result } = await invoke('apply_style_transfer', {
        assetId: 'asset-1',
        targetStyle: 'watercolor',
      });
      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect((r.message as string)).toContain('not available');
      expect((r.suggestion as Record<string, unknown>).command).toBe('generate_texture');
    });

    it('fails without targetStyle', async () => {
      const { result } = await invoke('apply_style_transfer', { assetId: 'asset-1' });
      expect(result.success).toBe(false);
    });
  });

  describe('set_project_style', () => {
    it('sets style preset', async () => {
      const { result } = await invoke('set_project_style', { preset: 'pixel-art' });
      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.style).toBe('pixel-art');
    });

    it('fails without preset', async () => {
      const { result } = await invoke('set_project_style', {});
      expect(result.success).toBe(false);
    });
  });
});
