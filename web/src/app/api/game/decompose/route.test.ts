vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { decomposeIntoSystems } from '@/lib/game-creation';
import { makeUser } from '@/test/utils/apiTestUtils';

vi.mock('@/lib/api/middleware');
vi.mock('@/lib/game-creation', () => ({
  decomposeIntoSystems: vi.fn(),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

function makeReq(body: unknown) {
  return new NextRequest('http://localhost:3000/api/game/decompose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockMiddlewareSuccess(overrides?: Partial<ReturnType<typeof makeUser>>) {
  const user = makeUser(overrides);
  vi.mocked(withApiMiddleware).mockResolvedValue({
    error: undefined,
    userId: user.id,
    authContext: { clerkId: 'clerk123', user } as never,
    body: undefined,
  });
  return user;
}

function mockMiddlewareError(status: number, error: string) {
  const { NextResponse } = require('next/server');
  vi.mocked(withApiMiddleware).mockResolvedValue({
    error: NextResponse.json({ error }, { status }),
    userId: null,
    authContext: null,
    body: undefined,
  });
}

const MOCK_GDD = {
  id: 'gdd-1',
  title: 'Test Game',
  description: 'test prompt',
  systems: [{ category: 'movement', type: 'walk', config: {}, priority: 'core', dependsOn: [] }],
  scenes: [{ name: 'Level 1', purpose: 'Main level', systems: ['movement'], entities: [], transitions: [] }],
  assetManifest: [],
  estimatedScope: 'small',
  styleDirective: 'default',
  feelDirective: { mood: 'fun', pacing: 'medium', weight: 'medium', referenceGames: [], oneLiner: 'test' },
  constraints: [],
  projectType: '3d',
};

describe('POST /api/game/decompose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with GDD on valid request', async () => {
    mockMiddlewareSuccess();
    vi.mocked(decomposeIntoSystems).mockResolvedValue(MOCK_GDD as never);

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: 'make a platformer', projectType: '3d' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gdd).toBeDefined();
    expect(body.gdd.title).toBe('Test Game');
  });

  it('calls decomposeIntoSystems with correct args', async () => {
    mockMiddlewareSuccess();
    vi.mocked(decomposeIntoSystems).mockResolvedValue(MOCK_GDD as never);

    const { POST } = await import('./route');
    await POST(makeReq({ prompt: 'jungle adventure', projectType: '2d' }));

    expect(decomposeIntoSystems).toHaveBeenCalledWith('jungle adventure', '2d');
  });

  it('returns 400 on missing prompt', async () => {
    mockMiddlewareSuccess();

    const { POST } = await import('./route');
    const res = await POST(makeReq({ projectType: '3d' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation_error');
  });

  it('returns 400 on invalid projectType', async () => {
    mockMiddlewareSuccess();

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: 'test', projectType: 'vr' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation_error');
  });

  it('returns 400 on empty prompt', async () => {
    mockMiddlewareSuccess();

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: '', projectType: '3d' }));

    expect(res.status).toBe(400);
  });

  it('returns 400 on prompt exceeding max length', async () => {
    mockMiddlewareSuccess();

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: 'x'.repeat(1001), projectType: '3d' }));

    expect(res.status).toBe(400);
  });

  it('returns middleware error for unauthenticated request', async () => {
    mockMiddlewareError(401, 'unauthorized');

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: 'test', projectType: '3d' }));

    expect(res.status).toBe(401);
  });

  it('returns 400 when prompt is rejected by sanitizer', async () => {
    mockMiddlewareSuccess();
    vi.mocked(decomposeIntoSystems).mockRejectedValue(
      new Error('Prompt rejected: content unsafe'),
    );

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: 'bad prompt', projectType: '3d' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('prompt_rejected');
  });

  it('returns 500 on LLM failure', async () => {
    mockMiddlewareSuccess();
    vi.mocked(decomposeIntoSystems).mockRejectedValue(
      new Error('LLM call failed: timeout'),
    );

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: 'test game', projectType: '3d' }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('decomposition_failed');
  });

  it('returns 400 on invalid JSON body', async () => {
    mockMiddlewareSuccess();

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/game/decompose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation_error');
  });
});
