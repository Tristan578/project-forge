import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { resilientFetch } from '../resilientFetch';
import { toast } from 'sonner';

function mockResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  const h = new Headers(headers);
  return new Response(JSON.stringify(body), { status, headers: h });
}

describe('resilientFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  it('passes through non-503 responses unchanged', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const res = await resilientFetch('/api/test');
    expect(res.status).toBe(200);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('passes through 503 without DB error code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse(503, { error: 'Service unavailable', code: 'SERVICE_UNAVAILABLE' }, { 'Retry-After': '10' }),
    );

    const res = await resilientFetch('/api/test');
    expect(res.status).toBe(503);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('retries on DB_CIRCUIT_OPEN and shows toast', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy
      .mockResolvedValueOnce(
        mockResponse(503, { error: 'DB unavailable', code: 'DB_CIRCUIT_OPEN' }, { 'Retry-After': '1' }),
      )
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const promise = resilientFetch('/api/test');

    // Advance past the 1s retry delay
    await vi.advanceTimersByTimeAsync(1100);

    const res = await promise;
    expect(res.status).toBe(200);
    expect(toast.info).toHaveBeenCalledWith(
      'Database temporarily unavailable. Retrying...',
      expect.objectContaining({ duration: expect.any(Number) }),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries on DB_RATE_LIMITED and shows toast', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy
      .mockResolvedValueOnce(
        mockResponse(503, { error: 'Rate limited', code: 'DB_RATE_LIMITED' }, { 'Retry-After': '1' }),
      )
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const promise = resilientFetch('/api/test');
    await vi.advanceTimersByTimeAsync(1100);

    const res = await promise;
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns retry response if retry also fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy
      .mockResolvedValueOnce(
        mockResponse(503, { error: 'DB unavailable', code: 'DB_CIRCUIT_OPEN' }, { 'Retry-After': '1' }),
      )
      .mockResolvedValueOnce(mockResponse(503, { error: 'Still down' }));

    const promise = resilientFetch('/api/test');
    await vi.advanceTimersByTimeAsync(1100);

    const res = await promise;
    expect(res.status).toBe(503);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('defaults to 5s retry when Retry-After header is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy
      .mockResolvedValueOnce(
        mockResponse(503, { error: 'DB unavailable', code: 'DB_CIRCUIT_OPEN' }),
      )
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const promise = resilientFetch('/api/test');

    // Should NOT resolve before 5s
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1100);
    const res = await promise;
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('caps Retry-After at 60 seconds', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy
      .mockResolvedValueOnce(
        mockResponse(503, { error: 'DB unavailable', code: 'DB_CIRCUIT_OPEN' }, { 'Retry-After': '300' }),
      )
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const promise = resilientFetch('/api/test');

    // Should wait at most 60s, not 300s
    await vi.advanceTimersByTimeAsync(61000);
    const res = await promise;
    expect(res.status).toBe(200);
  });
});
