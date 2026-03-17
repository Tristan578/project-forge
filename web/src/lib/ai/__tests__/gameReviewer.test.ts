import { describe, it, expect, vi } from 'vitest';
import {
  parseReviewResponse,
  clampScore,
  getRatingDescriptor,
  buildReviewContext,
  REVIEWER_SYSTEM_PROMPT,
  type GameReview,
  type ReviewContext,
} from '../gameReviewer';

// ---- clampScore ----

describe('clampScore', () => {
  it('returns value within 1-10 range for valid inputs', () => {
    expect(clampScore(5)).toBe(5);
    expect(clampScore(1)).toBe(1);
    expect(clampScore(10)).toBe(10);
  });

  it('clamps values below 1 to 1', () => {
    expect(clampScore(0)).toBe(1);
    expect(clampScore(-5)).toBe(1);
  });

  it('clamps values above 10 to 10', () => {
    expect(clampScore(11)).toBe(10);
    expect(clampScore(99)).toBe(10);
  });

  it('rounds fractional values', () => {
    expect(clampScore(3.4)).toBe(3);
    expect(clampScore(3.6)).toBe(4);
    expect(clampScore(7.5)).toBe(8);
  });

  it('returns 5 for NaN', () => {
    expect(clampScore(NaN)).toBe(5);
  });

  it('returns 5 for non-number values', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(clampScore(undefined as any)).toBe(5);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(clampScore('hello' as any)).toBe(5);
  });
});

// ---- getRatingDescriptor ----

describe('getRatingDescriptor', () => {
  it('returns "Outstanding" for 9-10', () => {
    expect(getRatingDescriptor(9)).toBe('Outstanding');
    expect(getRatingDescriptor(10)).toBe('Outstanding');
  });

  it('returns "Impressive" for 7-8', () => {
    expect(getRatingDescriptor(7)).toBe('Impressive');
    expect(getRatingDescriptor(8)).toBe('Impressive');
  });

  it('returns "Good Start" for 4-6', () => {
    expect(getRatingDescriptor(4)).toBe('Good Start');
    expect(getRatingDescriptor(5)).toBe('Good Start');
    expect(getRatingDescriptor(6)).toBe('Good Start');
  });

  it('returns "Needs Work" for 1-3', () => {
    expect(getRatingDescriptor(1)).toBe('Needs Work');
    expect(getRatingDescriptor(2)).toBe('Needs Work');
    expect(getRatingDescriptor(3)).toBe('Needs Work');
  });
});

// ---- parseReviewResponse ----

describe('parseReviewResponse', () => {
  const validResponse: GameReview = {
    title: 'A Great Adventure',
    summary: 'An exciting game with solid mechanics.',
    scores: {
      funFactor: 8,
      polish: 7,
      difficulty: 5,
      originality: 6,
      accessibility: 9,
      replayability: 4,
    },
    pros: ['Fun gameplay', 'Good visuals'],
    cons: ['Short length'],
    suggestions: ['Add more levels'],
    overallRating: 7,
    reviewText: 'This is a well-made game that delivers on its promises.',
  };

  it('parses valid JSON response correctly', () => {
    const result = parseReviewResponse(JSON.stringify(validResponse));
    expect(result.title).toBe('A Great Adventure');
    expect(result.summary).toBe('An exciting game with solid mechanics.');
    expect(result.scores.funFactor).toBe(8);
    expect(result.scores.polish).toBe(7);
    expect(result.overallRating).toBe(7);
    expect(result.pros).toEqual(['Fun gameplay', 'Good visuals']);
    expect(result.cons).toEqual(['Short length']);
    expect(result.suggestions).toEqual(['Add more levels']);
  });

  it('strips markdown code fences', () => {
    const wrapped = '```json\n' + JSON.stringify(validResponse) + '\n```';
    const result = parseReviewResponse(wrapped);
    expect(result.title).toBe('A Great Adventure');
    expect(result.overallRating).toBe(7);
  });

  it('strips code fences without language tag', () => {
    const wrapped = '```\n' + JSON.stringify(validResponse) + '\n```';
    const result = parseReviewResponse(wrapped);
    expect(result.title).toBe('A Great Adventure');
  });

  it('clamps scores to 1-10 range', () => {
    const response = {
      ...validResponse,
      scores: {
        funFactor: 15,
        polish: -2,
        difficulty: 0,
        originality: 11,
        accessibility: 5,
        replayability: 100,
      },
      overallRating: 20,
    };
    const result = parseReviewResponse(JSON.stringify(response));
    expect(result.scores.funFactor).toBe(10);
    expect(result.scores.polish).toBe(1);
    expect(result.scores.difficulty).toBe(1);
    expect(result.scores.originality).toBe(10);
    expect(result.scores.accessibility).toBe(5);
    expect(result.scores.replayability).toBe(10);
    expect(result.overallRating).toBe(10);
  });

  it('returns defaults for malformed JSON', () => {
    const result = parseReviewResponse('not valid json at all');
    expect(result.title).toBe('Game Review');
    expect(result.overallRating).toBe(5);
    expect(result.reviewText).toBe('not valid json at all');
  });

  it('returns defaults for empty string', () => {
    const result = parseReviewResponse('');
    expect(result.title).toBe('Game Review');
    expect(result.summary).toContain('unable to generate');
    expect(result.reviewText).toBe('No review text was generated.');
  });

  it('handles missing optional fields with defaults', () => {
    const partial = JSON.stringify({ title: 'My Game' });
    const result = parseReviewResponse(partial);
    expect(result.title).toBe('My Game');
    expect(result.summary).toBe('No summary available.');
    expect(result.scores.funFactor).toBe(5);
    expect(result.pros).toEqual([]);
    expect(result.overallRating).toBe(5);
  });

  it('filters non-string entries from pros/cons/suggestions', () => {
    const response = {
      ...validResponse,
      pros: ['Valid', 123, null, 'Also valid'],
      cons: [true, 'Real con'],
      suggestions: [{ nested: true }, 'Good suggestion'],
    };
    const result = parseReviewResponse(JSON.stringify(response));
    expect(result.pros).toEqual(['Valid', 'Also valid']);
    expect(result.cons).toEqual(['Real con']);
    expect(result.suggestions).toEqual(['Good suggestion']);
  });

  it('limits arrays to 10 items', () => {
    const response = {
      ...validResponse,
      pros: Array.from({ length: 15 }, (_, i) => `Pro ${i + 1}`),
    };
    const result = parseReviewResponse(JSON.stringify(response));
    expect(result.pros).toHaveLength(10);
    expect(result.pros[0]).toBe('Pro 1');
    expect(result.pros[9]).toBe('Pro 10');
  });

  it('handles non-string title/summary gracefully', () => {
    const response = { ...validResponse, title: 42, summary: null };
    const result = parseReviewResponse(JSON.stringify(response));
    expect(result.title).toBe('Game Review');
    expect(result.summary).toBe('No summary available.');
  });
});

// ---- buildReviewContext ----

describe('buildReviewContext', () => {
  function createMockState(overrides: Record<string, unknown> = {}) {
    return {
      sceneGraph: {
        rootIds: ['e1', 'e2'],
        nodes: {
          e1: {
            entityId: 'e1',
            name: 'Player',
            components: ['Mesh3d', 'Transform', 'PhysicsEnabled'],
            visible: true,
            children: [],
          },
          e2: {
            entityId: 'e2',
            name: 'Sun',
            components: ['DirectionalLight', 'Transform'],
            visible: true,
            children: [],
          },
        },
      },
      sceneName: 'My Cool Game',
      physicsEnabled: true,
      particleEnabled: false,
      primaryAudio: { source: 'test.mp3', enabled: true },
      primaryAnimation: { availableClips: [] },
      allScripts: { e1: { enabled: true }, e2: { enabled: false } },
      allGameComponents: { e1: [{ type: 'characterController' }, { type: 'health' }] },
      scenes: [{ id: 's1' }, { id: 's2' }],
      postProcessing: { bloom: { enabled: true }, chromaticAberration: { enabled: false } },
      environment: { skyboxPreset: 'sunset' },
      projectType: '3d' as const,
      ...overrides,
    };
  }

  it('extracts game title from scene name', () => {
    const ctx = buildReviewContext(() => createMockState() as never);
    expect(ctx.gameTitle).toBe('My Cool Game');
  });

  it('counts entities correctly', () => {
    const ctx = buildReviewContext(() => createMockState() as never);
    expect(ctx.entityCount).toBe(2);
  });

  it('counts scenes correctly', () => {
    const ctx = buildReviewContext(() => createMockState() as never);
    expect(ctx.sceneCount).toBe(2);
  });

  it('detects physics', () => {
    const ctx = buildReviewContext(() => createMockState() as never);
    expect(ctx.hasPhysics).toBe(true);
  });

  it('detects no physics when disabled', () => {
    const ctx = buildReviewContext(() =>
      createMockState({
        physicsEnabled: false,
        sceneGraph: {
          rootIds: ['e1'],
          nodes: {
            e1: { entityId: 'e1', name: 'Box', components: ['Mesh3d'], visible: true, children: [] },
          },
        },
      }) as never
    );
    expect(ctx.hasPhysics).toBe(false);
  });

  it('detects audio', () => {
    const ctx = buildReviewContext(() => createMockState() as never);
    expect(ctx.hasAudio).toBe(true);
  });

  it('counts enabled scripts', () => {
    const ctx = buildReviewContext(() => createMockState() as never);
    expect(ctx.scriptCount).toBe(1);
  });

  it('detects game mechanics', () => {
    const ctx = buildReviewContext(() => createMockState() as never);
    expect(ctx.mechanics).toContain('characterController');
    expect(ctx.mechanics).toContain('health');
  });

  it('infers action genre from characterController + health', () => {
    const ctx = buildReviewContext(() => createMockState() as never);
    expect(ctx.genre).toBe('action');
  });

  it('infers platformer genre from characterController only', () => {
    const ctx = buildReviewContext(() =>
      createMockState({ allGameComponents: { e1: [{ type: 'characterController' }] } }) as never
    );
    expect(ctx.genre).toBe('platformer');
  });

  it('detects entity types', () => {
    const ctx = buildReviewContext(() => createMockState() as never);
    expect(ctx.entityTypes).toContain('mesh');
    expect(ctx.entityTypes).toContain('directional_light');
  });

  it('counts lights', () => {
    const ctx = buildReviewContext(() => createMockState() as never);
    expect(ctx.lightCount).toBe(1);
  });

  it('detects post-processing', () => {
    const ctx = buildReviewContext(() => createMockState() as never);
    expect(ctx.hasPostProcessing).toBe(true);
  });

  it('detects skybox', () => {
    const ctx = buildReviewContext(() => createMockState() as never);
    expect(ctx.hasSkybox).toBe(true);
  });

  it('detects project type', () => {
    const ctx = buildReviewContext(() => createMockState({ projectType: '2d' }) as never);
    expect(ctx.projectType).toBe('2d');
  });

  it('handles empty scene gracefully', () => {
    const ctx = buildReviewContext(() =>
      createMockState({
        sceneGraph: { rootIds: [], nodes: {} },
        physicsEnabled: false,
        particleEnabled: false,
        primaryAudio: null,
        primaryAnimation: null,
        allScripts: undefined,
        allGameComponents: undefined,
        scenes: undefined,
        postProcessing: undefined,
        environment: undefined,
      }) as never
    );
    expect(ctx.entityCount).toBe(0);
    expect(ctx.sceneCount).toBe(1);
    expect(ctx.hasPhysics).toBe(false);
    expect(ctx.hasAudio).toBe(false);
    expect(ctx.scriptCount).toBe(0);
    expect(ctx.mechanics).toEqual([]);
    expect(ctx.genre).toBe('general');
  });

  it('defaults sceneName to Untitled', () => {
    const ctx = buildReviewContext(() => createMockState({ sceneName: undefined }) as never);
    expect(ctx.gameTitle).toBe('Untitled');
  });
});

// ---- REVIEWER_SYSTEM_PROMPT ----

describe('REVIEWER_SYSTEM_PROMPT', () => {
  it('contains scoring categories', () => {
    expect(REVIEWER_SYSTEM_PROMPT).toContain('funFactor');
    expect(REVIEWER_SYSTEM_PROMPT).toContain('polish');
    expect(REVIEWER_SYSTEM_PROMPT).toContain('difficulty');
    expect(REVIEWER_SYSTEM_PROMPT).toContain('originality');
    expect(REVIEWER_SYSTEM_PROMPT).toContain('accessibility');
    expect(REVIEWER_SYSTEM_PROMPT).toContain('replayability');
  });

  it('requests JSON output', () => {
    expect(REVIEWER_SYSTEM_PROMPT).toContain('JSON');
  });
});

// ---- generateReview (integration, mocked fetch) ----

describe('generateReview', () => {
  it('calls /api/chat and parses streaming response', async () => {
    const mockReview: GameReview = {
      title: 'Test Review',
      summary: 'A test game.',
      scores: { funFactor: 7, polish: 6, difficulty: 5, originality: 8, accessibility: 7, replayability: 5 },
      pros: ['Good'],
      cons: ['Short'],
      suggestions: ['Add more'],
      overallRating: 7,
      reviewText: 'This game is good.',
    };

    const jsonText = JSON.stringify(mockReview);
    const sseData = `data: ${JSON.stringify({ type: 'text_delta', text: jsonText })}\n\ndata: [DONE]\n\n`;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseData));
        controller.close();
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    }));

    const { generateReview } = await import('../gameReviewer');

    const context: ReviewContext = {
      gameTitle: 'Test',
      genre: 'action',
      mechanics: ['characterController'],
      entityCount: 10,
      sceneCount: 1,
      hasAudio: true,
      hasParticles: false,
      hasPhysics: true,
      scriptCount: 2,
      hasDialogue: false,
      hasUI: false,
      hasAnimations: false,
      hasSkybox: true,
      hasPostProcessing: false,
      projectType: '3d',
      entityTypes: ['mesh'],
      lightCount: 1,
    };

    const result = await generateReview(context);
    expect(result.title).toBe('Test Review');
    expect(result.overallRating).toBe(7);

    vi.unstubAllGlobals();
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ error: 'Server error' }),
    }));

    const { generateReview } = await import('../gameReviewer');

    const context: ReviewContext = {
      gameTitle: 'Test',
      genre: 'general',
      mechanics: [],
      entityCount: 0,
      sceneCount: 1,
      hasAudio: false,
      hasParticles: false,
      hasPhysics: false,
      scriptCount: 0,
      hasDialogue: false,
      hasUI: false,
      hasAnimations: false,
      hasSkybox: false,
      hasPostProcessing: false,
      projectType: '3d',
      entityTypes: [],
      lightCount: 0,
    };

    await expect(generateReview(context)).rejects.toThrow('Server error');

    vi.unstubAllGlobals();
  });
});
