/**
 * PF-649: AI module pipeline integration stub tests.
 *
 * Verifies the CONTRACT of the AI pipeline functions — their signatures,
 * input validation behaviour, and output shapes — without making real API
 * calls.  All fetch() calls and external services are mocked.
 *
 * These are NOT end-to-end tests.  They exist to catch:
 *   - Breaking signature changes (renamed params, removed exports)
 *   - Input validation regressions (missing guards for empty/invalid args)
 *   - Output shape regressions (renamed or missing fields in returned structs)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock fetch globally — prevents real HTTP calls from all tested modules
// ---------------------------------------------------------------------------

const _mockFetchResponse = (body: unknown, status = 200): Response => {
  const bodyText = JSON.stringify(body);
  return new Response(bodyText, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

vi.stubGlobal('fetch', vi.fn());

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeStreamingResponse(text: string): Response {
  // Simulate a streaming SSE response like /api/chat returns.
  // The gddGenerator and gameReviewer parse SSE events with type === 'text_delta'.
  const lines = `data: ${JSON.stringify({ type: 'text_delta', text })}\ndata: [DONE]\n`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// ---------------------------------------------------------------------------
// GDD Generator — generateGDD
// ---------------------------------------------------------------------------

describe('gddGenerator — generateGDD contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is exported as an async function', async () => {
    const mod = await import('@/lib/ai/gddGenerator');
    expect(typeof mod.generateGDD).toBe('function');
    // Verify it returns a Promise (thenable)
    const fakeGdd = {
      title: 'Test',
      genre: 'Platformer',
      summary: 'A test game',
      sections: [],
      mechanics: ['jump'],
      artStyle: 'pixel',
      targetPlatform: 'web',
      estimatedScope: 'small' as const,
    };
    vi.mocked(fetch).mockResolvedValueOnce(makeStreamingResponse(JSON.stringify(fakeGdd)));
    const result = mod.generateGDD('A platformer game');
    expect(result).toBeInstanceOf(Promise);
  });

  it('throws an error when prompt is empty', async () => {
    const { generateGDD } = await import('@/lib/ai/gddGenerator');
    await expect(generateGDD('')).rejects.toThrow(/empty/i);
  });

  it('throws an error when prompt is only whitespace', async () => {
    const { generateGDD } = await import('@/lib/ai/gddGenerator');
    await expect(generateGDD('   ')).rejects.toThrow(/empty/i);
  });

  it('accepts a prompt string and optional options object', async () => {
    const { generateGDD } = await import('@/lib/ai/gddGenerator');
    const fakeGdd = {
      title: 'Ninja Dash',
      genre: 'Platformer',
      summary: 'Run and jump',
      sections: [{ title: 'Overview', content: 'A fun game' }],
      mechanics: ['jump', 'run'],
      artStyle: 'pixel',
      targetPlatform: 'web',
      estimatedScope: 'small',
    };
    vi.mocked(fetch).mockResolvedValueOnce(makeStreamingResponse(JSON.stringify(fakeGdd)));
    const result = await generateGDD('A ninja platformer game', { genre: 'Platformer', scope: 'small' });

    // Verify output shape
    expect(typeof result.title).toBe('string');
    expect(typeof result.genre).toBe('string');
    expect(typeof result.summary).toBe('string');
    expect(Array.isArray(result.sections)).toBe(true);
    expect(Array.isArray(result.mechanics)).toBe(true);
    expect(typeof result.artStyle).toBe('string');
    expect(typeof result.targetPlatform).toBe('string');
    expect(['small', 'medium', 'large']).toContain(result.estimatedScope);
  });

  it('buildUserPrompt is a pure function (no side effects)', async () => {
    const { buildUserPrompt } = await import('@/lib/ai/gddGenerator');
    const result = buildUserPrompt('A space shooter', { genre: 'Shooter' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('parseGDDResponse returns a valid GameDesignDocument from JSON', async () => {
    const { parseGDDResponse } = await import('@/lib/ai/gddGenerator');
    const validJson = JSON.stringify({
      title: 'My Game',
      genre: 'Puzzle',
      summary: 'A puzzle game',
      sections: [],
      mechanics: ['click'],
      artStyle: 'minimalist',
      targetPlatform: 'web',
      estimatedScope: 'medium',
    });
    const result = parseGDDResponse(validJson);
    expect(result.title).toBe('My Game');
    expect(result.genre).toBe('Puzzle');
  });
});

// ---------------------------------------------------------------------------
// Level Generator — generateLevel
// ---------------------------------------------------------------------------

describe('levelGenerator — generateLevel contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is exported as an async function', async () => {
    const mod = await import('@/lib/ai/levelGenerator');
    expect(typeof mod.generateLevel).toBe('function');
  });

  it('accepts a description string and optional constraints array', async () => {
    const { generateLevel } = await import('@/lib/ai/levelGenerator');
    // generateLevel has a local AI-fallback path, but the primary path is template-based
    const result = await generateLevel('A dungeon level with corridors', []);
    // Must return a LevelLayout
    expect(typeof result.name).toBe('string');
    expect(typeof result.theme).toBe('string');
    expect(Array.isArray(result.rooms)).toBe(true);
    expect(typeof result.startRoom).toBe('string');
    expect(typeof result.exitRoom).toBe('string');
    expect(typeof result.difficulty).toBe('number');
    expect(typeof result.estimatedPlaytime).toBe('string');
  });

  it('rooms have required fields (id, name, type, entities, connections)', async () => {
    const { generateLevel } = await import('@/lib/ai/levelGenerator');
    const result = await generateLevel('A simple linear level');
    for (const room of result.rooms) {
      expect(typeof room.id).toBe('string');
      expect(typeof room.name).toBe('string');
      expect(typeof room.type).toBe('string');
      expect(Array.isArray(room.entities)).toBe(true);
      expect(Array.isArray(room.connections)).toBe(true);
    }
  });

  it('levelToCommands converts layout to engine command array', async () => {
    const { generateLevel, levelToCommands } = await import('@/lib/ai/levelGenerator');
    const layout = await generateLevel('A hub level with branching paths');
    const commands = levelToCommands(layout);
    expect(Array.isArray(commands)).toBe(true);
    // Every command must have a command string and payload object
    for (const cmd of commands) {
      expect(typeof cmd.command).toBe('string');
      expect(typeof cmd.payload).toBe('object');
      expect(cmd.payload).not.toBeNull();
    }
  });

  it('validateLayout returns an array (empty means valid)', async () => {
    const { generateLevel, validateLayout } = await import('@/lib/ai/levelGenerator');
    const layout = await generateLevel('A simple linear level');
    const errors = validateLayout(layout);
    expect(Array.isArray(errors)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Effect System — generateEffectBindings
// ---------------------------------------------------------------------------

describe('effectSystem — generateEffectBindings contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is exported as an async function', async () => {
    const mod = await import('@/lib/ai/effectSystem');
    expect(typeof mod.generateEffectBindings).toBe('function');
  });

  it('accepts a game description string and an optional fetcher', async () => {
    const { generateEffectBindings } = await import('@/lib/ai/effectSystem');
    const mockFetcher = vi.fn().mockResolvedValue([
      {
        event: { name: 'enemy_hit', category: 'combat' },
        effects: [{ type: 'screen_shake', intensity: 0.5, duration: 0.3 }],
      },
    ]);
    const result = await generateEffectBindings('A combat game', mockFetcher);
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns EffectBinding[] with event and effects arrays', async () => {
    const { generateEffectBindings } = await import('@/lib/ai/effectSystem');
    const mockFetcher = vi.fn().mockResolvedValue([
      {
        event: { name: 'coin_collected', category: 'collection' },
        effects: [
          { type: 'particle_burst', intensity: 0.8, duration: 0.5 },
          { type: 'sound', intensity: 0.6, duration: 0.2 },
        ],
      },
    ]);
    const result = await generateEffectBindings('A platformer', mockFetcher);
    expect(result.length).toBeGreaterThan(0);
    for (const binding of result) {
      expect(binding.event).not.toBeUndefined();
      expect(typeof binding.event.name).toBe('string');
      expect(typeof binding.event.category).toBe('string');
      expect(Array.isArray(binding.effects)).toBe(true);
      for (const effect of binding.effects) {
        expect(typeof effect.type).toBe('string');
        expect(typeof effect.intensity).toBe('number');
        expect(effect.intensity).toBeGreaterThanOrEqual(0);
        expect(effect.intensity).toBeLessThanOrEqual(1);
        expect(typeof effect.duration).toBe('number');
      }
    }
  });

  it('filters out bindings with invalid structure from fetcher output', async () => {
    const { generateEffectBindings } = await import('@/lib/ai/effectSystem');
    // Inject a mix of valid and invalid bindings
    const mockFetcher = vi.fn().mockResolvedValue([
      null, // invalid
      undefined, // invalid
      { event: { name: 'jump', category: 'movement' }, effects: [{ type: 'scale_pop', intensity: 0.5, duration: 0.2 }] }, // valid
      { notEvent: true }, // invalid — missing event field
    ]);
    // Should not throw — invalid entries are filtered out
    const result = await generateEffectBindings('A platformer', mockFetcher);
    expect(Array.isArray(result)).toBe(true);
    // Only the valid binding should survive
    for (const binding of result) {
      expect(binding).toHaveProperty('event');
      expect(binding).toHaveProperty('effects');
    }
  });

  it('EFFECT_PRESETS is a non-empty record of preset bindings', async () => {
    const { EFFECT_PRESETS, PRESET_KEYS } = await import('@/lib/ai/effectSystem');
    expect(typeof EFFECT_PRESETS).toBe('object');
    expect(Object.keys(EFFECT_PRESETS).length).toBeGreaterThan(0);
    expect(Array.isArray(PRESET_KEYS)).toBe(true);
    expect(PRESET_KEYS.length).toBe(Object.keys(EFFECT_PRESETS).length);
  });
});

// ---------------------------------------------------------------------------
// Game Reviewer — generateReview
// ---------------------------------------------------------------------------

describe('gameReviewer — generateReview contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is exported as an async function', async () => {
    const mod = await import('@/lib/ai/gameReviewer');
    expect(typeof mod.generateReview).toBe('function');
  });

  it('accepts a ReviewContext object', async () => {
    const { generateReview } = await import('@/lib/ai/gameReviewer');
    const context = {
      gameTitle: 'Space Blaster',
      genre: 'Shooter',
      mechanics: ['shoot', 'dodge'],
      entityCount: 15,
      sceneCount: 3,
      hasAudio: true,
      hasParticles: true,
      hasPhysics: false,
      scriptCount: 5,
      hasDialogue: false,
      hasUI: true,
      hasAnimations: false,
      hasSkybox: true,
      hasPostProcessing: true,
      projectType: '3d' as const,
      entityTypes: ['Cube', 'Sphere', 'Light'],
      lightCount: 2,
    };
    const fakeReview = {
      title: 'Space Blaster Review',
      summary: 'A solid shooter.',
      scores: { funFactor: 7, polish: 6, difficulty: 5, originality: 7, accessibility: 8, replayability: 6 },
      pros: ['Great visuals'],
      cons: ['Lacks story'],
      suggestions: ['Add a boss fight'],
      overallRating: 7,
      reviewText: 'This is a fun shooter game.',
    };
    // generateReview reads a streaming response; mock fetch to return SSE
    vi.mocked(fetch).mockResolvedValueOnce(makeStreamingResponse(JSON.stringify(fakeReview)));
    const result = await generateReview(context);

    // Verify output shape
    expect(typeof result.title).toBe('string');
    expect(typeof result.summary).toBe('string');
    expect(typeof result.overallRating).toBe('number');
    expect(typeof result.reviewText).toBe('string');
    expect(Array.isArray(result.pros)).toBe(true);
    expect(Array.isArray(result.cons)).toBe(true);
    expect(Array.isArray(result.suggestions)).toBe(true);
    expect(typeof result.scores).toBe('object');
  });

  it('buildReviewContext extracts data from editor state correctly', async () => {
    const { buildReviewContext } = await import('@/lib/ai/gameReviewer');
    // buildReviewContext reads from a getState() function
    const getState = vi.fn().mockReturnValue({
      sceneGraph: {
        nodes: {
          e1: { type: 'Cube', components: ['Mesh3d'] },
          e2: { type: 'Light', components: ['PointLight'] },
        },
      },
      scenes: [{ id: 's1' }, { id: 's2' }],
      audioMap: { e1: {} },
      particleMap: { e1: {} },
      physicsMap: { e1: {} },
      scriptMap: { e1: {}, e2: {} },
      lightingMap: { e1: {} },
      postProcessingSettings: { bloom: { enabled: true } },
      projectType: '3d',
      physicsEnabled: false,
      particleEnabled: false,
      primaryAudio: null,
      primaryAnimation: null,
      allScripts: {},
      allGameComponents: {},
      postProcessing: null,
    });
    const context = buildReviewContext(getState);
    expect(typeof context.entityCount).toBe('number');
    expect(typeof context.sceneCount).toBe('number');
    expect(typeof context.projectType).toBe('string');
  });

  it('getRatingDescriptor returns a non-empty string for any score 1-10', async () => {
    const { getRatingDescriptor } = await import('@/lib/ai/gameReviewer');
    for (let i = 1; i <= 10; i++) {
      const descriptor = getRatingDescriptor(i);
      expect(typeof descriptor).toBe('string');
      expect(descriptor.length).toBeGreaterThan(0);
    }
  });

  it('clampScore keeps values within 1-10 range', async () => {
    const { clampScore } = await import('@/lib/ai/gameReviewer');
    expect(clampScore(0)).toBeGreaterThanOrEqual(1);
    expect(clampScore(15)).toBeLessThanOrEqual(10);
    expect(clampScore(5)).toBe(5);
  });
});
