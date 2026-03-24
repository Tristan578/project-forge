import { describe, it, expect, vi } from 'vitest';
import {
  buildCutscenePrompt,
  parseCutsceneResponse,
  generateCutscene,
  type CutsceneGenerationOptions,
} from '../cutsceneGenerator';

// ============================================================================
// buildCutscenePrompt
// ============================================================================

describe('buildCutscenePrompt', () => {
  const base: CutsceneGenerationOptions = {
    prompt: 'Pan from sky to player',
    sceneEntities: [
      { id: 'e1', name: 'Player', type: 'cube' },
      { id: 'e2', name: 'Wizard', type: 'sphere' },
    ],
    duration: 10,
  };

  it('includes the prompt text', () => {
    const result = buildCutscenePrompt(base);
    expect(result).toContain('Pan from sky to player');
  });

  it('includes the duration', () => {
    const result = buildCutscenePrompt(base);
    expect(result).toContain('10 seconds');
  });

  it('clamps duration to 60 seconds max', () => {
    const result = buildCutscenePrompt({ ...base, duration: 999 });
    expect(result).toContain('60 seconds');
    expect(result).not.toContain('999 seconds');
  });

  it('defaults duration to 10 when not specified', () => {
    const result = buildCutscenePrompt({ prompt: 'Test', sceneEntities: [] });
    expect(result).toContain('10 seconds');
  });

  it('lists entity IDs and names', () => {
    const result = buildCutscenePrompt(base);
    expect(result).toContain('"e1"');
    expect(result).toContain('Player');
    expect(result).toContain('"e2"');
    expect(result).toContain('Wizard');
  });

  it('handles empty entity list gracefully', () => {
    const result = buildCutscenePrompt({ prompt: 'Test', sceneEntities: [] });
    expect(result).toContain('(no entities');
  });

  it('includes JSON schema instructions', () => {
    const result = buildCutscenePrompt(base);
    expect(result).toContain('"tracks"');
    expect(result).toContain('"keyframes"');
  });
});

// ============================================================================
// parseCutsceneResponse
// ============================================================================

const VALID_RESPONSE = JSON.stringify({
  name: 'Sky Pan',
  duration: 8,
  tracks: [
    {
      id: 'track_1',
      type: 'camera',
      entityId: null,
      muted: false,
      keyframes: [
        { timestamp: 0, duration: 3, easing: 'ease_out', payload: { mode: 'Orbital' } },
        { timestamp: 4, duration: 2, easing: 'linear', payload: { mode: 'ThirdPerson' } },
      ],
    },
    {
      id: 'track_2',
      type: 'dialogue',
      entityId: 'npc1',
      muted: false,
      keyframes: [
        { timestamp: 5, duration: 2, easing: 'linear', payload: { treeId: 'greeting' } },
      ],
    },
  ],
});

describe('parseCutsceneResponse', () => {
  it('parses a valid response', () => {
    const result = parseCutsceneResponse(VALID_RESPONSE);
    expect(result.name).toBe('Sky Pan');
    expect(result.duration).toBe(8);
    expect(result.tracks).toHaveLength(2);
  });

  it('strips markdown code fences', () => {
    const fenced = '```json\n' + VALID_RESPONSE + '\n```';
    const result = parseCutsceneResponse(fenced);
    expect(result.name).toBe('Sky Pan');
  });

  it('strips generic code fences', () => {
    const fenced = '```\n' + VALID_RESPONSE + '\n```';
    const result = parseCutsceneResponse(fenced);
    expect(result.name).toBe('Sky Pan');
  });

  it('clamps duration to 60', () => {
    const over = JSON.stringify({ ...JSON.parse(VALID_RESPONSE), duration: 200 });
    const result = parseCutsceneResponse(over);
    expect(result.duration).toBe(60);
  });

  it('throws on non-JSON input', () => {
    expect(() => parseCutsceneResponse('not json')).toThrow();
  });

  it('throws when name is missing', () => {
    const bad = JSON.stringify({ duration: 5, tracks: [{ id: 't1', type: 'wait', entityId: null, muted: false, keyframes: [] }] });
    expect(() => parseCutsceneResponse(bad)).toThrow(/name/i);
  });

  it('throws when duration is zero', () => {
    const bad = JSON.stringify({ name: 'X', duration: 0, tracks: [{ id: 't1', type: 'wait', entityId: null, muted: false, keyframes: [] }] });
    expect(() => parseCutsceneResponse(bad)).toThrow(/duration/i);
  });

  it('throws when tracks array is empty', () => {
    const bad = JSON.stringify({ name: 'X', duration: 5, tracks: [] });
    expect(() => parseCutsceneResponse(bad)).toThrow(/track/i);
  });

  it('throws when a track has an invalid type', () => {
    const bad = JSON.stringify({
      name: 'X', duration: 5,
      tracks: [{ id: 't1', type: 'invalid_type', entityId: null, muted: false, keyframes: [] }],
    });
    expect(() => parseCutsceneResponse(bad)).toThrow(/type/i);
  });

  it('throws when a keyframe has non-finite timestamp', () => {
    const bad = JSON.stringify({
      name: 'X', duration: 5,
      tracks: [{
        id: 't1', type: 'camera', entityId: null, muted: false,
        keyframes: [{ timestamp: 'oops', duration: 1, easing: 'linear', payload: {} }],
      }],
    });
    expect(() => parseCutsceneResponse(bad)).toThrow(/timestamp/i);
  });

  it('throws when a keyframe has negative duration', () => {
    const bad = JSON.stringify({
      name: 'X', duration: 5,
      tracks: [{
        id: 't1', type: 'camera', entityId: null, muted: false,
        keyframes: [{ timestamp: 0, duration: -1, easing: 'linear', payload: {} }],
      }],
    });
    expect(() => parseCutsceneResponse(bad)).toThrow(/duration/i);
  });

  it('defaults unknown easing to linear', () => {
    const raw = JSON.stringify({
      name: 'X', duration: 5,
      tracks: [{
        id: 't1', type: 'wait', entityId: null, muted: false,
        keyframes: [{ timestamp: 0, duration: 1, easing: 'bouncy', payload: {} }],
      }],
    });
    const result = parseCutsceneResponse(raw);
    expect(result.tracks[0].keyframes[0].easing).toBe('linear');
  });

  it('defaults missing payload to empty object', () => {
    const raw = JSON.stringify({
      name: 'X', duration: 5,
      tracks: [{
        id: 't1', type: 'wait', entityId: null, muted: false,
        keyframes: [{ timestamp: 0, duration: 1, easing: 'linear' }],
      }],
    });
    const result = parseCutsceneResponse(raw);
    expect(result.tracks[0].keyframes[0].payload).toEqual({});
  });
});

// ============================================================================
// generateCutscene (integration — mocked fetchAI)
// ============================================================================

vi.mock('@/lib/ai/client', () => ({
  fetchAI: vi.fn(),
}));

describe('generateCutscene', () => {
  it('returns a Cutscene with id and timestamps', async () => {
    const { fetchAI } = await import('@/lib/ai/client');
    (fetchAI as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_RESPONSE);

    const result = await generateCutscene({
      prompt: 'Pan from sky',
      sceneEntities: [],
      duration: 8,
    });

    expect(result.id).toMatch(/^cutscene_/);
    expect(result.name).toBe('Sky Pan');
    expect(result.duration).toBe(8);
    expect(result.tracks).toHaveLength(2);
    expect(typeof result.createdAt).toBe('number');
    expect(typeof result.updatedAt).toBe('number');
  });

  it('propagates fetchAI errors', async () => {
    const { fetchAI } = await import('@/lib/ai/client');
    (fetchAI as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Rate limit'));

    await expect(
      generateCutscene({ prompt: 'Test', sceneEntities: [] }),
    ).rejects.toThrow('Rate limit');
  });
});
