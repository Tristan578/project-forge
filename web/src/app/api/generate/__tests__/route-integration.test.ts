/**
 * Integration tests for all 12 generate routes through createGenerationHandler.
 *
 * These tests import the actual route POST handlers and send real NextRequest
 * objects through the full factory pipeline. Only external boundaries are mocked
 * (auth, rate limiting, key resolution, provider clients, Sentry).
 *
 * Purpose: catch mismatches between route callbacks (validate, execute, tokenCost,
 * provider, billingMetadata) and the factory that calls them. Unit tests for routes
 * mock at the wrong layer and would pass even if the factory contract changes.
 */

vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Shared mocks — only external boundaries
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequest: vi.fn(),
}));

vi.mock('@/lib/rateLimit', () => ({
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));

vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 300000 }),
  aggregateGenerationRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 900000 }),
}));

vi.mock('@/lib/keys/resolver', () => ({
  resolveApiKey: vi.fn(),
  ApiKeyError: class extends Error { code: string; constructor(c: string, m: string) { super(m); this.code = c; } },
}));

vi.mock('@/lib/tokens/pricing', () => ({
  getTokenCost: vi.fn().mockReturnValue(10),
  TOKEN_COSTS: {
    sprite_generation_dalle3: 20,
    sprite_generation_replicate: 10,
    sprite_sheet_cost_per_frame: 15,
    tileset_generation: 50,
    pixel_art_replicate: 10,
    pixel_art_openai: 20,
    localize_cost_per_chunk: 5,
  },
}));

vi.mock('@/lib/ai/contentSafety', () => ({
  sanitizePrompt: vi.fn((text: string) => ({ safe: true, filtered: text })),
}));

vi.mock('@/lib/tokens/service', () => ({
  refundTokens: vi.fn().mockResolvedValue({ refunded: true }),
}));

// Disable the response cache for these tests. The real cache keeps a
// module-level memory Map that survives `vi.resetModules()`, so a request
// identical to one an earlier test already ran returns a cache HIT and never
// re-invokes resolveApiKey / the provider — masking provider-failure and
// billing-metadata assertions (pre-existing flake, PF-916). Here we exercise
// the route↔factory↔provider contract, not the cache, so make cachedGenerate a
// passthrough that always runs the execute callback.
vi.mock('@/lib/api/responseCache', () => ({
  cachedGenerate: vi.fn(async (_op: string, _params: unknown, executeFn: () => Promise<unknown>) => ({
    result: await executeFn(),
    cached: false,
  })),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  queryWithResilience: vi.fn((fn: () => unknown) => fn()),
  getDb: vi.fn().mockReturnValue({}),
  getNeonSql: vi.fn().mockReturnValue(
    Object.assign(vi.fn(), { transaction: vi.fn().mockResolvedValue([]) }),
  ),
}));

// Provider client mocks
vi.mock('@/lib/generate/elevenlabsClient', () => ({
  ElevenLabsClient: vi.fn(function (this: Record<string, unknown>) {
    this.generateSfx = vi.fn().mockResolvedValue({ audioBase64: 'base64==', durationSeconds: 5 });
    this.generateVoice = vi.fn().mockResolvedValue({ audioBase64: 'base64==', durationSeconds: 3 });
  }),
}));

vi.mock('@/lib/generate/meshyClient', () => ({
  MeshyClient: vi.fn(function (this: Record<string, unknown>) {
    this.createTextTo3D = vi.fn().mockResolvedValue({ taskId: 'meshy-1' });
    this.createImageTo3D = vi.fn().mockResolvedValue({ taskId: 'meshy-2' });
    this.createTextToTexture = vi.fn().mockResolvedValue({ taskId: 'meshy-3' });
  }),
}));

vi.mock('@/lib/generate/sunoClient', () => ({
  SunoClient: vi.fn(function (this: Record<string, unknown>) {
    this.createMusic = vi.fn().mockResolvedValue({ taskId: 'suno-1' });
  }),
}));

vi.mock('@/lib/generate/spriteClient', () => ({
  SpriteClient: vi.fn(function (this: Record<string, unknown>) {
    this.generateSprite = vi.fn().mockResolvedValue({ taskId: 'sprite-1', status: 'pending' });
    this.generateSpriteSheet = vi.fn().mockResolvedValue({ taskId: 'sheet-1', status: 'pending' });
    this.generateTileset = vi.fn().mockResolvedValue({ taskId: 'tile-1', status: 'pending' });
  }),
}));

vi.mock('@/lib/generate/pixelArtClient', () => ({
  PixelArtClient: vi.fn(function (this: Record<string, unknown>) {
    this.generate = vi.fn().mockResolvedValue({ predictionId: 'pxart-1' });
  }),
}));

vi.mock('@/lib/generate/palettes', () => ({
  PALETTES: { nes: { name: 'NES', colors: ['#000'] }, custom: { name: 'Custom', colors: [] } },
  getPalette: vi.fn().mockReturnValue({ name: 'NES', colors: ['#000'] }),
  validateCustomPalette: vi.fn().mockReturnValue({ valid: true }),
}));

vi.mock('@/lib/config/providers', () => ({
  DB_PROVIDER: {
    chat: 'anthropic', sfx: 'elevenlabs', voice: 'elevenlabs', music: 'suno',
    model3d: 'meshy', texture: 'meshy', sprite: 'replicate', image: 'openai',
  },
  SPRITE_SIZES: ['32x32', '64x64', '128x128', '256x256', '512x512', '1024x1024'],
  SPRITE_ESTIMATED_SECONDS: { dalle3: 15, sdxl: 30 },
  PIXEL_ART_SIZES: [16, 32, 64, 128],
  PIXEL_ART_DITHERING_MODES: ['none', 'bayer4x4', 'bayer8x8'],
  PIXEL_ART_STYLES: ['character', 'prop', 'tile', 'icon', 'environment'],
}));

// AI SDK mocks for the pacing/localize routes' LLM calls. The generation agent
// itself takes no AI SDK dependency — it's an honest single-step executor that
// only races the provider call against an AbortSignal deadline.
vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({
    text: '[]',
    output: [{ title: 'Test', description: 'Test suggestion', priority: 'medium', targetSceneIndex: null }],
  }),
  Output: { object: vi.fn().mockReturnValue({}) },
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn().mockReturnValue(vi.fn().mockReturnValue('mock-model')),
}));

vi.mock('@/lib/ai/models', () => ({ AI_MODEL_FAST: 'claude-mock' }));

vi.mock('@/lib/i18n/gameLocalization', () => ({
  buildTranslationPrompt: vi.fn().mockReturnValue('translate these'),
  parseTranslationResponse: vi.fn().mockReturnValue({ translations: { hello: 'hola' } }),
  chunkArray: vi.fn((arr: unknown[]) => [arr]),
  LOCALE_MAP: new Map([['es', 'Spanish'], ['fr', 'French'], ['de', 'German']]),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey } from '@/lib/keys/resolver';

const mockAuth = vi.mocked(authenticateRequest);
const mockResolve = vi.mocked(resolveApiKey);

function makeRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    ok: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx: { user: { id: 'user-int', tier: 'pro' } as any, clerkId: 'clerk-int' },
  });
  mockResolve.mockResolvedValue({ type: 'platform', key: 'test-key', metered: true, usageId: 'usage-int' });
});

// ---------------------------------------------------------------------------
// Integration tests — happy path through real route → factory → mock provider
// ---------------------------------------------------------------------------

describe('generate route integration (route → factory → provider)', () => {
  it('sfx: valid request → 200 with audioBase64', async () => {
    const { POST } = await import('@/app/api/generate/sfx/route');
    const res = await POST(makeRequest('http://test/api/generate/sfx', { prompt: 'explosion', durationSeconds: 3 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.audioBase64).toBe('base64==');
    expect(data.provider).toBe('elevenlabs');
  });

  it('voice: valid request → 200 with audioBase64', async () => {
    const { POST } = await import('@/app/api/generate/voice/route');
    const res = await POST(makeRequest('http://test/api/generate/voice', { text: 'Hello world' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.audioBase64).toBe('base64==');
  });

  it('music: valid request → 201 with jobId', async () => {
    const { POST } = await import('@/app/api/generate/music/route');
    const res = await POST(makeRequest('http://test/api/generate/music', { prompt: 'epic battle', durationSeconds: 30 }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.jobId).toBe('suno-1');
    expect(data.usageId).toBe('usage-int');
  });

  it('skybox: valid request → 201 with jobId', async () => {
    const { POST } = await import('@/app/api/generate/skybox/route');
    const res = await POST(makeRequest('http://test/api/generate/skybox', { prompt: 'sunset clouds' }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.jobId).toBe('meshy-3');
  });

  it('texture: valid request → 201 with jobId', async () => {
    const { POST } = await import('@/app/api/generate/texture/route');
    const res = await POST(makeRequest('http://test/api/generate/texture', { prompt: 'brick wall' }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.jobId).toBe('meshy-3');
  });

  it('model (text-to-3d): valid request → 201 with jobId', async () => {
    const { POST } = await import('@/app/api/generate/model/route');
    const res = await POST(makeRequest('http://test/api/generate/model', { prompt: 'red cube', mode: 'text-to-3d' }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.jobId).toBe('meshy-1');
    expect(data.usageId).toBe('usage-int');
  });

  it('model (image-to-3d): valid request → 201', async () => {
    const { POST } = await import('@/app/api/generate/model/route');
    const res = await POST(makeRequest('http://test/api/generate/model', {
      prompt: 'from image', mode: 'image-to-3d', imageBase64: 'abc123',
    }));
    expect(res.status).toBe(201);
  });

  it('sprite: valid request → 201 with jobId', async () => {
    const { POST } = await import('@/app/api/generate/sprite/route');
    const res = await POST(makeRequest('http://test/api/generate/sprite', {
      prompt: 'hero character', size: '64x64', removeBackground: true,
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.usageId).toBe('usage-int');
  });

  it('sprite-sheet: valid request → 201 with jobId and usageId', async () => {
    const { POST } = await import('@/app/api/generate/sprite-sheet/route');
    const res = await POST(makeRequest('http://test/api/generate/sprite-sheet', {
      prompt: 'walk cycle', frameCount: 4, size: '64x64',
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.jobId).toBe('sheet-1');
    expect(data.usageId).toBe('usage-int');
  });

  it('tileset-gen: valid request → 201 with jobId and usageId', async () => {
    const { POST } = await import('@/app/api/generate/tileset-gen/route');
    const res = await POST(makeRequest('http://test/api/generate/tileset-gen', {
      prompt: 'forest floor', tileSize: 32, gridSize: '8x8',
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.jobId).toBe('tile-1');
    expect(data.usageId).toBe('usage-int');
  });

  it('pixel-art: valid request → 201', async () => {
    const { POST } = await import('@/app/api/generate/pixel-art/route');
    const res = await POST(makeRequest('http://test/api/generate/pixel-art', {
      prompt: 'wizard sprite', targetSize: 32, palette: 'nes',
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.jobId).toBe('pxart-1');
    expect(data.usageId).toBe('usage-int');
  });

  it('pacing: valid request → 200 with enriched report', async () => {
    const { POST } = await import('@/app/api/generate/pacing/route');
    const res = await POST(makeRequest('http://test/api/generate/pacing', {
      report: {
        score: 75,
        curve: {
          segments: [{ sceneIndex: 0, sceneName: 'Intro', intensity: 0.3, emotion: 'calm' }],
          averageIntensity: 0.3,
          variance: 0.01,
        },
        suggestions: [{ title: 'Existing', description: 'Already here', priority: 'low' }],
      },
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.suggestions.length).toBeGreaterThanOrEqual(1);
  });

  it('localize: valid request → 200 with translations', async () => {
    const { POST } = await import('@/app/api/generate/localize/route');
    const res = await POST(makeRequest('http://test/api/generate/localize', {
      strings: [{ id: 'greeting', text: 'Hello', context: 'Menu button' }],
      sourceLocale: 'en',
      targetLocales: ['es'],
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.locales.es.translations.hello).toBe('hola');
  });

  // -------------------------------------------------------------------------
  // Validation rejection tests — verify route validate() rejects bad input
  // -------------------------------------------------------------------------

  it('sfx: rejects missing prompt', async () => {
    const { POST } = await import('@/app/api/generate/sfx/route');
    const res = await POST(makeRequest('http://test/api/generate/sfx', { durationSeconds: 3 }));
    expect(res.status).toBe(422);
  });

  it('sprite: rejects invalid size', async () => {
    const { POST } = await import('@/app/api/generate/sprite/route');
    const res = await POST(makeRequest('http://test/api/generate/sprite', {
      prompt: 'test', size: '999x999', removeBackground: true,
    }));
    expect(res.status).toBe(422);
  });

  it('model: rejects invalid mode', async () => {
    const { POST } = await import('@/app/api/generate/model/route');
    const res = await POST(makeRequest('http://test/api/generate/model', {
      prompt: 'test', mode: 'invalid-mode',
    }));
    expect(res.status).toBe(422);
  });

  it('tileset-gen: rejects invalid tileSize', async () => {
    const { POST } = await import('@/app/api/generate/tileset-gen/route');
    const res = await POST(makeRequest('http://test/api/generate/tileset-gen', {
      prompt: 'test', tileSize: 99, gridSize: '8x8',
    }));
    expect(res.status).toBe(422);
  });

  it('sprite-sheet: rejects non-integer frameCount', async () => {
    const { POST } = await import('@/app/api/generate/sprite-sheet/route');
    const res = await POST(makeRequest('http://test/api/generate/sprite-sheet', {
      prompt: 'test', frameCount: 2.5, size: '64x64',
    }));
    expect(res.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // Provider failure + refund test
  // -------------------------------------------------------------------------

  it('sfx: provider failure triggers refund and returns 500', async () => {
    const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
    vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: Record<string, unknown>) {
      this.generateSfx = vi.fn().mockRejectedValue(new Error('Provider down'));
      this.generateVoice = vi.fn();
    } as never);

    const { refundTokens } = await import('@/lib/tokens/service');
    const { POST } = await import('@/app/api/generate/sfx/route');
    const res = await POST(makeRequest('http://test/api/generate/sfx', { prompt: 'explosion', durationSeconds: 3 }));
    expect(res.status).toBe(500);
    expect(refundTokens).toHaveBeenCalledWith('user-int', 'usage-int');
  });

  // -------------------------------------------------------------------------
  // Null/array body guard
  // -------------------------------------------------------------------------

  it('any route: null JSON body → 400', async () => {
    const { POST } = await import('@/app/api/generate/sfx/route');
    const req = new NextRequest('http://test/api/generate/sfx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // billingMetadata test — verify large fields excluded
  // -------------------------------------------------------------------------

  it('model: billingMetadata excludes imageBase64', async () => {
    const { POST } = await import('@/app/api/generate/model/route');
    await POST(makeRequest('http://test/api/generate/model', {
      prompt: 'from image', mode: 'image-to-3d', imageBase64: 'x'.repeat(10000),
    }));

    // resolveApiKey metadata should NOT contain imageBase64
    const call = mockResolve.mock.calls[0];
    const metadata = call[4] as Record<string, unknown>;
    expect(metadata).not.toHaveProperty('imageBase64');
    expect(metadata).toHaveProperty('prompt');
    expect(metadata).toHaveProperty('mode');
  });

  it('localize: billingMetadata passes counts not arrays', async () => {
    const { POST } = await import('@/app/api/generate/localize/route');
    await POST(makeRequest('http://test/api/generate/localize', {
      strings: [{ id: 'a', text: 'Hello', context: 'btn' }],
      sourceLocale: 'en',
      targetLocales: ['es'],
    }));

    const call = mockResolve.mock.calls[0];
    const metadata = call[4] as Record<string, unknown>;
    expect(metadata).not.toHaveProperty('strings');
    expect(metadata.stringCount).toBe(1);
    expect(metadata.localeCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PF-916: same routes, run through the generation AGENT (flag ON).
//
// The blast radius of createGenerationHandler demands proof the contract is
// identical on the agent path: same status codes, same response shape, the
// usageId still present, and refund-on-failure still fires. We do NOT mock the
// agent — the real runGenerationAgent single-step executor runs, only the env
// flag flips.
// ---------------------------------------------------------------------------

describe('generate route integration — generation agent path (USE_GENERATION_AGENT=true)', () => {
  const originalFlag = process.env.USE_GENERATION_AGENT;

  beforeEach(() => {
    process.env.USE_GENERATION_AGENT = 'true';
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.USE_GENERATION_AGENT;
    else process.env.USE_GENERATION_AGENT = originalFlag;
  });

  it('sfx: 200 with audioBase64 (identical to legacy path)', async () => {
    const { POST } = await import('@/app/api/generate/sfx/route');
    const res = await POST(makeRequest('http://test/api/generate/sfx', { prompt: 'explosion', durationSeconds: 3 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.audioBase64).toBe('base64==');
    expect(data.provider).toBe('elevenlabs');
  });

  it('music: 201 with jobId AND usageId preserved through the agent', async () => {
    const { POST } = await import('@/app/api/generate/music/route');
    const res = await POST(makeRequest('http://test/api/generate/music', { prompt: 'epic battle', durationSeconds: 30 }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.jobId).toBe('suno-1');
    expect(data.usageId).toBe('usage-int');
  });

  it('model: 201 with jobId AND usageId preserved through the agent', async () => {
    const { POST } = await import('@/app/api/generate/model/route');
    const res = await POST(makeRequest('http://test/api/generate/model', { prompt: 'red cube', mode: 'text-to-3d' }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.jobId).toBe('meshy-1');
    expect(data.usageId).toBe('usage-int');
  });

  it('sprite: 201 with usageId preserved through the agent', async () => {
    const { POST } = await import('@/app/api/generate/sprite/route');
    const res = await POST(makeRequest('http://test/api/generate/sprite', {
      prompt: 'hero character', size: '64x64', removeBackground: true,
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.usageId).toBe('usage-int');
  });

  it('pixel-art: 201 with jobId + usageId through the agent', async () => {
    const { POST } = await import('@/app/api/generate/pixel-art/route');
    const res = await POST(makeRequest('http://test/api/generate/pixel-art', {
      prompt: 'wizard sprite', targetSize: 32, palette: 'nes',
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.jobId).toBe('pxart-1');
    expect(data.usageId).toBe('usage-int');
  });

  it('sprite-sheet: 201 with jobId AND usageId preserved through the agent', async () => {
    const { POST } = await import('@/app/api/generate/sprite-sheet/route');
    const res = await POST(makeRequest('http://test/api/generate/sprite-sheet', {
      prompt: 'walk cycle', frameCount: 4, size: '64x64',
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.jobId).toBe('sheet-1');
    expect(data.usageId).toBe('usage-int');
  });

  it('tileset-gen: 201 with jobId AND usageId preserved through the agent', async () => {
    const { POST } = await import('@/app/api/generate/tileset-gen/route');
    const res = await POST(makeRequest('http://test/api/generate/tileset-gen', {
      prompt: 'forest floor', tileSize: 32, gridSize: '8x8',
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.jobId).toBe('tile-1');
    expect(data.usageId).toBe('usage-int');
  });

  it('agent path: provider failure still triggers refund and returns 500', async () => {
    const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
    vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: Record<string, unknown>) {
      this.generateSfx = vi.fn().mockRejectedValue(new Error('Provider down'));
      this.generateVoice = vi.fn();
    } as never);

    const { refundTokens } = await import('@/lib/tokens/service');
    const { POST } = await import('@/app/api/generate/sfx/route');
    const res = await POST(makeRequest('http://test/api/generate/sfx', { prompt: 'explosion', durationSeconds: 3 }));
    expect(res.status).toBe(500);
    expect(refundTokens).toHaveBeenCalledWith('user-int', 'usage-int');
  });

  it('agent path: validation rejection still 422 (never reaches the agent)', async () => {
    const { POST } = await import('@/app/api/generate/sfx/route');
    const res = await POST(makeRequest('http://test/api/generate/sfx', { durationSeconds: 3 }));
    expect(res.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // Test 17: abort forwarding — each route's provider mock receives
  // ctx.abortSignal (an AbortSignal) on the agent path (PF-916, Design §7).
  //
  // The mocks are constructor-shaped (vi.fn(function (this) { ... })), so
  // method mocks live on instances, not the prototype. Access via
  // vi.mocked(Ctor).mock.instances.at(-1) — the instance from this request,
  // since vi.clearAllMocks() runs in beforeEach.
  // -------------------------------------------------------------------------

  it('test 17 — model route: MeshyClient.createTextTo3D receives ctx.abortSignal', async () => {
    const { MeshyClient } = await import('@/lib/generate/meshyClient');
    const { POST } = await import('@/app/api/generate/model/route');
    const res = await POST(makeRequest('http://test/api/generate/model', { prompt: 'cube', mode: 'text-to-3d' }));
    expect(res.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = vi.mocked(MeshyClient).mock.instances.at(-1) as any;
    expect(instance.createTextTo3D.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it('test 17 — model route (image-to-3d): MeshyClient.createImageTo3D receives ctx.abortSignal', async () => {
    const { MeshyClient } = await import('@/lib/generate/meshyClient');
    const { POST } = await import('@/app/api/generate/model/route');
    const res = await POST(makeRequest('http://test/api/generate/model', {
      prompt: 'from image', mode: 'image-to-3d', imageBase64: 'abc123',
    }));
    expect(res.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = vi.mocked(MeshyClient).mock.instances.at(-1) as any;
    expect(instance.createImageTo3D.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it('test 17 — texture route: MeshyClient.createTextToTexture receives ctx.abortSignal', async () => {
    const { MeshyClient } = await import('@/lib/generate/meshyClient');
    const { POST } = await import('@/app/api/generate/texture/route');
    const res = await POST(makeRequest('http://test/api/generate/texture', { prompt: 'brick wall' }));
    expect(res.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = vi.mocked(MeshyClient).mock.instances.at(-1) as any;
    expect(instance.createTextToTexture.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it('test 17 — skybox route: MeshyClient.createTextToTexture receives ctx.abortSignal', async () => {
    const { MeshyClient } = await import('@/lib/generate/meshyClient');
    const { POST } = await import('@/app/api/generate/skybox/route');
    const res = await POST(makeRequest('http://test/api/generate/skybox', { prompt: 'sunset clouds' }));
    expect(res.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = vi.mocked(MeshyClient).mock.instances.at(-1) as any;
    expect(instance.createTextToTexture.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it('test 17 — music route: SunoClient.createMusic receives ctx.abortSignal', async () => {
    const { SunoClient } = await import('@/lib/generate/sunoClient');
    const { POST } = await import('@/app/api/generate/music/route');
    const res = await POST(makeRequest('http://test/api/generate/music', { prompt: 'epic battle', durationSeconds: 30 }));
    expect(res.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = vi.mocked(SunoClient).mock.instances.at(-1) as any;
    expect(instance.createMusic.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it('test 17 — sfx route: ElevenLabsClient.generateSfx receives ctx.abortSignal', async () => {
    const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
    const { POST } = await import('@/app/api/generate/sfx/route');
    const res = await POST(makeRequest('http://test/api/generate/sfx', { prompt: 'explosion', durationSeconds: 3 }));
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = vi.mocked(ElevenLabsClient).mock.instances.at(-1) as any;
    expect(instance.generateSfx.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it('test 17 — voice route: ElevenLabsClient.generateVoice receives ctx.abortSignal', async () => {
    const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
    const { POST } = await import('@/app/api/generate/voice/route');
    const res = await POST(makeRequest('http://test/api/generate/voice', { text: 'Hello world' }));
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = vi.mocked(ElevenLabsClient).mock.instances.at(-1) as any;
    expect(instance.generateVoice.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it('test 17 — sprite route: SpriteClient.generateSprite receives ctx.abortSignal', async () => {
    const { SpriteClient } = await import('@/lib/generate/spriteClient');
    const { POST } = await import('@/app/api/generate/sprite/route');
    const res = await POST(makeRequest('http://test/api/generate/sprite', {
      prompt: 'hero character', size: '64x64', removeBackground: true,
    }));
    expect(res.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = vi.mocked(SpriteClient).mock.instances.at(-1) as any;
    expect(instance.generateSprite.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it('test 17 — sprite-sheet route: SpriteClient.generateSpriteSheet receives ctx.abortSignal', async () => {
    const { SpriteClient } = await import('@/lib/generate/spriteClient');
    const { POST } = await import('@/app/api/generate/sprite-sheet/route');
    const res = await POST(makeRequest('http://test/api/generate/sprite-sheet', {
      prompt: 'walk cycle', frameCount: 4, size: '64x64',
    }));
    expect(res.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = vi.mocked(SpriteClient).mock.instances.at(-1) as any;
    expect(instance.generateSpriteSheet.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it('test 17 — pixel-art route: PixelArtClient.generate receives ctx.abortSignal', async () => {
    const { PixelArtClient } = await import('@/lib/generate/pixelArtClient');
    const { POST } = await import('@/app/api/generate/pixel-art/route');
    const res = await POST(makeRequest('http://test/api/generate/pixel-art', {
      prompt: 'wizard sprite', targetSize: 32, palette: 'nes',
    }));
    expect(res.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = vi.mocked(PixelArtClient).mock.instances.at(-1) as any;
    expect(instance.generate.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it('test 17 — tileset-gen route: SpriteClient.generateTileset receives ctx.abortSignal', async () => {
    const { SpriteClient } = await import('@/lib/generate/spriteClient');
    const { POST } = await import('@/app/api/generate/tileset-gen/route');
    const res = await POST(makeRequest('http://test/api/generate/tileset-gen', {
      prompt: 'forest floor', tileSize: 32, gridSize: '8x8',
    }));
    expect(res.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = vi.mocked(SpriteClient).mock.instances.at(-1) as any;
    expect(instance.generateTileset.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it('test 17 — localize route: generateText receives abortSignal option', async () => {
    const { generateText } = await import('ai');
    const { POST } = await import('@/app/api/generate/localize/route');
    const res = await POST(makeRequest('http://test/api/generate/localize', {
      strings: [{ id: 'greeting', text: 'Hello', context: 'Menu button' }],
      sourceLocale: 'en',
      targetLocales: ['es'],
    }));
    expect(res.status).toBe(200);
    const calls = vi.mocked(generateText).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('test 17 — pacing route: generateText receives abortSignal option', async () => {
    const { generateText } = await import('ai');
    const { POST } = await import('@/app/api/generate/pacing/route');
    const res = await POST(makeRequest('http://test/api/generate/pacing', {
      report: {
        score: 75,
        curve: {
          segments: [{ sceneIndex: 0, sceneName: 'Intro', intensity: 0.3, emotion: 'calm' }],
          averageIntensity: 0.3,
          variance: 0.01,
        },
        suggestions: [],
      },
    }));
    expect(res.status).toBe(200);
    const calls = vi.mocked(generateText).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
  });

  // -------------------------------------------------------------------------
  // Test 18: maxDuration parity regression pin.
  //
  // Pins the exported maxDuration for every route (model/music=180, localize=120,
  // all others=60). This locks the relationship between each route's Vercel budget
  // and the maxDurationSeconds config passed to createGenerationHandler, which
  // drives deriveGenerationStepTimeoutMs. A drift here would make the agent abort
  // either too late (outliving the function) or too early (spurious refunds).
  // Passes against current code by design — its job is to prevent future drift.
  // -------------------------------------------------------------------------

  it('test 18 — all routes export maxDuration that matches factory maxDurationSeconds (regression pin)', async () => {
    const [
      model, music, localize,
      sfx, voice, skybox, texture,
      sprite, spriteSheet, pixelArt, tilesetGen, pacing,
    ] = await Promise.all([
      import('@/app/api/generate/model/route'),
      import('@/app/api/generate/music/route'),
      import('@/app/api/generate/localize/route'),
      import('@/app/api/generate/sfx/route'),
      import('@/app/api/generate/voice/route'),
      import('@/app/api/generate/skybox/route'),
      import('@/app/api/generate/texture/route'),
      import('@/app/api/generate/sprite/route'),
      import('@/app/api/generate/sprite-sheet/route'),
      import('@/app/api/generate/pixel-art/route'),
      import('@/app/api/generate/tileset-gen/route'),
      import('@/app/api/generate/pacing/route'),
    ]);

    // Heavy provider routes: 180s budget (maxDurationSeconds: 180 in factory config)
    expect(model.maxDuration).toBe(180);
    expect(music.maxDuration).toBe(180);
    // LLM batch route: 120s budget (maxDurationSeconds: 120 in factory config)
    expect(localize.maxDuration).toBe(120);
    // Standard routes: 60s budget (factory derives 55s step cap from this)
    expect(sfx.maxDuration).toBe(60);
    expect(voice.maxDuration).toBe(60);
    expect(skybox.maxDuration).toBe(60);
    expect(texture.maxDuration).toBe(60);
    expect(sprite.maxDuration).toBe(60);
    expect(spriteSheet.maxDuration).toBe(60);
    expect(pixelArt.maxDuration).toBe(60);
    expect(tilesetGen.maxDuration).toBe(60);
    expect(pacing.maxDuration).toBe(60);
  });

  // -------------------------------------------------------------------------
  // Test 19: end-to-end timeout → GenerationTimeoutError → refund (regression pin).
  //
  // Proves the real factory drives the abort through the agent's timeout when
  // a provider call never resolves. The agent defaults to globalThis.setTimeout
  // (generationAgent.ts:143-145) so vi.useFakeTimers() fires the deadline.
  // stepTimeoutMs for a 60s route = deriveGenerationStepTimeoutMs(60) = 55_000ms.
  // Passes against current code (path shipped in #8833) — its job is to prove
  // the composed path through the REAL factory, not the agent unit seam.
  // -------------------------------------------------------------------------

  it('test 19 — flag-on route timeout fires GenerationTimeoutError → refund → opaque 500 (regression pin)', async () => {
    vi.useFakeTimers();
    try {
      const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
      vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: Record<string, unknown>) {
        this.generateSfx = vi.fn().mockReturnValue(new Promise<never>(() => {}));
        this.generateVoice = vi.fn();
      } as never);

      const { refundTokens } = await import('@/lib/tokens/service');
      const { POST } = await import('@/app/api/generate/sfx/route');

      const responsePromise = POST(makeRequest('http://test/api/generate/sfx', { prompt: 'explosion', durationSeconds: 3 }));

      // deriveGenerationStepTimeoutMs(60) = 60*1000 - 5000 = 55_000ms
      await vi.advanceTimersByTimeAsync(55_001);

      const res = await responsePromise;
      expect(res.status).toBe(500);
      expect(refundTokens).toHaveBeenCalledWith('user-int', 'usage-int');
    } finally {
      vi.useRealTimers();
    }
  });
});
