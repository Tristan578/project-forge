vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
}));

import { rateLimitPublicRoute } from '@/lib/rateLimit';

const BASE_URL = 'http://localhost:3000/api/capabilities';

describe('GET /api/capabilities', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimitPublicRoute).mockResolvedValue(null);
    // Reset env to original state
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it('returns all capabilities with available/unavailable arrays', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest(BASE_URL);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.capabilities).toBeInstanceOf(Array);
    expect(body.available).toBeInstanceOf(Array);
    expect(body.unavailable).toBeInstanceOf(Array);
    expect(body.capabilities.length).toBe(10);
  });

  it('includes all expected capability types', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest(BASE_URL);
    const res = await GET(req);
    const body = await res.json();

    const capNames = body.capabilities.map((c: { capability: string }) => c.capability);
    expect(capNames).toContain('chat');
    expect(capNames).toContain('embedding');
    expect(capNames).toContain('image');
    expect(capNames).toContain('model3d');
    expect(capNames).toContain('sfx');
    expect(capNames).toContain('music');
    expect(capNames).toContain('sprite');
  });

  it('marks chat as available when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const { GET } = await import('./route');
    const req = new NextRequest(BASE_URL);
    const res = await GET(req);
    const body = await res.json();

    const chat = body.capabilities.find((c: { capability: string }) => c.capability === 'chat');
    expect(chat.available).toBe(true);
    expect(body.available).toContain('chat');
  });

  it('marks capability as unavailable when no env vars set', async () => {
    // Ensure no relevant env vars are set
    delete process.env.PLATFORM_MESHY_KEY;

    const { GET } = await import('./route');
    const req = new NextRequest(BASE_URL);
    const res = await GET(req);
    const body = await res.json();

    const model3d = body.capabilities.find((c: { capability: string }) => c.capability === 'model3d');
    expect(model3d.available).toBe(false);
    expect(model3d.requiredProviders).toBeDefined();
    expect(model3d.hint).toContain('Meshy');
    expect(body.unavailable).toContain('model3d');
  });

  it('marks an unprovisionable capability with the tracking issue instead of a key hint (#9117)', async () => {
    const { GET } = await import('./route');
    const res = await GET(new NextRequest(BASE_URL));
    const body = await res.json();

    const music = body.capabilities.find((c: { capability: string }) => c.capability === 'music');
    expect(music.available).toBe(false);
    expect(music.unprovisionable).toBe(true);
    expect(music.issue).toBe(9522);
    expect(music.hint).not.toContain('#9522');
    expect(music.requiredProviders).toBeUndefined();
  });

  it('includes human-readable labels', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest(BASE_URL);
    const res = await GET(req);
    const body = await res.json();

    const chat = body.capabilities.find((c: { capability: string }) => c.capability === 'chat');
    expect(chat.label).toBe('AI Chat');

    const sprite = body.capabilities.find((c: { capability: string }) => c.capability === 'sprite');
    expect(sprite.label).toBe('Sprite Generation');
  });

  it('sets cache control headers', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest(BASE_URL);
    const res = await GET(req);

    expect(res.headers.get('Cache-Control')).toContain('max-age=60');
  });

  it('returns rate limit response when limited', async () => {
    vi.mocked(rateLimitPublicRoute).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 }) as never
    );

    const { GET } = await import('./route');
    const req = new NextRequest(BASE_URL);
    const res = await GET(req);

    expect(res.status).toBe(429);
  });

  it('marks chat available via AI Gateway on Vercel', async () => {
    process.env.VERCEL = '1';
    // No explicit AI_GATEWAY_API_KEY needed — OIDC auto-auth

    const { GET } = await import('./route');
    const req = new NextRequest(BASE_URL);
    const res = await GET(req);
    const body = await res.json();

    const chat = body.capabilities.find((c: { capability: string }) => c.capability === 'chat');
    expect(chat.available).toBe(true);
  });

  // `vercel env pull` writes VERCEL_ENV without VERCEL, and the gateway backend
  // treats either as OIDC-capable. When this route accepted only VERCEL it
  // reported chat unavailable in exactly the environment the gateway was
  // serving it in.
  it('marks chat available via AI Gateway when only VERCEL_ENV is set', async () => {
    for (const key of ['VERCEL', 'AI_GATEWAY_API_KEY', 'OPENROUTER_API_KEY', 'GITHUB_MODELS_PAT', 'ANTHROPIC_API_KEY']) {
      delete process.env[key];
    }
    process.env.VERCEL_ENV = 'production';

    const { GET } = await import('./route');
    const req = new NextRequest(BASE_URL);
    const res = await GET(req);
    const body = await res.json();

    const chat = body.capabilities.find((c: { capability: string }) => c.capability === 'chat');
    expect(chat.available).toBe(true);
  });

  it('does not include requiredProviders for available capabilities', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const { GET } = await import('./route');
    const req = new NextRequest(BASE_URL);
    const res = await GET(req);
    const body = await res.json();

    const chat = body.capabilities.find((c: { capability: string }) => c.capability === 'chat');
    expect(chat.requiredProviders).toBeUndefined();
    expect(chat.hint).toBeUndefined();
  });
});
