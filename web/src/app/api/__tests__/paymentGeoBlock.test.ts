// @vitest-environment node
/**
 * Every payment surface refuses a sanctioned jurisdiction itself (#9331), not
 * only through the proxy. The set of payment routes is DERIVED from the tree:
 * every `app/api/**\/route.ts` that exports a mutating handler and either
 * imports the Stripe client or sits under a `purchase` directory, minus the
 * geo-block bypass paths (the Stripe webhook). A new payment route therefore
 * joins this suite without anyone remembering to add it, and fails until it
 * calls `sanctionsGeoBlock()`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GEO_BLOCK_BYPASS_PATHS, SANCTIONS_BLOCK_CODE } from '@/lib/security/sanctionsGeoBlock';

vi.mock('server-only', () => ({}));

const { withApiMiddleware, getStripe, checkBotIdGate, requireStepUp } = vi.hoisted(() => ({
  withApiMiddleware: vi.fn(),
  getStripe: vi.fn(),
  checkBotIdGate: vi.fn(),
  requireStepUp: vi.fn(),
}));

vi.mock('@/lib/api/middleware', () => ({ withApiMiddleware }));
vi.mock('@/lib/billing/stripe-client', () => ({ getStripe }));
vi.mock('@/lib/security/botId', () => ({ checkBotIdGate }));
vi.mock('@/lib/auth/step-up', () => ({ requireStepUp }));
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => { throw new Error('db must not be reached'); }),
  getNeonSql: vi.fn(() => { throw new Error('db must not be reached'); }),
  queryWithResilience: vi.fn(() => { throw new Error('db must not be reached'); }),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__') out.push(...walk(full));
    } else if (/^route\.(ts|tsx|js|jsx|mjs)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function urlPathOf(file: string): string {
  const rel = path.relative(apiDir, path.dirname(file)).split(path.sep).join('/');
  return `/api/${rel}`.replace(/\[([^\]]+)\]/g, 'x');
}

const PAYMENT_ROUTES = walk(apiDir)
  .filter((file) => {
    const src = readFileSync(file, 'utf8');
    const mutating = /^export const (POST|PUT|PATCH)\b/m.test(src);
    const stripe = /from '@\/lib\/billing\/stripe-client'/.test(src);
    const purchase = path.dirname(file).split(path.sep).includes('purchase');
    return mutating && (stripe || purchase);
  })
  .filter((file) => !GEO_BLOCK_BYPASS_PATHS.some((p) => urlPathOf(file) === p || urlPathOf(file).startsWith(`${p}/`)))
  .map((file) => ({ file, urlPath: urlPathOf(file) }));

function reqFrom(urlPath: string, country: string): NextRequest {
  return new NextRequest(`https://www.spawnforge.ai${urlPath}`, {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json', 'x-vercel-ip-country': country },
  });
}

describe('payment routes refuse sanctioned jurisdictions (#9331)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withApiMiddleware.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    checkBotIdGate.mockResolvedValue(null);
    requireStepUp.mockResolvedValue({ ok: true });
  });

  it('derives the payment surface it is meant to cover (vacuity guard)', () => {
    expect(PAYMENT_ROUTES.map((r) => r.urlPath).sort()).toEqual([
      '/api/billing/checkout',
      '/api/billing/portal',
      '/api/marketplace/assets/x/purchase',
      '/api/tokens/purchase',
    ]);
  });

  it.each(PAYMENT_ROUTES.map((r) => [r.urlPath, r.file] as const))(
    '%s answers 451 for a blocked country before auth, Stripe or the database',
    async (urlPath, file) => {
      const mod = (await import(file)) as { POST: (req: NextRequest, ctx: unknown) => Promise<Response> };
      const res = await mod.POST(reqFrom(urlPath, 'IR'), { params: Promise.resolve({ id: 'asset-1' }) });
      expect(res.status).toBe(451);
      expect(await res.json()).toMatchObject({ code: SANCTIONS_BLOCK_CODE });
      expect(withApiMiddleware).not.toHaveBeenCalled();
      expect(getStripe).not.toHaveBeenCalled();
      expect(checkBotIdGate).not.toHaveBeenCalled();
    },
  );

  it.each(PAYMENT_ROUTES.map((r) => [r.urlPath, r.file] as const))(
    '%s still reaches its normal checks for an allowed country (control)',
    async (urlPath, file) => {
      const mod = (await import(file)) as { POST: (req: NextRequest, ctx: unknown) => Promise<Response> };
      const res = await mod.POST(reqFrom(urlPath, 'US'), { params: Promise.resolve({ id: 'asset-1' }) });
      expect(res.status).not.toBe(451);
      expect(withApiMiddleware).toHaveBeenCalledTimes(1);
    },
  );
});
