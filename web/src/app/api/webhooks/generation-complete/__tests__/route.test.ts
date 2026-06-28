import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/qstash/client', () => ({
  isQstashConfigured: vi.fn(() => true),
  verifyQstashSignature: vi.fn(async () => true),
  publishGenerationCallback: vi.fn(async () => {}),
  GENERATION_CALLBACK_PATH: '/api/webhooks/generation-complete',
}));

// Keep the real ASYNC_TYPE_TO_DB_CAPABILITY (the route's payload validation
// depends on it) but stub the network poll.
vi.mock('@/lib/generate/pollProviderStatus', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/generate/pollProviderStatus')>();
  return { ...actual, pollProviderStatus: vi.fn() };
});

vi.mock('@/lib/generate/jobRecord', () => ({
  updateJobStatusByProviderJob: vi.fn(async () => {}),
}));

vi.mock('@/lib/keys/resolver', () => ({
  resolveApiKey: vi.fn(),
  ApiKeyError: class ApiKeyError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'ApiKeyError';
    }
  },
}));

vi.mock('@/lib/config/providers', () => ({
  DB_PROVIDER: { model3d: 'meshy', texture: 'meshy', music: 'suno', sprite: 'replicate' },
}));

vi.mock('@/lib/tokens/service', () => ({
  refundTokens: vi.fn(async () => ({ refunded: true })),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

import { POST } from '../route';
import { isQstashConfigured, verifyQstashSignature, publishGenerationCallback } from '@/lib/qstash/client';
import { pollProviderStatus } from '@/lib/generate/pollProviderStatus';
import { updateJobStatusByProviderJob } from '@/lib/generate/jobRecord';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { refundTokens } from '@/lib/tokens/service';
import { captureException } from '@/lib/monitoring/sentry-server';

const mockConfigured = vi.mocked(isQstashConfigured);
const mockVerify = vi.mocked(verifyQstashSignature);
const mockPublish = vi.mocked(publishGenerationCallback);
const mockPoll = vi.mocked(pollProviderStatus);
const mockUpdate = vi.mocked(updateJobStatusByProviderJob);
const mockResolve = vi.mocked(resolveApiKey);
const mockRefund = vi.mocked(refundTokens);
const mockCapture = vi.mocked(captureException);

function makeReq(body: string, sig: string | null = 'sig'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sig !== null) headers['upstash-signature'] = sig;
  return new NextRequest('http://localhost:3000/api/webhooks/generation-complete', {
    method: 'POST',
    headers,
    body,
  });
}

const payload = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ userId: 'user-1', providerJobId: 'job-1', type: 'model', tokenUsageId: 'usage-1', attempt: 0, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mockConfigured.mockReturnValue(true);
  mockVerify.mockResolvedValue(true);
  mockResolve.mockResolvedValue({ type: 'platform', key: 'k', metered: false, usageId: undefined });
});

describe('POST /api/webhooks/generation-complete — gating', () => {
  it('401s when QStash is unconfigured (dormant)', async () => {
    mockConfigured.mockReturnValue(false);
    const res = await POST(makeReq(payload()));
    expect(res.status).toBe(401);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('401s on an invalid signature', async () => {
    mockVerify.mockResolvedValue(false);
    const res = await POST(makeReq(payload(), 'bad'));
    expect(res.status).toBe(401);
    expect(mockPoll).not.toHaveBeenCalled();
  });

  it('400s on a non-JSON body (after a valid signature)', async () => {
    const res = await POST(makeReq('not json'));
    expect(res.status).toBe(400);
  });

  it('400s on a malformed payload (unknown type)', async () => {
    const res = await POST(makeReq(payload({ type: 'pixel-art' })));
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('400s when providerJobId is missing', async () => {
    const res = await POST(makeReq(payload({ providerJobId: '' })));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/webhooks/generation-complete — key resolution', () => {
  it('finalizes failed + refunds and stops retrying (200) when the key is gone', async () => {
    mockResolve.mockRejectedValue(new ApiKeyError('NO_KEY_CONFIGURED', 'gone'));
    const res = await POST(makeReq(payload()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ finalized: 'failed', reason: 'key_unavailable' });
    expect(mockUpdate).toHaveBeenCalledWith('job-1', 'user-1', expect.objectContaining({ status: 'failed' }));
    expect(mockRefund).toHaveBeenCalledWith('user-1', 'usage-1');
    // ApiKeyError is an expected condition — not reported to Sentry.
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('reports a non-ApiKeyError key failure to Sentry but still finalizes (200)', async () => {
    mockResolve.mockRejectedValue(new Error('db down'));
    const res = await POST(makeReq(payload()));
    expect(res.status).toBe(200);
    expect(mockCapture).toHaveBeenCalled();
    expect(mockRefund).toHaveBeenCalledWith('user-1', 'usage-1');
  });
});

describe('POST /api/webhooks/generation-complete — terminal polling', () => {
  it('finalizes completed (no refund) on a completed poll', async () => {
    mockPoll.mockResolvedValue({ status: 'completed', progress: 100, resultUrl: 'https://x/m.glb', succeededButEmpty: false });
    const res = await POST(makeReq(payload()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ finalized: 'completed' });
    expect(mockUpdate).toHaveBeenCalledWith('job-1', 'user-1', expect.objectContaining({ status: 'completed', resultUrl: 'https://x/m.glb' }));
    expect(mockRefund).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('finalizes failed + refunds on a failed poll', async () => {
    mockPoll.mockResolvedValue({ status: 'failed', progress: 0, succeededButEmpty: false, errorMessage: 'Model generation failed' });
    const res = await POST(makeReq(payload()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ finalized: 'failed' });
    expect(mockUpdate).toHaveBeenCalledWith('job-1', 'user-1', { status: 'failed', errorMessage: 'Model generation failed' });
    expect(mockRefund).toHaveBeenCalledWith('user-1', 'usage-1');
  });

  it('does not refund a failed BYOK job (tokenUsageId null)', async () => {
    mockPoll.mockResolvedValue({ status: 'failed', progress: 0, succeededButEmpty: false });
    const res = await POST(makeReq(payload({ tokenUsageId: null })));
    expect(res.status).toBe(200);
    expect(mockRefund).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/generation-complete — re-arming', () => {
  it('re-publishes with attempt+1 while the job is still in flight', async () => {
    mockPoll.mockResolvedValue({ status: 'processing', progress: 50, succeededButEmpty: false });
    const res = await POST(makeReq(payload({ attempt: 3 })));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ rearmed: true, attempt: 4 });
    expect(mockUpdate).toHaveBeenCalledWith('job-1', 'user-1', expect.objectContaining({ status: 'processing' }));
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 4, providerJobId: 'job-1' }),
      expect.objectContaining({ delaySeconds: expect.any(Number) }),
    );
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it('times out (finalize failed + refund, no republish) at the attempt cap', async () => {
    mockPoll.mockResolvedValue({ status: 'pending', progress: 10, succeededButEmpty: false });
    const res = await POST(makeReq(payload({ attempt: 59 })));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ finalized: 'timeout' });
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith('job-1', 'user-1', expect.objectContaining({ status: 'failed' }));
    expect(mockRefund).toHaveBeenCalledWith('user-1', 'usage-1');
  });
});

describe('POST /api/webhooks/generation-complete — transient poll error', () => {
  it('500s (so QStash retries) and reports to Sentry when the poll throws', async () => {
    mockPoll.mockRejectedValue(new Error('provider 503'));
    const res = await POST(makeReq(payload()));
    expect(res.status).toBe(500);
    expect(mockCapture).toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
  });
});
