vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { STATUS_CHECK_OPERATION } from '@/lib/keys/statusCheckOperation';
import { SpriteClient } from '@/lib/generate/spriteClient';
import { verifyProviderJobOwner } from '@/lib/generate/jobOwnership';
import type { User } from '@/lib/db/schema';
import { withRetryGuidance } from '@/lib/generate/retryGuidance';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/keys/resolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/keys/resolver')>();
  return { ...mod, resolveApiKey: vi.fn() };
});
vi.mock('@/lib/generate/jobOwnership', () => ({
  verifyProviderJobOwner: vi.fn(),
}));
vi.mock('@/lib/generate/spriteClient', () => ({
  SpriteClient: vi.fn(() => ({
    getReplicateStatus: vi.fn(),
  })),
}));

function makeRequest(jobId?: string): NextRequest {
  const url = jobId
    ? `http://test/api/generate/sprite-sheet/status?jobId=${encodeURIComponent(jobId)}`
    : 'http://test/api/generate/sprite-sheet/status';
  return new NextRequest(url);
}

describe('GET /api/generate/sprite-sheet/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as unknown as User },
    });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'test-key', metered: true, usageId: 'usage-1' });
    vi.mocked(verifyProviderJobOwner).mockResolvedValue(true);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: new NextResponse('Unauthorized', { status: 401 }),
    });

    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when jobId is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Missing jobId parameter');
  });

  it('returns completed for spritesheet_ prefixed jobIds (client-side imports)', async () => {
    const res = await GET(makeRequest('spritesheet_abc123'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('completed');
    expect(data.progress).toBe(100);
  });

  it('returns 402 when API key resolution fails', async () => {
    vi.mocked(resolveApiKey).mockRejectedValue(
      new ApiKeyError('TIER_NOT_ALLOWED', 'Tier not allowed')
    );

    const res = await GET(makeRequest('replicate-pred-123'));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.code).toBe('TIER_NOT_ALLOWED');
  });

  // Ownership check (#10262): without this, any signed-in caller admitted past
  // the tier gate could poll a job id they never created and read back another
  // user's result via the platform key `resolveApiKey` returns by default.
  // (The spritesheet_ branch above never resolves a key or touches the
  // provider, so it needs no ownership check.)
  describe('job ownership (#10262)', () => {
    it('returns 404 without resolving a key when the caller does not own the job', async () => {
      vi.mocked(verifyProviderJobOwner).mockResolvedValue(false);

      const res = await GET(makeRequest('replicate-pred-123'));

      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Job not found');
      expect(resolveApiKey).not.toHaveBeenCalled();
      expect(SpriteClient).not.toHaveBeenCalled();
    });

    it('checks ownership with the authenticated userId, the sprite provider, and the polled jobId', async () => {
      vi.mocked(SpriteClient).mockImplementation(
        function (this: InstanceType<typeof SpriteClient>) {
          this.getReplicateStatus = vi.fn().mockResolvedValue({ status: 'processing' });
        } as unknown as typeof SpriteClient
      );

      await GET(makeRequest('replicate-pred-123'));

      expect(verifyProviderJobOwner).toHaveBeenCalledTimes(1);
      expect(verifyProviderJobOwner).toHaveBeenCalledWith('user_1', 'replicate', 'replicate-pred-123');
    });
  });

  it('returns completed status with output URL for succeeded prediction', async () => {
    vi.mocked(SpriteClient).mockImplementation(
      function (this: InstanceType<typeof SpriteClient>) {
        this.getReplicateStatus = vi.fn().mockResolvedValue({
          status: 'succeeded',
          output: ['https://replicate.delivery/sheet.png'],
        });
      } as unknown as typeof SpriteClient
    );

    const res = await GET(makeRequest('replicate-pred-123'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('completed');
    expect(data.progress).toBe(100);
    expect(data.resultUrl).toBe('https://replicate.delivery/sheet.png');
    expect(data.error).toBeUndefined();
  });

  it('returns failed status for failed prediction', async () => {
    vi.mocked(SpriteClient).mockImplementation(
      function (this: InstanceType<typeof SpriteClient>) {
        this.getReplicateStatus = vi.fn().mockResolvedValue({
          status: 'failed',
          output: null,
        });
      } as unknown as typeof SpriteClient
    );

    const res = await GET(makeRequest('replicate-pred-123'));
    const data = await res.json();
    expect(data.status).toBe('failed');
    expect(data.error).toBe(withRetryGuidance('Sprite sheet generation failed'));
  });

  it('maps succeeded-with-no-output to failed (so the poller refunds, not hangs)', async () => {
    vi.mocked(SpriteClient).mockImplementation(
      function (this: InstanceType<typeof SpriteClient>) {
        // Replicate reports success but produced no sheet URL. Mapping this to
        // `completed` hands the client a completed job with no resultUrl, which
        // throws an uncaught "No result URL" in useGenerationPolling — the job
        // then sticks in `downloading` for the full 5-minute poll cap before
        // refunding with a generic timeout (#8757). The route must surface it as
        // `failed` so the poller refunds immediately with a meaningful error.
        this.getReplicateStatus = vi.fn().mockResolvedValue({ status: 'succeeded', output: [] });
      } as unknown as typeof SpriteClient
    );

    const res = await GET(makeRequest('replicate-pred-123'));
    const data = await res.json();
    expect(data.status).toBe('failed');
    expect(data.resultUrl).toBeUndefined();
    expect(data.progress).toBe(10);
    expect(data.error).toBe(withRetryGuidance('Sprite sheet generation produced no image'));
  });

  it('does not leak a resultUrl while still processing', async () => {
    vi.mocked(SpriteClient).mockImplementation(
      function (this: InstanceType<typeof SpriteClient>) {
        // Replicate can populate `output` before status flips to succeeded; the
        // route must gate resultUrl on completion so the client doesn't import a
        // partial image.
        this.getReplicateStatus = vi.fn().mockResolvedValue({
          status: 'processing',
          output: ['https://replicate.delivery/partial.png'],
        });
      } as unknown as typeof SpriteClient
    );

    const res = await GET(makeRequest('replicate-pred-123'));
    const data = await res.json();
    expect(data.status).toBe('processing');
    expect(data.resultUrl).toBeUndefined();
    expect(data.error).toBeUndefined();
  });

  it('returns pending status for starting prediction', async () => {
    vi.mocked(SpriteClient).mockImplementation(
      function (this: InstanceType<typeof SpriteClient>) {
        this.getReplicateStatus = vi.fn().mockResolvedValue({
          status: 'starting',
          output: null,
        });
      } as unknown as typeof SpriteClient
    );

    const res = await GET(makeRequest('replicate-pred-123'));
    const data = await res.json();
    expect(data.status).toBe('pending');
    expect(data.progress).toBe(10);
  });

  it('returns 500 when provider throws', async () => {
    vi.mocked(SpriteClient).mockImplementation(
      function (this: InstanceType<typeof SpriteClient>) {
        this.getReplicateStatus = vi.fn().mockRejectedValue(new Error('Connection reset'));
      } as unknown as typeof SpriteClient
    );

    const res = await GET(makeRequest('replicate-pred-123'));
    expect(res.status).toBe(500);
    const data = await res.json();
    // The provider's own text must NOT come back: the generate clients fold
    // the upstream RESPONSE BODY into the thrown error, and on the platform
    // path the credential in play is the platform's (#9736).
    expect(data.error).not.toContain('Connection reset');
    expect(data.error).toBe('Could not read the Sprite Sheet generation status. Please try again.');
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
    function authAs(user: Record<string, unknown>) {
      vi.mocked(authenticateRequest).mockResolvedValue({
        ok: true as const,
        ctx: { clerkId: 'clerk_1', user: { id: 'user_1', ...user } as unknown as User },
      });
    }

    beforeEach(() => {
      vi.mocked(SpriteClient).mockImplementation(
        function (this: InstanceType<typeof SpriteClient>) {
          this.getReplicateStatus = vi.fn().mockResolvedValue({ status: 'processing' });
        } as unknown as typeof SpriteClient
      );
    });

    it('admits a starter whose trial balance is spent: it is reading the job it paid for', async () => {
      // One generation can spend the whole grant, so the account is at 0 by
      // its first poll. The create gate would refuse it; the poll gate must not.
      authAs({ tier: 'starter', monthlyTokens: 50, monthlyTokensUsed: 50, addonTokens: 0 });

      const res = await GET(makeRequest('replicate-pred-123'));
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe('processing');
      expect(resolveApiKey).toHaveBeenCalledTimes(1);
      // Asked as a zero-cost status poll: the pair the resolver requires
      // before it skips its own tier and balance checks.
      expect(vi.mocked(resolveApiKey).mock.calls[0].slice(2)).toEqual([0, STATUS_CHECK_OPERATION]);
    });

    it('lets a starter holding spendable trial tokens through to resolveApiKey', async () => {
      authAs({ tier: 'starter', monthlyTokens: 50, monthlyTokensUsed: 0, addonTokens: 0 });

      const res = await GET(makeRequest('replicate-pred-123'));
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe('processing');
      expect(resolveApiKey).toHaveBeenCalledTimes(1);
    });

    it('refuses a never-granted starter (no tokens ever held) with 403 TIER_REQUIRED before any key is resolved', async () => {
      // A signup the trial grant never reached: every token column 0. The
      // poll rule reads HELD tokens, not the live balance, and this account
      // has held none, so it is judged as a plain starter.
      authAs({ tier: 'starter', monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0 });

      const res = await GET(makeRequest('replicate-pred-123'));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'TIER_REQUIRED', currentTier: 'starter', requiredTier: 'hobbyist' });
      expect(resolveApiKey).not.toHaveBeenCalled();
    });

    it('lets a hobbyist account through to resolveApiKey', async () => {
      authAs({ tier: 'hobbyist', monthlyTokens: 300, monthlyTokensUsed: 300, addonTokens: 0 });

      const res = await GET(makeRequest('replicate-pred-123'));
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe('processing');
      expect(resolveApiKey).toHaveBeenCalledTimes(1);
    });
  });
});
