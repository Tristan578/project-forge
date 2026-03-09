import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AsyncChannelRouter } from '../asyncChannelRouter';
import type { AsyncRequest } from '../asyncTypes';

function makeRequest(overrides: Partial<AsyncRequest> = {}): AsyncRequest {
  return {
    type: 'async_request',
    requestId: 'req_1',
    channel: 'physics',
    method: 'raycast',
    args: { origin: [0, 0, 0] },
    ...overrides,
  };
}

describe('AsyncChannelRouter', () => {
  let router: AsyncChannelRouter;

  beforeEach(() => {
    router = new AsyncChannelRouter();
    router.setPlayMode(true);
  });

  // ─── Channel registration ─────────────────────────────────────

  it('returns error for unknown channel', async () => {
    await router.handleRequest(makeRequest({ channel: 'nonexistent' as never }));
    const responses = router.flush();
    expect(responses).toHaveLength(1);
    expect(responses![0].status).toBe('error');
    expect(responses![0].error).toContain('Unknown async channel');
    expect(responses![0].requestId).toBe('req_1');
  });

  it('returns error for disallowed method', async () => {
    router.register('physics', vi.fn().mockResolvedValue(null));
    await router.handleRequest(makeRequest({ method: 'not_allowed_method' }));
    const responses = router.flush();
    expect(responses).toHaveLength(1);
    expect(responses![0].status).toBe('error');
    expect(responses![0].error).toContain("not allowed on channel 'physics'");
  });

  // ─── Successful dispatch ──────────────────────────────────────

  it('dispatches to handler and returns ok response', async () => {
    const handler = vi.fn().mockResolvedValue({ hit: true, distance: 5.0 });
    router.register('physics', handler);

    await router.handleRequest(makeRequest());
    const responses = router.flush();

    expect(handler).toHaveBeenCalledWith('raycast', { origin: [0, 0, 0] }, expect.any(Function));
    expect(responses).toHaveLength(1);
    expect(responses![0].status).toBe('ok');
    expect(responses![0].data).toEqual({ hit: true, distance: 5.0 });
    expect(responses![0].requestId).toBe('req_1');
  });

  it('wraps handler errors with requestId', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Engine not ready'));
    router.register('physics', handler);

    await router.handleRequest(makeRequest());
    const responses = router.flush();

    expect(responses).toHaveLength(1);
    expect(responses![0].status).toBe('error');
    expect(responses![0].error).toContain('req_1');
    expect(responses![0].error).toContain('Engine not ready');
  });

  // ─── Concurrency ──────────────────────────────────────────────

  it('rejects when at max concurrency', async () => {
    // Use audio channel (maxConcurrent: 4) for a faster test
    const resolvers: (() => void)[] = [];
    const blockingHandler = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      resolvers.push(resolve);
    }));
    router.register('audio', blockingHandler);

    // Start 4 concurrent requests (audio max) — don't await
    for (let i = 0; i < 4; i++) {
      // Fire-and-forget: these stay pending because the handler blocks
      void router.handleRequest(makeRequest({
        requestId: `req_${i}`,
        channel: 'audio',
        method: 'detectLoopPoints',
      }));
    }

    // Wait a tick for the handlers to start
    await new Promise(r => setTimeout(r, 0));

    expect(router.getActiveCount('audio')).toBe(4);

    // 5th should fail immediately
    await router.handleRequest(makeRequest({
      requestId: 'req_overflow',
      channel: 'audio',
      method: 'detectLoopPoints',
    }));
    const responses = router.flush();

    const overflowResp = responses?.find(r => r.requestId === 'req_overflow');
    expect(overflowResp).toBeDefined();
    expect(overflowResp!.status).toBe('error');
    expect(overflowResp!.error).toContain('max concurrency');

    // Clean up blocking handlers
    for (const resolve of resolvers) resolve();
  });

  it('decrements activeCount on handler completion', async () => {
    const handler = vi.fn().mockResolvedValue('result');
    router.register('physics', handler);

    await router.handleRequest(makeRequest());
    expect(router.getActiveCount('physics')).toBe(0);
  });

  it('decrements activeCount on handler error', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('fail'));
    router.register('physics', handler);

    await router.handleRequest(makeRequest());
    expect(router.getActiveCount('physics')).toBe(0);
  });

  // ─── Play mode ────────────────────────────────────────────────

  it('rejects playModeOnly channel when not in play mode', async () => {
    router.register('physics', vi.fn().mockResolvedValue(null));
    router.setPlayMode(false);

    await router.handleRequest(makeRequest());
    const responses = router.flush();

    expect(responses).toHaveLength(1);
    expect(responses![0].status).toBe('error');
    expect(responses![0].error).toContain('requires play mode');
  });

  it('allows non-playModeOnly channel in edit mode', async () => {
    router.register('audio', vi.fn().mockResolvedValue({ loopPoints: [] }));
    router.setPlayMode(false);

    await router.handleRequest(makeRequest({
      channel: 'audio',
      method: 'detectLoopPoints',
      args: { assetId: 'test' },
    }));
    const responses = router.flush();

    expect(responses).toHaveLength(1);
    expect(responses![0].status).toBe('ok');
  });

  // ─── Progress ─────────────────────────────────────────────────

  it('reports progress for progress-enabled channels', async () => {
    const handler = vi.fn().mockImplementation(
      async (_method: string, _args: Record<string, unknown>, reportProgress: (p: number, m?: string) => void) => {
        reportProgress(25, 'Starting...');
        reportProgress(75, 'Almost done...');
        return { url: 'https://example.com/texture.png' };
      },
    );
    router.register('ai', handler);

    await router.handleRequest(makeRequest({
      channel: 'ai',
      method: 'generateTexture',
      args: { prompt: 'metal floor' },
    }));

    const responses = router.flush();
    expect(responses).toHaveLength(3); // 2 progress + 1 ok
    expect(responses![0].status).toBe('progress');
    expect(responses![0].progress?.percent).toBe(25);
    expect(responses![1].status).toBe('progress');
    expect(responses![1].progress?.percent).toBe(75);
    expect(responses![2].status).toBe('ok');
  });

  it('ignores progress calls for non-progress channels', async () => {
    const handler = vi.fn().mockImplementation(
      async (_method: string, _args: Record<string, unknown>, reportProgress: (p: number, m?: string) => void) => {
        reportProgress(50, 'test');
        return null;
      },
    );
    router.register('physics', handler);

    await router.handleRequest(makeRequest());
    const responses = router.flush();

    // Only the ok response, no progress
    expect(responses).toHaveLength(1);
    expect(responses![0].status).toBe('ok');
  });

  // ─── Flush ────────────────────────────────────────────────────

  it('flush drains responses, second flush returns undefined', async () => {
    router.register('physics', vi.fn().mockResolvedValue(null));

    await router.handleRequest(makeRequest());
    const first = router.flush();
    expect(first).toHaveLength(1);

    const second = router.flush();
    expect(second).toBeUndefined();
  });

  it('returns undefined when no responses pending', () => {
    expect(router.flush()).toBeUndefined();
  });

  // ─── Reset ────────────────────────────────────────────────────

  it('reset clears all state', async () => {
    router.register('physics', vi.fn().mockResolvedValue(null));
    await router.handleRequest(makeRequest());

    router.reset();
    expect(router.flush()).toBeUndefined();
    expect(router.isPlayMode).toBe(false);
    expect(router.getActiveCount('physics')).toBe(0);
  });

  // ─── Null args ────────────────────────────────────────────────

  it('handles null args gracefully', async () => {
    const handler = vi.fn().mockResolvedValue('ok');
    router.register('physics', handler);

    await router.handleRequest(makeRequest({ args: null }));
    const responses = router.flush();

    expect(responses).toHaveLength(1);
    expect(responses![0].status).toBe('ok');
    expect(handler).toHaveBeenCalledWith('raycast', {}, expect.any(Function));
  });
});
