/**
 * Wiring test (PF-910, #8820): proves the step-up guard is actually called by
 * the billing-portal route and that its 403 short-circuits the handler before
 * any Stripe call. A module is not done until its callers are wired — this
 * pins that wiring so a refactor can't silently drop the guard.
 *
 * @vitest-environment node
 */
vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { requireStepUp } from '@/lib/auth/step-up';
import { getStripe } from '@/lib/billing/stripe-client';

vi.mock('@/lib/api/middleware');
vi.mock('@/lib/auth/step-up');
vi.mock('@/lib/billing/stripe-client');
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));

function makeReq() {
  return new NextRequest('http://localhost:3000/api/billing/portal', { method: 'POST' });
}

function mockAuthed(stripeCustomerId: string | null = 'cus_123') {
  vi.mocked(withApiMiddleware).mockResolvedValue({
    error: undefined,
    userId: 'user_1',
    authContext: {
      clerkId: 'clerk_1',
      user: { id: 'user_1', stripeCustomerId } as never,
    },
    body: undefined,
  });
}

const portalCreate = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockAuthed();
  vi.mocked(getStripe).mockReturnValue({
    billingPortal: { sessions: { create: portalCreate } },
  } as never);
  portalCreate.mockResolvedValue({ url: 'https://billing.stripe.test/session' });
});

describe('POST /api/billing/portal — step-up wiring', () => {
  it('returns the step-up 403 and never calls Stripe when re-verification is stale', async () => {
    vi.mocked(requireStepUp).mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: 'Re-verification required', code: 'REVERIFICATION_REQUIRED' },
        { status: 403 },
      ),
    });

    const { POST } = await import('./route');
    const res = await POST(makeReq());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('REVERIFICATION_REQUIRED');
    // The destructive/financial side effect must not run when blocked.
    expect(portalCreate).not.toHaveBeenCalled();
  });

  it('proceeds to create the Stripe portal session when step-up is satisfied', async () => {
    vi.mocked(requireStepUp).mockResolvedValue({ ok: true });

    const { POST } = await import('./route');
    const res = await POST(makeReq());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe('https://billing.stripe.test/session');
    expect(requireStepUp).toHaveBeenCalledTimes(1);
    expect(portalCreate).toHaveBeenCalledTimes(1);
  });
});
