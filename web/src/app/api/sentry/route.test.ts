import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const VALID_DSN = 'https://key@o123.ingest.sentry.io/456';

function makeRequest(body: string) {
  return new NextRequest('http://localhost/api/sentry', { method: 'POST', body });
}

function envelope(dsn: string) {
  return `${JSON.stringify({ dsn })}\n{}`;
}

describe('POST /api/sentry', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('SENTRY_DSN', VALID_DSN);
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ status: 200, body: null } as Response);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fetchSpy.mockRestore();
    // Force module re-evaluation so TRUSTED_SENTRY is recalculated
    vi.resetModules();
  });

  it('forwards envelope when DSN matches trusted config', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest(envelope(VALID_DSN)));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://o123.ingest.sentry.io/api/456/envelope/',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects envelope with mismatched host', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest(envelope('https://key@evil.example.com/456')));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects envelope with mismatched project ID', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest(envelope('https://key@o123.ingest.sentry.io/999')));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 503 when SENTRY_DSN is not configured', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const { POST } = await import('./route');
    const res = await POST(makeRequest(envelope(VALID_DSN)));
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 400 for empty envelope', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest(''));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON header', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest('not-json\n{}'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing DSN in header', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest(`${JSON.stringify({ event_id: '123' })}\n{}`));
    expect(res.status).toBe(400);
  });
});
