import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cutsceneHandlers } from '../cutsceneHandlers';
import { invokeHandler } from './handlerTestUtils';
import { useCutsceneStore } from '@/stores/cutsceneStore';
import type { Cutscene } from '@/stores/cutsceneStore';

// ---------------------------------------------------------------------------
// Mock the AI generator
// ---------------------------------------------------------------------------
vi.mock('@/lib/ai/cutsceneGenerator', () => ({
  generateCutscene: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock the player so rAF doesn't execute in tests
// ---------------------------------------------------------------------------
const mockLoad = vi.fn();
const mockPlay = vi.fn();

class MockCutscenePlayer {
  load = mockLoad;
  play = mockPlay;
  constructor(_options: unknown) {}
}

vi.mock('@/lib/cutscene/player', () => ({
  CutscenePlayer: MockCutscenePlayer,
}));

function makeCutscene(id = 'cs1'): Cutscene {
  return {
    id,
    name: 'Test Cutscene',
    duration: 8,
    tracks: [{ id: 't1', type: 'camera', entityId: null, keyframes: [], muted: false }],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCutsceneStore.setState({
    cutscenes: {},
    activeCutsceneId: null,
    playbackState: 'idle',
    playbackTime: 0,
  });
});

// ============================================================================
// generate_cutscene
// ============================================================================

describe('generate_cutscene', () => {
  it('returns success with cutsceneId when AI generation succeeds', async () => {
    const { generateCutscene } = await import('@/lib/ai/cutsceneGenerator');
    const cs = makeCutscene('cs_gen');
    (generateCutscene as ReturnType<typeof vi.fn>).mockResolvedValue(cs);

    const { result } = await invokeHandler(cutsceneHandlers, 'generate_cutscene', {
      prompt: 'Dramatic intro pan',
      duration: 8,
    });

    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.cutsceneId).toBe('cs_gen');
    expect(r.trackCount).toBe(1);
  });

  it('stores the cutscene in the store', async () => {
    const { generateCutscene } = await import('@/lib/ai/cutsceneGenerator');
    const cs = makeCutscene('cs_stored');
    (generateCutscene as ReturnType<typeof vi.fn>).mockResolvedValue(cs);

    await invokeHandler(cutsceneHandlers, 'generate_cutscene', { prompt: 'Test' });

    expect(useCutsceneStore.getState().cutscenes['cs_stored']).toBeDefined();
  });

  it('returns failure when prompt is empty', async () => {
    const { result } = await invokeHandler(cutsceneHandlers, 'generate_cutscene', { prompt: '' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments');
  });

  it('returns failure when prompt is missing', async () => {
    const { result } = await invokeHandler(cutsceneHandlers, 'generate_cutscene', {});
    expect(result.success).toBe(false);
  });

  it('returns failure when duration exceeds 60', async () => {
    const { result } = await invokeHandler(cutsceneHandlers, 'generate_cutscene', {
      prompt: 'Test',
      duration: 120,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments');
  });

  it('wraps AI errors in a failure result', async () => {
    const { generateCutscene } = await import('@/lib/ai/cutsceneGenerator');
    (generateCutscene as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Rate limit'));

    const { result } = await invokeHandler(cutsceneHandlers, 'generate_cutscene', { prompt: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Rate limit');
  });
});

// ============================================================================
// play_cutscene
// ============================================================================

describe('play_cutscene', () => {
  it('returns success and calls player.load and player.play', async () => {
    useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));

    const dispatchCommand = vi.fn();
    const store = { sceneGraph: {} } as unknown as import('../types').ToolCallContext['store'];
    const result = await cutsceneHandlers['play_cutscene'](
      { cutsceneId: 'cs1' },
      { store, dispatchCommand },
    );

    expect(result.success).toBe(true);
    expect(mockLoad).toHaveBeenCalledOnce();
    expect(mockPlay).toHaveBeenCalledOnce();
  });

  it('dispatches play command', async () => {
    useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
    const dispatchCommand = vi.fn();
    const store = { sceneGraph: {} } as unknown as import('../types').ToolCallContext['store'];

    await cutsceneHandlers['play_cutscene'](
      { cutsceneId: 'cs1' },
      { store, dispatchCommand },
    );

    expect(dispatchCommand).toHaveBeenCalledWith('play', {});
  });

  it('sets activeCutsceneId in the store', async () => {
    useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
    const dispatchCommand = vi.fn();
    const store = { sceneGraph: {} } as unknown as import('../types').ToolCallContext['store'];

    await cutsceneHandlers['play_cutscene'](
      { cutsceneId: 'cs1' },
      { store, dispatchCommand },
    );

    expect(useCutsceneStore.getState().activeCutsceneId).toBe('cs1');
  });

  it('returns failure for unknown cutscene', async () => {
    const { result } = await invokeHandler(cutsceneHandlers, 'play_cutscene', {
      cutsceneId: 'nonexistent',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns failure when cutsceneId is missing', async () => {
    const { result } = await invokeHandler(cutsceneHandlers, 'play_cutscene', {});
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// stop_cutscene
// ============================================================================

describe('stop_cutscene', () => {
  it('stops when a cutscene is playing', async () => {
    useCutsceneStore.setState({ playbackState: 'playing', activeCutsceneId: 'cs1', playbackTime: 3 });
    const dispatchCommand = vi.fn();
    const store = {} as unknown as import('../types').ToolCallContext['store'];

    const result = await cutsceneHandlers['stop_cutscene'](
      {},
      { store, dispatchCommand },
    );

    expect(result.success).toBe(true);
    expect(useCutsceneStore.getState().playbackState).toBe('stopped');
    expect(useCutsceneStore.getState().activeCutsceneId).toBeNull();
    expect(useCutsceneStore.getState().playbackTime).toBe(0);
    expect(dispatchCommand).toHaveBeenCalledWith('stop', {});
  });

  it('returns failure when nothing is playing', async () => {
    const { result } = await invokeHandler(cutsceneHandlers, 'stop_cutscene', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('No cutscene');
  });
});

// ============================================================================
// list_cutscenes
// ============================================================================

describe('list_cutscenes', () => {
  it('returns empty list when no cutscenes', async () => {
    const { result } = await invokeHandler(cutsceneHandlers, 'list_cutscenes', {});
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.cutscenes).toEqual([]);
    expect(r.count).toBe(0);
  });

  it('returns all cutscenes with summary fields', async () => {
    useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
    useCutsceneStore.getState().addCutscene(makeCutscene('cs2'));

    const { result } = await invokeHandler(cutsceneHandlers, 'list_cutscenes', {});
    const r = result.result as Record<string, unknown>;
    expect((r.cutscenes as unknown[]).length).toBe(2);
    expect(r.count).toBe(2);

    const list = r.cutscenes as Array<Record<string, unknown>>;
    const ids = list.map((c) => c.id);
    expect(ids).toContain('cs1');
    expect(ids).toContain('cs2');
  });

  it('each summary has id, name, duration, trackCount', async () => {
    useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
    const { result } = await invokeHandler(cutsceneHandlers, 'list_cutscenes', {});
    const list = (result.result as Record<string, unknown>).cutscenes as Array<Record<string, unknown>>;
    const summary = list[0];
    expect(summary).toHaveProperty('id');
    expect(summary).toHaveProperty('name');
    expect(summary).toHaveProperty('duration');
    expect(summary).toHaveProperty('trackCount');
  });
});

// ============================================================================
// delete_cutscene
// ============================================================================

describe('delete_cutscene', () => {
  it('deletes an existing cutscene', async () => {
    useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
    const { result } = await invokeHandler(cutsceneHandlers, 'delete_cutscene', { cutsceneId: 'cs1' });

    expect(result.success).toBe(true);
    expect(useCutsceneStore.getState().cutscenes['cs1']).toBeUndefined();
  });

  it('returns failure for unknown cutscene', async () => {
    const { result } = await invokeHandler(cutsceneHandlers, 'delete_cutscene', { cutsceneId: 'unknown' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns failure when cutsceneId is missing', async () => {
    const { result } = await invokeHandler(cutsceneHandlers, 'delete_cutscene', {});
    expect(result.success).toBe(false);
  });
});
