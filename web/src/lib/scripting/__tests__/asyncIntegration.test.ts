import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AsyncChannelRouter } from '../asyncChannelRouter';
import { createPhysicsHandler } from '../channels/physicsChannel';
import { createAudioHandler } from '../channels/audioChannel';
import type { AsyncRequest, AsyncResponse } from '../asyncTypes';

/**
 * Integration tests for the async channel protocol.
 * Simulates the full flow: script sends async_request → router handles → response batched.
 */
describe('Async Channel Protocol Integration', () => {
  let router: AsyncChannelRouter;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    router = new AsyncChannelRouter();
    router.setPlayMode(true);
    mockDispatch = vi.fn();
  });

  // ─── End-to-end raycast flow ──────────────────────────────────

  it('end-to-end: physics raycast request → response', async () => {
    mockDispatch.mockReturnValue({ entityId: 'ground_1', point: [1, 0, 3], distance: 2.5 });
    router.register('physics', createPhysicsHandler({ dispatchCommand: mockDispatch }));

    const request: AsyncRequest = {
      type: 'async_request',
      requestId: 'req_42',
      channel: 'physics',
      method: 'raycast',
      args: { origin: [0, 5, 0], direction: [0, -1, 0], maxDistance: 100 },
    };

    await router.handleRequest(request);
    const responses = router.flush()!;

    expect(responses).toHaveLength(1);
    expect(responses[0]).toEqual({
      requestId: 'req_42',
      status: 'ok',
      data: { entityId: 'ground_1', point: [1, 0, 3], distance: 2.5 },
    });
  });

  // ─── Concurrent requests on different channels ────────────────

  it('concurrent requests on different channels resolve independently', async () => {
    mockDispatch.mockReturnValue({ hit: true });
    router.register('physics', createPhysicsHandler({ dispatchCommand: mockDispatch }));
    router.register('audio', createAudioHandler({
      detectLoopPoints: vi.fn().mockResolvedValue([{ start: 0, end: 3.0 }]),
      getWaveform: vi.fn().mockResolvedValue(null),
    }));

    // Fire both concurrently
    const physicsReq: AsyncRequest = {
      type: 'async_request',
      requestId: 'req_1',
      channel: 'physics',
      method: 'raycast',
      args: { origin: [0, 0, 0], direction: [1, 0, 0] },
    };

    const audioReq: AsyncRequest = {
      type: 'async_request',
      requestId: 'req_2',
      channel: 'audio',
      method: 'detectLoopPoints',
      args: { assetId: 'music_01' },
    };

    await Promise.all([
      router.handleRequest(physicsReq),
      router.handleRequest(audioReq),
    ]);

    const responses = router.flush()!;
    expect(responses).toHaveLength(2);

    const physicsResp = responses.find((r: AsyncResponse) => r.requestId === 'req_1');
    const audioResp = responses.find((r: AsyncResponse) => r.requestId === 'req_2');

    expect(physicsResp?.status).toBe('ok');
    expect(physicsResp?.data).toEqual({ hit: true });
    expect(audioResp?.status).toBe('ok');
    expect(audioResp?.data).toEqual([{ start: 0, end: 3.0 }]);
  });

  // ─── Invalid channel/method errors ────────────────────────────

  it('invalid channel returns structured error', async () => {
    await router.handleRequest({
      type: 'async_request',
      requestId: 'req_bad',
      channel: 'bogus' as never,
      method: 'whatever',
      args: {},
    });

    const responses = router.flush()!;
    expect(responses).toHaveLength(1);
    expect(responses[0].status).toBe('error');
    expect(responses[0].error).toContain('req_bad');
    expect(responses[0].error).toContain('Unknown async channel');
  });

  it('invalid method on valid channel returns structured error', async () => {
    router.register('physics', createPhysicsHandler({ dispatchCommand: mockDispatch }));

    await router.handleRequest({
      type: 'async_request',
      requestId: 'req_bad_method',
      channel: 'physics',
      method: 'teleport',
      args: {},
    });

    const responses = router.flush()!;
    expect(responses).toHaveLength(1);
    expect(responses[0].status).toBe('error');
    expect(responses[0].error).toContain('not allowed');
    expect(responses[0].requestId).toBe('req_bad_method');
  });

  // ─── Channel independence under load ──────────────────────────

  it('full physics channel does not block audio', async () => {
    // Create a blocking physics handler
    const resolvers: (() => void)[] = [];
    const blockingPhysics = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolvers.push(resolve); }),
    );
    router.register('physics', blockingPhysics);
    router.register('audio', createAudioHandler({
      detectLoopPoints: vi.fn().mockResolvedValue([]),
      getWaveform: vi.fn().mockResolvedValue(null),
    }));

    // Fill physics channel (32 concurrent)
    for (let i = 0; i < 32; i++) {
      void router.handleRequest({
        type: 'async_request',
        requestId: `phys_${i}`,
        channel: 'physics',
        method: 'raycast',
        args: {},
      });
    }

    await new Promise(r => setTimeout(r, 0));
    expect(router.getActiveCount('physics')).toBe(32);

    // Audio should still work
    await router.handleRequest({
      type: 'async_request',
      requestId: 'audio_1',
      channel: 'audio',
      method: 'detectLoopPoints',
      args: { assetId: 'test' },
    });

    const responses = router.flush()!;
    const audioResp = responses.find((r: AsyncResponse) => r.requestId === 'audio_1');
    expect(audioResp?.status).toBe('ok');

    // Clean up
    for (const resolve of resolvers) resolve();
  });

  // ─── Response batching ────────────────────────────────────────

  it('responses batch correctly across multiple requests', async () => {
    mockDispatch.mockReturnValue(null);
    router.register('physics', createPhysicsHandler({ dispatchCommand: mockDispatch }));

    // Send 5 requests
    for (let i = 0; i < 5; i++) {
      await router.handleRequest({
        type: 'async_request',
        requestId: `req_${i}`,
        channel: 'physics',
        method: 'raycast',
        args: {},
      });
    }

    const responses = router.flush()!;
    expect(responses).toHaveLength(5);
    expect(responses.map((r: AsyncResponse) => r.requestId)).toEqual([
      'req_0', 'req_1', 'req_2', 'req_3', 'req_4',
    ]);

    // Second flush should be empty
    expect(router.flush()).toBeUndefined();
  });
});
