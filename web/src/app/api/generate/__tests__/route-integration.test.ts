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

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  },
}));

vi.mock('@/lib/ai/contentSafety', () => ({
  sanitizePrompt: vi.fn((text: string) => ({ safe: true, filtered: text })),
}));

vi.mock('@/lib/tokens/service', () => ({
  refundTokens: vi.fn().mockResolvedValue({ refunded: true }),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
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
  PIXEL_ART_DITHERING_MODES: ['none', 'floyd-steinberg', 'ordered'],
  PIXEL_ART_STYLES: ['character', 'tile', 'icon', 'landscape'],
}));

// AI SDK mocks (pacing/localize)
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

  it('sprite-sheet: valid request → 201', async () => {
    const { POST } = await import('@/app/api/generate/sprite-sheet/route');
    const res = await POST(makeRequest('http://test/api/generate/sprite-sheet', {
      prompt: 'walk cycle', frameCount: 4, size: '64x64',
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.jobId).toBe('sheet-1');
  });

  it('tileset-gen: valid request → 201', async () => {
    const { POST } = await import('@/app/api/generate/tileset-gen/route');
    const res = await POST(makeRequest('http://test/api/generate/tileset-gen', {
      prompt: 'forest floor', tileSize: 32, gridSize: '8x8',
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.jobId).toBe('tile-1');
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
    expect(res.status).toBeGreaterThanOrEqual(400);
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
    expect(res.status).toBeGreaterThanOrEqual(400);
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
