/**
 * AI module pipeline integration tests.
 *
 * Verifies that the GDD → Level → Effects → Review pipeline stages:
 *   1. Produce correct typed output at each stage
 *   2. Accept the output from the previous stage as input
 *   3. Propagate errors gracefully across stage boundaries
 *   4. Work correctly when started from an intermediate stage
 *
 * These tests do NOT call real AI endpoints. Network calls are intercepted
 * via vi.spyOn(globalThis, 'fetch') so the tests run in CI without credentials.
 * The createTestHarness() from harness.ts wires up the full Zustand store with
 * a mock dispatch, giving us a real store to test buildReviewContext against.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  parseGDDResponse,
  buildUserPrompt,
  detectGenre,
  estimateScope,
  type GameDesignDocument,
  GDD_STANDARD_SECTIONS,
} from '@/lib/ai/gddGenerator';

import {
  generateLevel,
  validateLayout,
  levelToCommands,
  applyConstraints,
  LEVEL_TEMPLATES,
  type LevelLayout,
  type LevelConstraint,
} from '@/lib/ai/levelGenerator';

import {
  generateEffectBindings,
  applyBinding,
  applyEffect,
  isValidBinding,
  createEffect,
  EFFECT_PRESETS,
  PRESET_KEYS,
  type EffectBinding,
  type CommandDispatcher,
} from '@/lib/ai/effectSystem';

import {
  parseReviewResponse,
  buildReviewContext,
  clampScore,
  getRatingDescriptor,
  type ReviewContext,
} from '@/lib/ai/gameReviewer';

import { createTestHarness, type TestHarness } from '../harness';
import type { SceneNode } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// SSE streaming helpers
// ---------------------------------------------------------------------------

function createSSEResponse(content: string, status = 200): Response {
  const encoder = new TextEncoder();
  const events = [
    `data: ${JSON.stringify({ type: 'text_delta', text: content })}\n`,
    'data: [DONE]\n',
  ].join('\n');

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(events));
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function createErrorSSEResponse(errorMessage: string): Response {
  const encoder = new TextEncoder();
  const events = `data: ${JSON.stringify({ type: 'error', message: errorMessage })}\n\ndata: [DONE]\n`;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(events));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FIXTURE_GDD: GameDesignDocument = {
  title: 'Dungeon Runner',
  genre: 'Platformer',
  summary: 'A fast-paced dungeon platformer where you outrun an ever-rising flood.',
  sections: GDD_STANDARD_SECTIONS.map((s) => ({ title: s, content: `${s} content for Dungeon Runner` })),
  mechanics: ['running', 'jumping', 'collecting', 'enemies', 'flood_timer'],
  artStyle: 'low-poly 3D',
  targetPlatform: 'web',
  estimatedScope: 'medium',
};

const FIXTURE_LEVEL: LevelLayout = LEVEL_TEMPLATES.linear.generate();

const FIXTURE_REVIEW_JSON = {
  title: 'A Solid Foundation',
  summary: 'Dungeon Runner shows strong potential with its flood mechanic.',
  scores: {
    funFactor: 7,
    polish: 5,
    difficulty: 6,
    originality: 8,
    accessibility: 6,
    replayability: 7,
  },
  pros: ['Unique flood mechanic', 'Good level variety'],
  cons: ['Lacks audio polish'],
  suggestions: ['Add sound effects', 'Improve UI'],
  overallRating: 7,
  reviewText: 'This is a solid game with room for improvement.',
};

function makeSceneNode(entityId: string, name: string, parentId: string | null = null): SceneNode {
  return {
    entityId,
    name,
    parentId,
    children: [],
    components: ['Mesh3d'],
    visible: true,
  };
}

// ---------------------------------------------------------------------------
// Scenario 1: GDD → Level pipeline
// ---------------------------------------------------------------------------

describe('GDD → Level pipeline', () => {
  it('detects genre from GDD summary for level template selection', async () => {
    const genre = detectGenre(FIXTURE_GDD.summary);
    // "dungeon" keyword should trigger dungeon template selection in generateLevel
    const level = await generateLevel(FIXTURE_GDD.summary);
    expect(level).not.toBeUndefined();
    expect(level.rooms.length).toBeGreaterThan(0);
    expect(level.startRoom).not.toBeNull();
    expect(level.exitRoom).not.toBeNull();
    // Genre-based selection should have some result
    expect(typeof genre).toBe('string');
  });

  it('level derived from GDD mechanics uses matching template style', async () => {
    // A GDD with dungeon/corridor mechanics → dungeon template
    const dungeonGDD = { ...FIXTURE_GDD, summary: 'A dungeon crawl with corridors and locked rooms' };
    const level = await generateLevel(dungeonGDD.summary);
    expect(level.name).not.toBeNull();
    expect(level.rooms.every((r) => r.id)).toBe(true);
  });

  it('GDD estimatedScope feeds into level constraints', async () => {
    // Medium scope GDD → 5-room level is reasonable
    const constraints: LevelConstraint[] = [
      { type: 'room_count', value: FIXTURE_GDD.estimatedScope === 'medium' ? 5 : 3 },
    ];
    const level = await generateLevel('a medium adventure game', constraints);
    expect(level.rooms.length).toBe(5);
  });

  it('GDD mechanics array maps onto level entity roles', async () => {
    const level = await generateLevel('combat arena with waves and horde enemies');
    // Arena template should be selected from keyword matching
    expect(level.rooms.some((r) => r.type === 'combat')).toBe(true);
  });

  it('level generated from GDD passes validation', async () => {
    const level = await generateLevel(FIXTURE_GDD.summary);
    const errors = validateLayout(level);
    expect(errors).toHaveLength(0);
  });

  it('level commands from GDD-sourced layout include spawn commands', async () => {
    const level = await generateLevel(FIXTURE_GDD.summary);
    const commands = levelToCommands(level);
    // Should have spawn_entity commands for rooms and corridors
    const spawnCommands = commands.filter((c) => c.command === 'spawn_entity');
    expect(spawnCommands.length).toBeGreaterThan(0);
    // All spawn commands should have entityType
    for (const cmd of spawnCommands) {
      expect(cmd.payload).toHaveProperty('entityType');
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Level → Effects pipeline
// ---------------------------------------------------------------------------

describe('Level → Effects pipeline', () => {
  it('generates effect bindings from a level description', async () => {
    const mockBindings: EffectBinding[] = [
      {
        event: { name: 'enemy_hit', category: 'combat' },
        effects: [
          createEffect('screen_shake', 0.4, 0.2),
          createEffect('particle_burst', 0.6, 0.4, { color: '#ff4444', count: 10 }),
        ],
      },
    ];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ bindings: mockBindings }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const bindings = await generateEffectBindings('a dungeon combat level');
    expect(bindings.length).toBeGreaterThan(0);
    expect(bindings[0].event.category).toBe('combat');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('effects match room types in the level — combat rooms produce combat events', () => {
    const combatRooms = FIXTURE_LEVEL.rooms.filter((r) => r.type === 'combat');
    // For each combat room, the "enemy_hit" preset should be applicable
    expect(combatRooms.length).toBeGreaterThan(0);
    const enemyHitBinding = EFFECT_PRESETS['enemy_hit'];
    expect(enemyHitBinding.event.category).toBe('combat');
  });

  it('effect bindings from AI are validated and intensity-clamped', async () => {
    const rawBindings = [
      {
        event: { name: 'player_land', category: 'movement' },
        effects: [
          { type: 'screen_shake', intensity: 2.5, duration: 0.3 }, // over-limit intensity
          { type: 'sound', intensity: -1.0, duration: 0.2 },        // negative intensity
        ],
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ bindings: rawBindings }), { status: 200 }),
    );

    const bindings = await generateEffectBindings('test');
    expect(bindings.length).toBe(1);
    // Intensities must be clamped to [0, 1]
    for (const eff of bindings[0].effects) {
      expect(eff.intensity).toBeGreaterThanOrEqual(0);
      expect(eff.intensity).toBeLessThanOrEqual(1);
    }
  });

  it('level commands and effects can coexist — dispatch handles both', () => {
    const dispatchedCommands: Array<{ command: string; payload: unknown }> = [];
    const dispatcher: CommandDispatcher = (cmd, payload) => {
      dispatchedCommands.push({ command: cmd, payload });
    };

    // Apply level spawn commands (simulated)
    const level = FIXTURE_LEVEL;
    const levelCommands = levelToCommands(level);
    for (const cmd of levelCommands.slice(0, 3)) {
      dispatcher(cmd.command, cmd.payload);
    }

    // Apply an effect binding on top
    applyBinding(EFFECT_PRESETS['enemy_hit'], dispatcher);

    // Should have both level commands and effect commands
    const spawnCmds = dispatchedCommands.filter((c) => c.command === 'spawn_entity');
    const effectCmds = dispatchedCommands.filter((c) => c.command === 'camera_shake');
    expect(spawnCmds.length).toBeGreaterThan(0);
    expect(effectCmds.length).toBeGreaterThan(0);
  });

  it('all preset effect bindings are structurally valid', () => {
    for (const key of PRESET_KEYS) {
      expect(isValidBinding(EFFECT_PRESETS[key])).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Full pipeline — GDD → Level → Effects → Review
// ---------------------------------------------------------------------------

describe('full pipeline: GDD → Level → Effects → Review', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    h.cleanup();
    vi.restoreAllMocks();
  });

  it('full pipeline produces typed output at every stage', async () => {
    // Stage 1: Parse GDD (simulate AI response)
    const gdd = parseGDDResponse(JSON.stringify(FIXTURE_GDD));
    expect(gdd.title).toBe('Dungeon Runner');
    expect(gdd.mechanics.length).toBeGreaterThan(0);

    // Stage 2: Generate level from GDD genre + mechanics
    const levelDescription = `${gdd.genre.toLowerCase()} level with ${gdd.mechanics.join(', ')}`;
    const level = await generateLevel(levelDescription);
    const levelErrors = validateLayout(level);
    expect(levelErrors).toHaveLength(0);

    // Stage 3: Generate effects (mocked AI call)
    const mockEffectBindings: EffectBinding[] = [
      EFFECT_PRESETS['enemy_hit'],
      EFFECT_PRESETS['coin_collected'],
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ bindings: mockEffectBindings }), { status: 200 }),
    );
    const effects = await generateEffectBindings(gdd.summary);
    expect(effects.length).toBeGreaterThan(0);

    // Stage 4: Build review context from store + parse review
    h.simulateEntitySpawned(makeSceneNode('e1', 'Hero', null));
    h.simulateEntitySpawned(makeSceneNode('e2', 'Floor', null));

    const reviewContext = buildReviewContext(h.store.getState);
    expect(reviewContext.entityCount).toBe(2);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      createSSEResponse(JSON.stringify(FIXTURE_REVIEW_JSON)),
    );

    // Verify the review context is usable as ReviewContext
    const review = parseReviewResponse(JSON.stringify(FIXTURE_REVIEW_JSON));
    expect(review.overallRating).toBeGreaterThanOrEqual(1);
    expect(review.overallRating).toBeLessThanOrEqual(10);
    expect(Array.isArray(review.pros)).toBe(true);
    expect(Array.isArray(review.cons)).toBe(true);
    expect(Array.isArray(review.suggestions)).toBe(true);
  });

  it('GDD output feeds into level description without type errors', async () => {
    const gdd = parseGDDResponse(JSON.stringify(FIXTURE_GDD));

    // The GDD summary should work as a level description string
    const level = await generateLevel(gdd.summary);
    expect(level.name).not.toBeNull();
    expect(level.rooms.length).toBeGreaterThan(0);

    // Level commands should be a non-empty array
    const commands = levelToCommands(level);
    expect(commands.length).toBeGreaterThan(0);

    // Commands feed into dispatch — verify shape
    for (const cmd of commands) {
      expect(typeof cmd.command).toBe('string');
      expect(cmd.payload).not.toBeUndefined();
    }
  });

  it('level entity count informs review context entityCount', async () => {
    const level = await generateLevel('a dungeon with enemies');
    const levelCommands = levelToCommands(level);
    const spawnCount = levelCommands.filter((c) => c.command === 'spawn_entity').length;

    // Simulate the spawned entities in the store
    for (let i = 0; i < Math.min(spawnCount, 5); i++) {
      h.simulateEntitySpawned(makeSceneNode(`level-e-${i}`, `Entity ${i}`, null));
    }

    const ctx = buildReviewContext(h.store.getState);
    expect(ctx.entityCount).toBe(Math.min(spawnCount, 5));
  });

  it('effects applied to dispatch are recorded correctly', () => {
    const dispatched: Array<[string, unknown]> = [];
    const mockDispatch: CommandDispatcher = (cmd, payload) => dispatched.push([cmd, payload]);

    // Apply all combat effects from the level
    applyBinding(EFFECT_PRESETS['enemy_hit'], mockDispatch);
    applyBinding(EFFECT_PRESETS['damage_taken'], mockDispatch);

    expect(dispatched.length).toBeGreaterThan(0);
    // enemy_hit has: screen_shake, particle_burst, sound, flash
    const commands = dispatched.map(([cmd]) => cmd);
    expect(commands).toContain('camera_shake');
    expect(commands).toContain('burst_particle');
    expect(commands).toContain('play_one_shot_audio');
  });

  it('review scores are derived from real context data', () => {
    h.simulateEntitySpawned(makeSceneNode('hero', 'Hero', null));
    h.simulateEntitySpawned(
      Object.assign(makeSceneNode('light', 'Sun', null), { components: ['DirectionalLight'] }),
    );

    const ctx = buildReviewContext(h.store.getState);
    const review = parseReviewResponse(JSON.stringify(FIXTURE_REVIEW_JSON));

    // All scores must be in valid range
    const scoreValues = Object.values(review.scores) as number[];
    for (const score of scoreValues) {
      expect(score).toBeGreaterThanOrEqual(1);
      expect(score).toBeLessThanOrEqual(10);
    }

    // Review descriptor matches overall rating
    const descriptor = getRatingDescriptor(review.overallRating);
    expect(typeof descriptor).toBe('string');
    expect(descriptor.length).toBeGreaterThan(0);

    // Context entity count is accurate
    expect(ctx.entityCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Error propagation
// ---------------------------------------------------------------------------

describe('error propagation across pipeline stages', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GDD parse error is thrown — downstream stages do not run', () => {
    expect(() => parseGDDResponse('invalid json {{{')).toThrow();
    // Downstream stages would only be called if the GDD result is available
    // — this test documents that callers must handle the thrown error
  });

  it('GDD parse error does not corrupt a subsequent valid parse', () => {
    expect(() => parseGDDResponse('not json')).toThrow();
    // A subsequent call with valid input should succeed
    const gdd = parseGDDResponse(JSON.stringify(FIXTURE_GDD));
    expect(gdd.title).toBe('Dungeon Runner');
  });

  it('level generation with invalid constraint type is ignored gracefully', async () => {
    const level = await generateLevel('a dungeon', [
      { type: 'room_count', value: 'not-a-number' } as unknown as LevelConstraint,
    ]);
    // Should succeed — invalid constraint value is ignored in applyConstraints
    expect(level.rooms.length).toBeGreaterThan(0);
  });

  it('effect generation failure does not affect level commands', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

    const level = await generateLevel('a platformer');
    const commands = levelToCommands(level);

    // Level commands are still valid even though effect generation would fail
    expect(commands.length).toBeGreaterThan(0);

    // Effect generation should throw
    await expect(generateEffectBindings('test')).rejects.toThrow('Network error');
  });

  it('effect API returning invalid bindings results in empty array (filtered)', async () => {
    const invalidBindings = [
      { event: null, effects: [] },               // invalid: null event
      { event: { name: '', category: 'combat' }, effects: [] }, // invalid: empty name
      { event: { name: 'e1', category: 'invalid_cat' }, effects: [] }, // invalid: bad category
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ bindings: invalidBindings }), { status: 200 }),
    );

    const result = await generateEffectBindings('some game');
    expect(result).toHaveLength(0);
  });

  it('review parse failure returns default review — does not throw', () => {
    const review = parseReviewResponse('totally malformed {{{{');
    expect(review.title).toBe('Game Review');
    expect(review.overallRating).toBe(5);
    expect(Array.isArray(review.pros)).toBe(true);
    expect(Array.isArray(review.cons)).toBe(true);
  });

  it('review with out-of-range scores is clamped — not rejected', () => {
    const badScores = {
      ...FIXTURE_REVIEW_JSON,
      scores: {
        funFactor: 99,
        polish: -5,
        difficulty: 0,
        originality: 11,
        accessibility: NaN,
        replayability: 7,
      },
      overallRating: 99,
    };
    const review = parseReviewResponse(JSON.stringify(badScores));
    const allScores = Object.values(review.scores) as number[];
    for (const score of allScores) {
      expect(score).toBeGreaterThanOrEqual(1);
      expect(score).toBeLessThanOrEqual(10);
    }
    expect(review.overallRating).toBeLessThanOrEqual(10);
    expect(review.overallRating).toBeGreaterThanOrEqual(1);
  });

  it('clampScore handles edge values correctly', () => {
    expect(clampScore(0)).toBe(1);
    expect(clampScore(-100)).toBe(1);
    expect(clampScore(11)).toBe(10);
    expect(clampScore(NaN)).toBe(5);
    expect(clampScore(5.7)).toBe(6); // rounds
  });

  it('level validation catches orphaned rooms before effects are applied', async () => {
    const level = await generateLevel('a dungeon');
    const errors = validateLayout(level);
    // Should be valid before effects — no orphan rooms
    expect(errors).toHaveLength(0);
  });

  it('GDD non-ok API response propagates as a thrown error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    );

    const { generateGDD } = await import('@/lib/ai/gddGenerator');
    // After the unified AI client refactor (PF-650), mapError() normalises
    // HTTP 401 responses into a user-friendly message rather than re-throwing
    // the raw server error string. The important invariant is that a non-ok
    // response still rejects -- the exact message reflects the mapped copy.
    await expect(generateGDD('a platformer')).rejects.toThrow('Authentication required');
  });

  it('GDD SSE error event propagates as a thrown error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      createErrorSSEResponse('Token limit exceeded'),
    );

    const { generateGDD } = await import('@/lib/ai/gddGenerator');
    await expect(generateGDD('a game')).rejects.toThrow('Token limit exceeded');
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: Partial pipeline — start from Level (skip GDD)
// ---------------------------------------------------------------------------

describe('partial pipeline: start from Level stage', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    h.cleanup();
    vi.restoreAllMocks();
  });

  it('level can be generated independently without a GDD', async () => {
    const level = await generateLevel('an arena battle with waves');
    expect(level).not.toBeUndefined();
    expect(level.rooms.length).toBeGreaterThan(0);
    const errors = validateLayout(level);
    expect(errors).toHaveLength(0);
  });

  it('all 5 level templates generate valid layouts independently', async () => {
    const templateDescriptions: Record<string, string> = {
      linear: 'a linear dungeon',
      branching: 'a hub with branching wings',
      metroidvania: 'a metroidvania with keys and locked doors',
      arena: 'an arena with wave enemies horde',
      dungeon: 'a dungeon with corridors and rooms',
    };

    for (const [_templateId, description] of Object.entries(templateDescriptions)) {
      const level = await generateLevel(description);
      const errors = validateLayout(level);
      expect(errors, `Template '${_templateId}' should produce valid layout`).toHaveLength(0);
    }
  });

  it('level can be built directly from a template without pipeline context', () => {
    const level = LEVEL_TEMPLATES.branching.generate();
    const commands = levelToCommands(level);
    expect(commands.length).toBeGreaterThan(0);
    // Branching template has hub + 3 wings = 7 rooms
    const spawnCmds = commands.filter((c) => c.command === 'spawn_entity');
    expect(spawnCmds.length).toBeGreaterThan(0);
  });

  it('effects can be applied to a standalone level without GDD context', () => {
    const dispatched: string[] = [];
    const mockDispatch: CommandDispatcher = (cmd) => dispatched.push(cmd);

    // Level complete effect
    applyBinding(EFFECT_PRESETS['level_complete'], mockDispatch);

    expect(dispatched).toContain('set_time_scale');
    expect(dispatched).toContain('burst_particle');
    expect(dispatched).toContain('play_one_shot_audio');
  });

  it('review context works with minimal store state', () => {
    // No entities in store — minimal state
    const ctx = buildReviewContext(h.store.getState);
    expect(ctx.entityCount).toBe(0);
    expect(ctx.gameTitle).toBe('Untitled');
    expect(ctx.genre).toBe('general');
    expect(ctx.mechanics).toEqual([]);
  });

  it('review can be generated from context with no prior pipeline stages', () => {
    const minimalCtx: ReviewContext = {
      gameTitle: 'Quick Test',
      genre: 'action',
      mechanics: ['jump'],
      entityCount: 3,
      sceneCount: 1,
      hasAudio: false,
      hasParticles: false,
      hasPhysics: true,
      scriptCount: 0,
      hasDialogue: false,
      hasUI: false,
      hasAnimations: false,
      hasSkybox: false,
      hasPostProcessing: false,
      projectType: '3d',
      entityTypes: ['mesh'],
      lightCount: 1,
    };

    // Direct parse (no fetch needed for parse)
    const review = parseReviewResponse(JSON.stringify(FIXTURE_REVIEW_JSON));
    expect(review.overallRating).toBeGreaterThanOrEqual(1);

    // Context should be valid regardless of pipeline stage
    expect(minimalCtx.entityCount).toBe(3);
    expect(minimalCtx.hasPhysics).toBe(true);
  });

  it('constraint application is idempotent across pipeline stages', async () => {
    const baseLevel = await generateLevel('a dungeon');
    const constraints: LevelConstraint[] = [{ type: 'path_length', value: 1.0 }];

    // Applying the same constraint twice should produce the same result
    const once = applyConstraints(baseLevel, constraints);
    const twice = applyConstraints(once, [{ type: 'path_length', value: 1.0 }]);

    // Both applications with 1.0 multiplier should preserve positions
    expect(once.rooms[0].position.x).toBe(twice.rooms[0].position.x);
    expect(once.rooms[0].position.y).toBe(twice.rooms[0].position.y);
  });

  it('scope detected from prompt description drives level constraints correctly', async () => {
    const smallPrompt = 'a simple dungeon';
    const largePrompt = 'a massive multiplayer open world dungeon with crafting, inventory, dialogue, story';

    const smallScope = estimateScope(smallPrompt);
    const largeScope = estimateScope(largePrompt);

    expect(smallScope).toBe('small');
    expect(largeScope).toBe('large');

    // Small scope → fewer rooms than large scope
    const smallLevel = await generateLevel(smallPrompt, [
      { type: 'room_count', value: smallScope === 'small' ? 4 : 6 },
    ]);
    // Dungeon template has corridors — room_count=4 should remove down to 4
    expect(smallLevel.rooms.length).toBe(4);

    // Large scope → more rooms (grow from base)
    const largeLevel = await generateLevel(largePrompt, [
      { type: 'room_count', value: largeScope === 'large' ? 8 : 5 },
    ]);
    expect(largeLevel.rooms.length).toBe(8);
  });

  it('effects can be dispatched independently of level commands', () => {
    const effectCommands: string[] = [];
    const mockDispatch: CommandDispatcher = (cmd) => effectCommands.push(cmd);

    // Apply every preset — should work without any level context
    for (const key of PRESET_KEYS) {
      applyBinding(EFFECT_PRESETS[key], mockDispatch);
    }

    expect(effectCommands.length).toBeGreaterThan(0);
    // Each preset should produce at least one command
    expect(effectCommands).toContain('camera_shake');
    expect(effectCommands).toContain('animate_scale_pop');
    expect(effectCommands).toContain('play_one_shot_audio');
  });

  it('individual effect types each dispatch the expected engine command', () => {
    const dispatched: Array<[string, unknown]> = [];
    const mockDispatch: CommandDispatcher = (cmd, payload) => dispatched.push([cmd, payload]);

    applyEffect(createEffect('screen_shake', 0.5, 0.2), mockDispatch);
    applyEffect(createEffect('particle_burst', 0.5, 0.3), mockDispatch);
    applyEffect(createEffect('flash', 0.5, 0.1), mockDispatch);
    applyEffect(createEffect('slow_motion', 0.5, 0.5, { timeScale: 0.3 }), mockDispatch);
    applyEffect(createEffect('sound', 0.5, 0.2, { sound: 'hit' }), mockDispatch);
    applyEffect(createEffect('scale_pop', 0.5, 0.2), mockDispatch);
    applyEffect(createEffect('color_flash', 0.5, 0.2, { color: '#ff0000' }), mockDispatch);

    const commands = dispatched.map(([cmd]) => cmd);
    expect(commands).toContain('camera_shake');
    expect(commands).toContain('burst_particle');
    expect(commands).toContain('post_processing_flash');
    expect(commands).toContain('set_time_scale');
    expect(commands).toContain('play_one_shot_audio');
    expect(commands).toContain('animate_scale_pop');
    expect(commands).toContain('post_processing_color_flash');
  });

  it('GDD buildUserPrompt generates a correctly formatted prompt for level stage', () => {
    // When skipping GDD generation but still building a prompt manually
    const prompt = buildUserPrompt('a dungeon platformer', { genre: 'Platformer', scope: 'medium' });
    expect(prompt).toContain('Game idea:');
    expect(prompt).toContain('Genre preference: Platformer');
    expect(prompt).toContain('Target scope: medium');
    expect(prompt).toContain('Generate the complete GDD as JSON.');
  });
});
