vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { STATUS_CHECK_OPERATION } from '@/lib/keys/statusCheckOperation';
import { verifyProviderJobOwner } from '@/lib/generate/jobOwnership';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import type { User } from '@/lib/db/schema';
import { withRetryGuidance } from '@/lib/generate/retryGuidance';
import { JOB_NOT_FOUND_MESSAGE, JOB_OWNERSHIP_UNAVAILABLE_MESSAGE } from '@/lib/generate/jobNotFound';

const mockGetReplicateStatus = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/keys/resolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/keys/resolver')>();
  return { ...mod, resolveApiKey: vi.fn() };
});
vi.mock('@/lib/generate/jobOwnership', () => ({
  verifyProviderJobOwner: vi.fn(),
}));
vi.mock('@/lib/generate/spriteClient', () => ({
  SpriteClient: class MockSpriteClient {
    getReplicateStatus = mockGetReplicateStatus;
  },
}));

const makeRequest = (params: Record<string, string>) => {
  const url = new URL('http://localhost/api/generate/tileset-gen/status');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
};

describe('GET /api/generate/tileset-gen/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyProviderJobOwner).mockResolvedValue('owner');
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await GET(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it('returns 400 if jobId is missing', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const res = await GET(makeRequest({}));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain('Missing jobId');
  });

  it('returns 402 if API key cannot be resolved', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockRejectedValue(
      new ApiKeyError('INSUFFICIENT_TOKENS', 'Not enough tokens')
    );

    const res = await GET(makeRequest({ jobId: 'pred_tile_abc' }));
    const data = await res.json();
    expect(res.status).toBe(402);
    expect(data.error).toBe('Not enough tokens');
  });

  // Ownership check (#10262): without this, any signed-in caller admitted past
  // the tier gate could poll a job id they never created and read back another
  // user's result via the platform key `resolveApiKey` returns by default.
  describe('job ownership (#10262)', () => {
    it('returns 404 without resolving a key when the caller does not own the job', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
      vi.mocked(verifyProviderJobOwner).mockResolvedValue('not_owner');

      const res = await GET(makeRequest({ jobId: 'pred_tile_abc' }));
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe(JOB_NOT_FOUND_MESSAGE);
      expect(resolveApiKey).not.toHaveBeenCalled();
      expect(mockGetReplicateStatus).not.toHaveBeenCalled();
    });

    // A lookup that failed (DB error, open circuit breaker) is NOT a verdict
    // on the job: still fail-closed (no key resolved), but 503, which the
    // poller keeps polling through, never the 404 it treats as terminal.
    it('returns a retryable 503, not a terminal 404, and resolves no key when the ownership lookup FAILS', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
      vi.mocked(verifyProviderJobOwner).mockResolvedValue('unverifiable');

      const res = await GET(makeRequest({ jobId: 'pred_tile_abc' }));
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.error).toBe(JOB_OWNERSHIP_UNAVAILABLE_MESSAGE);
      expect(resolveApiKey).not.toHaveBeenCalled();
      expect(mockGetReplicateStatus).not.toHaveBeenCalled();
    });

    it('checks ownership with the authenticated userId, the sprite provider, and the polled jobId', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
      vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
      mockGetReplicateStatus.mockResolvedValue({ status: 'processing', output: undefined });

      await GET(makeRequest({ jobId: 'pred_tile_abc' }));

      expect(verifyProviderJobOwner).toHaveBeenCalledTimes(1);
      expect(verifyProviderJobOwner).toHaveBeenCalledWith(user.id, 'replicate', 'pred_tile_abc');
    });
  });

  it('returns completed status with resultUrl when prediction succeeded', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    mockGetReplicateStatus.mockResolvedValue({
      status: 'succeeded',
      output: ['https://replicate.delivery/tileset.png'],
    });

    const res = await GET(makeRequest({ jobId: 'pred_tile_abc' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('completed');
    expect(data.resultUrl).toBe('https://replicate.delivery/tileset.png');
    expect(data.progress).toBe(100);
  });

  it('returns failed status when prediction failed', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    mockGetReplicateStatus.mockResolvedValue({ status: 'failed', output: undefined });

    const res = await GET(makeRequest({ jobId: 'pred_tile_abc' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('failed');
    expect(data.error).toContain(withRetryGuidance('Tileset generation failed'));
  });

  it('returns failed status when prediction was canceled', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    mockGetReplicateStatus.mockResolvedValue({ status: 'canceled', output: undefined });

    const res = await GET(makeRequest({ jobId: 'pred_tile_abc' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('failed');
  });

  it('maps succeeded-with-no-output to failed (so the poller refunds, not hangs)', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    // Replicate reports success but produced no tileset URL. Mapping this to
    // `completed` hands the client a completed job with no resultUrl, which throws
    // an uncaught "No result URL" in useGenerationPolling — the job then sticks in
    // `downloading` for the full 5-minute poll cap before refunding with a generic
    // timeout (#8757). The route must surface it as `failed` so the poller refunds
    // immediately with a meaningful error.
    mockGetReplicateStatus.mockResolvedValue({ status: 'succeeded', output: [] });

    const res = await GET(makeRequest({ jobId: 'pred_tile_abc' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('failed');
    expect(data.resultUrl).toBeUndefined();
    expect(data.progress).toBe(10);
    expect(data.error).toBe(withRetryGuidance('Tileset generation produced no image'));
  });

  it('does not leak a resultUrl while still processing', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    // Replicate can populate `output` before status flips to succeeded; the route
    // must gate resultUrl on completion so the client doesn't import a partial image.
    mockGetReplicateStatus.mockResolvedValue({
      status: 'processing',
      output: ['https://replicate.delivery/partial.png'],
    });

    const res = await GET(makeRequest({ jobId: 'pred_tile_abc' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('processing');
    expect(data.resultUrl).toBeUndefined();
    expect(data.error).toBeUndefined();
  });

  it('returns processing status for in-progress prediction', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    mockGetReplicateStatus.mockResolvedValue({ status: 'processing', output: undefined });

    const res = await GET(makeRequest({ jobId: 'pred_tile_abc' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('processing');
    expect(data.progress).toBe(50);
  });

  it('returns pending status for queued prediction', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    mockGetReplicateStatus.mockResolvedValue({ status: 'starting', output: undefined });

    const res = await GET(makeRequest({ jobId: 'pred_tile_abc' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('pending');
    expect(data.progress).toBe(10);
  });

  it('returns 500 if client throws unexpectedly', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    mockGetReplicateStatus.mockRejectedValue(new Error('Network timeout'));

    const res = await GET(makeRequest({ jobId: 'pred_tile_abc' }));
    const data = await res.json();

    expect(res.status).toBe(500);
    // The provider's own text must NOT come back: the generate clients fold
    // the upstream RESPONSE BODY into the thrown error, and on the platform
    // path the credential in play is the platform's (#9736).
    expect(data.error).not.toContain('Network timeout');
    expect(data.error).toBe('Could not read the Tileset generation status. Please try again.');
  });

  // Per-panel tier gate, POLL variant (#7715). This route resolves the
  // platform key itself rather than going through `createGenerationHandler`,
  // so it runs `panelTierGateResponseForPoll('generate-sprite', …)`. A poll reads
  // a job already paid for, so the live balance does not decide it: a
  // starter that has HELD tokens (monthlyTokens > 0 or addonTokens > 0) counts
  // as the trial tier (hobbyist) whether or not it has tokens left. A starter
  // that never held any (a never-granted signup) is refused before any key is
  // resolved. The job-ownership check (#10262, above) is what keeps a signed-in
  // caller from polling an arbitrary job id it never created; this tier gate is
  // a separate, independent refusal for accounts with no trial grant at all.
  // The creator-only status suites (model, skybox) pin that a
  // starter at any balance is refused there and that each of those routes
  // calls the POLL variant, not the create one.
  describe('panel tier gate (generate-sprite, hobbyist)', () => {
    function authAs(overrides: Partial<User>) {
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user: makeUser(overrides) } });
    }

    beforeEach(() => {
      vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
      mockGetReplicateStatus.mockResolvedValue({ status: 'processing', output: undefined });
    });

    it('admits a starter whose trial balance is spent: it is reading the job it paid for', async () => {
      // One generation can spend the whole grant, so the account is at 0 by
      // its first poll. The create gate would refuse it; the poll gate must not.
      authAs({ tier: 'starter', monthlyTokens: 50, monthlyTokensUsed: 50, addonTokens: 0 });

      const res = await GET(makeRequest({ jobId: 'pred_tile_abc' }));
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe('processing');
      expect(resolveApiKey).toHaveBeenCalledTimes(1);
      // Asked as a zero-cost status poll: the pair the resolver requires
      // before it skips its own tier and balance checks.
      expect(vi.mocked(resolveApiKey).mock.calls[0].slice(2)).toEqual([0, STATUS_CHECK_OPERATION]);
    });

    it('lets a starter holding spendable trial tokens through to resolveApiKey', async () => {
      authAs({ tier: 'starter', monthlyTokens: 50, monthlyTokensUsed: 0, addonTokens: 0 });

      const res = await GET(makeRequest({ jobId: 'pred_tile_abc' }));
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe('processing');
      expect(resolveApiKey).toHaveBeenCalledTimes(1);
    });

    it('refuses a never-granted starter (no tokens ever held) with 403 TIER_REQUIRED before any key is resolved', async () => {
      // A signup the trial grant never reached: every token column 0. The
      // poll rule reads HELD tokens, not the live balance, and this account
      // has held none, so it is judged as a plain starter.
      authAs({ tier: 'starter', monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0 });

      const res = await GET(makeRequest({ jobId: 'pred_tile_abc' }));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'TIER_REQUIRED', currentTier: 'starter', requiredTier: 'hobbyist' });
      expect(resolveApiKey).not.toHaveBeenCalled();
    });

    it('lets a hobbyist account through to resolveApiKey', async () => {
      authAs({ tier: 'hobbyist', monthlyTokens: 300, monthlyTokensUsed: 300, addonTokens: 0 });

      const res = await GET(makeRequest({ jobId: 'pred_tile_abc' }));
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe('processing');
      expect(resolveApiKey).toHaveBeenCalledTimes(1);
    });
  });
});
