import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});
import {
  buildCutscenePrompt,
  parseCutsceneResponse,
  generateCutscene,
  type CutsceneGenerationOptions,
} from '../cutsceneGenerator';
import { getKeyframePayloadFields } from '@/lib/cutscene/keyframePayload';
import { CUTSCENE_TRACK_TYPES } from '@/stores/cutsceneStore';

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
      // A camera track names the camera entity it configures, and its payload
      // speaks the one real camera vocabulary (`GameCameraMode` + the authoring
      // params `buildSetGameCameraPayload` translates). `entityId: null` or a
      // PascalCase mode both make `buildCommand` return null.
      entityId: 'cam1',
      muted: false,
      keyframes: [
        { timestamp: 0, duration: 3, easing: 'ease_out', payload: { mode: 'orbital', orbitalDistance: 12 } },
        { timestamp: 4, duration: 2, easing: 'linear', payload: { mode: 'thirdPersonFollow', followDistance: 6 } },
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

// ============================================================================
// Prompt <-> payload schema parity
// ============================================================================

/**
 * Read the field names the prompt asks the model to write, per track type.
 *
 * The prompt names a field two ways: `"name":` in a payload schema, and — for
 * camera, whose parameters depend on the mode — bare quoted names on the
 * indented per-mode lines. Quoted VALUE descriptions (`"string|null"`) are
 * neither, so they are excluded by construction rather than by a stop-list.
 */
function promptFieldsByTrack(prompt: string): Record<string, Set<string>> {
  const section = prompt.split('Track type payload schemas:')[1]?.split('\nRules:')[0];
  if (!section) throw new Error('prompt no longer documents payload schemas');

  const byTrack: Record<string, Set<string>> = {};
  let current: Set<string> | null = null;

  for (const line of section.split('\n')) {
    const trackStart = /^- (\w+):/.exec(line);
    if (trackStart) {
      current = new Set<string>();
      byTrack[trackStart[1]] = current;
    }
    if (!current) continue;

    for (const [, name] of line.matchAll(/"(\w+)":/g)) current.add(name);
    // Indented `mode: "param", "param"` lines — a camera parameter is quoted but
    // carries no colon of its own, so the key regex above cannot see it.
    if (/^\s+\w+:/.test(line)) {
      for (const [, name] of line.matchAll(/"(\w+)"(?!:)/g)) current.add(name);
    }
  }
  return byTrack;
}

describe('prompt and payload schema parity', () => {
  // Both sides are TypeScript in the same package and nothing makes them agree.
  // A field the prompt asks for but the schema omits is discarded silently on
  // arrival; a field the schema accepts but the prompt never mentions is one the
  // model has no reason to ever send. Neither is a type error, and neither shows
  // up in a passing generation — the cutscene just quietly does less.
  const prompt = buildCutscenePrompt({ prompt: 'Pan from sky', sceneEntities: [] });
  const byTrack = promptFieldsByTrack(prompt);

  it('documents every track type', () => {
    expect(Object.keys(byTrack).sort()).toEqual([...CUTSCENE_TRACK_TYPES].sort());
  });

  it.each(CUTSCENE_TRACK_TYPES)('%s: prompt and schema name the same fields', (trackType) => {
    expect([...(byTrack[trackType] ?? [])].sort()).toEqual(
      getKeyframePayloadFields(trackType).sort(),
    );
  });

  it('extracts field names rather than value descriptions', () => {
    // Self-check on the parser above: `"string|null"` is a value, not a field,
    // and a parser that swept up every quoted token would make the assertions
    // above pass against a prompt that had drifted.
    expect(byTrack.dialogue).toEqual(new Set(['treeId', 'text']));
    expect([...(byTrack.camera ?? [])]).not.toContain('string');
  });
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

  // ==========================================================================
  // Keyframe payloads (PF-1145)
  //
  // Every other field on a keyframe was already checked here. The payload — the
  // one field that ends up dispatched as an engine command — was copied through
  // whole, so a model could put any key into the store, the exported project and
  // the timeline UI. The vocabulary itself is covered in
  // `lib/cutscene/__tests__/keyframePayload.test.ts`; these cases pin that the
  // parse boundary applies it, and applies the right one per track.
  // ==========================================================================

  /** Parse a one-track response and return that track's first payload. */
  const payloadOf = (type: string, payload: unknown): Record<string, unknown> => {
    const raw = JSON.stringify({
      name: 'X',
      duration: 5,
      tracks: [
        {
          id: 't1',
          type,
          entityId: 'e1',
          muted: false,
          keyframes: [{ timestamp: 0, duration: 1, easing: 'linear', payload }],
        },
      ],
    });
    return parseCutsceneResponse(raw).tracks[0].keyframes[0].payload;
  };

  it('keeps only the keys a camera payload is allowed to carry', () => {
    expect(
      payloadOf('camera', { mode: 'topDown', topDownHeight: 20, topDownAngle: 45, note: 'wide' }),
    ).toEqual({ mode: 'topDown', topDownHeight: 20 });
  });

  it('reads a payload against its own track type, not a shared vocabulary', () => {
    // `volume` is real for audio and invented for animation. One allowlist for
    // all tracks would have to accept both, which is how a per-type schema turns
    // into no schema at all.
    expect(payloadOf('audio', { volume: 0.8, clipName: 'run' })).toEqual({ volume: 0.8 });
    expect(payloadOf('animation', { volume: 0.8, clipName: 'run' })).toEqual({ clipName: 'run' });
  });

  it('drops a payload value of the wrong kind rather than persisting it', () => {
    expect(payloadOf('camera', { mode: 'topDown', topDownHeight: '20' })).toEqual({
      mode: 'topDown',
    });
  });

  it('keeps a keyframe whose payload survives as empty', () => {
    // The beat's timing is real even when its content is not. Rejecting here
    // would throw away a whole generated cutscene over one bad payload, and
    // `buildCommand` already treats a contentless payload as a no-op.
    const raw = JSON.stringify({
      name: 'X',
      duration: 5,
      tracks: [
        {
          id: 't1',
          type: 'animation',
          entityId: 'e1',
          muted: false,
          keyframes: [
            { timestamp: 0, duration: 1, easing: 'linear', payload: { clipName: '' } },
            { timestamp: 2, duration: 1, easing: 'linear', payload: { clipName: 'run' } },
          ],
        },
      ],
    });
    const keyframes = parseCutsceneResponse(raw).tracks[0].keyframes;
    expect(keyframes).toHaveLength(2);
    expect(keyframes[0].payload).toEqual({});
    expect(keyframes[1].payload).toEqual({ clipName: 'run' });
  });

  it('does not read payload fields off the prototype chain', () => {
    // `JSON.parse` writes a `__proto__` key as an ordinary own property on the
    // parsed object, so the payload reaching the store is a plain object either
    // way — the risk is the reader picking up the inherited value and writing it
    // as its own, which is indistinguishable downstream from an authored one.
    const raw = `{"name":"X","duration":5,"tracks":[{"id":"t1","type":"camera","entityId":"e1",
      "muted":false,"keyframes":[{"timestamp":0,"duration":1,"easing":"linear",
      "payload":{"mode":"topDown","__proto__":{"topDownHeight":999}}}]}]}`;
    expect(parseCutsceneResponse(raw).tracks[0].keyframes[0].payload).toEqual({ mode: 'topDown' });
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

  it('passes surface: cutscene to fetchAI for PostHog attribution (PF-931)', async () => {
    const { fetchAI } = await import('@/lib/ai/client');
    (fetchAI as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_RESPONSE);

    await generateCutscene({ prompt: 'Pan from sky', sceneEntities: [], duration: 8 });

    expect(fetchAI).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ surface: 'cutscene' }),
    );
  });
});
