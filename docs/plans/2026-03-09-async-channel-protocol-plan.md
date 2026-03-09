# Async Channel Protocol Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a typed async request/response protocol with per-channel concurrency, timeouts, and progress streaming to the script worker system.

**Architecture:** Message bus with 6 typed channels (physics, audio, ai, asset, animation, multiplayer). Worker sends `async_request` messages, main thread routes to channel handlers, responses batch into tick messages. Progress streaming for slow channels (ai, asset).

**Tech Stack:** TypeScript, Web Workers, vitest, Playwright

**Design Doc:** `docs/plans/2026-03-09-async-channel-protocol-design.md`

**CRITICAL: Commit your work after every logical chunk (test file, feature, etc.). Do not accumulate uncommitted changes — rate limits can terminate you at any time.**

---

### Task 1: Shared Types

**Files:**
- Create: `web/src/lib/scripting/asyncTypes.ts`

**Step 1: Create the shared type definitions**

```typescript
// web/src/lib/scripting/asyncTypes.ts

export type AsyncChannel = 'physics' | 'audio' | 'ai' | 'asset' | 'animation' | 'multiplayer';

export interface AsyncRequest {
  type: 'async_request';
  requestId: string;
  channel: AsyncChannel;
  method: string;
  args: unknown;
}

export interface AsyncResponse {
  requestId: string;
  status: 'ok' | 'error' | 'progress';
  data?: unknown;
  error?: string;
  progress?: {
    percent: number;
    message?: string;
  };
}

export interface ChannelConfig {
  maxConcurrent: number;
  timeoutMs: number;
  supportsProgress: boolean;
  playModeOnly: boolean;
}

export const CHANNEL_CONFIGS: Record<AsyncChannel, ChannelConfig> = {
  physics:     { maxConcurrent: 32, timeoutMs: 1_000,   supportsProgress: false, playModeOnly: true },
  animation:   { maxConcurrent: 8,  timeoutMs: 2_000,   supportsProgress: false, playModeOnly: true },
  audio:       { maxConcurrent: 4,  timeoutMs: 10_000,  supportsProgress: false, playModeOnly: false },
  ai:          { maxConcurrent: 3,  timeoutMs: 120_000, supportsProgress: true,  playModeOnly: false },
  asset:       { maxConcurrent: 4,  timeoutMs: 30_000,  supportsProgress: true,  playModeOnly: false },
  multiplayer: { maxConcurrent: 16, timeoutMs: 10_000,  supportsProgress: false, playModeOnly: true },
};

export const CHANNEL_ALLOWED_METHODS: Record<AsyncChannel, Set<string>> = {
  physics:     new Set(['raycast', 'raycast2d', 'isGrounded', 'overlapSphere']),
  animation:   new Set(['listClips', 'getClipDuration']),
  audio:       new Set(['detectLoopPoints', 'getWaveform']),
  ai:          new Set(['generateTexture', 'generateModel', 'generateSound', 'generateVoice', 'generateMusic']),
  asset:       new Set(['loadImage', 'loadModel']),
  multiplayer: new Set([]),
};
```

**Step 2: Verify file compiles**

Run: `cd web && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add web/src/lib/scripting/asyncTypes.ts
git commit -m "feat(async): add shared types for async channel protocol"
```

---

### Task 2: AsyncChannelRouter

**Files:**
- Create: `web/src/lib/scripting/asyncChannelRouter.ts`
- Create: `web/src/lib/scripting/__tests__/asyncChannelRouter.test.ts`

**Step 1: Write failing tests for the router**

Create `web/src/lib/scripting/__tests__/asyncChannelRouter.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AsyncChannelRouter } from '../asyncChannelRouter';
import type { AsyncRequest, AsyncResponse } from '../asyncTypes';

function makeRequest(overrides: Partial<AsyncRequest> = {}): AsyncRequest {
  return {
    type: 'async_request',
    requestId: 'req_1',
    channel: 'physics',
    method: 'raycast',
    args: { originX: 0, originY: 0, dirX: 1, dirY: 0 },
    ...overrides,
  };
}

describe('AsyncChannelRouter', () => {
  it('returns error for unknown channel', async () => {
    const router = new AsyncChannelRouter();
    await router.handleRequest(makeRequest({ channel: 'unknown' as any }));
    const responses = router.flush();
    expect(responses).toHaveLength(1);
    expect(responses![0].status).toBe('error');
    expect(responses![0].error).toContain('Unknown channel');
    expect(responses![0].requestId).toBe('req_1');
  });

  it('returns error for disallowed method', async () => {
    const router = new AsyncChannelRouter();
    router.register('physics', { maxConcurrent: 32, timeoutMs: 1000, supportsProgress: false, playModeOnly: false }, vi.fn());
    await router.handleRequest(makeRequest({ method: 'evil_method' }));
    const responses = router.flush();
    expect(responses).toHaveLength(1);
    expect(responses![0].status).toBe('error');
    expect(responses![0].error).toContain('not allowed');
  });

  it('enforces concurrency limit', async () => {
    const router = new AsyncChannelRouter();
    // Handler that never resolves (simulates slow operation)
    const slowHandler = () => new Promise(() => {});
    router.register('physics', { maxConcurrent: 1, timeoutMs: 10000, supportsProgress: false, playModeOnly: false }, slowHandler);

    // First request should be accepted (runs but doesn't resolve)
    router.handleRequest(makeRequest({ requestId: 'req_1' }));
    // Give microtask queue a tick for the handler to start
    await Promise.resolve();

    // Second request should be rejected (concurrency limit)
    await router.handleRequest(makeRequest({ requestId: 'req_2' }));
    const responses = router.flush();
    // Only the second request should have a response (error)
    const errorResp = responses?.find(r => r.requestId === 'req_2');
    expect(errorResp?.status).toBe('error');
    expect(errorResp?.error).toContain('max concurrent');
  });

  it('decrements activeCount on handler completion', async () => {
    const router = new AsyncChannelRouter();
    router.register('physics', { maxConcurrent: 1, timeoutMs: 10000, supportsProgress: false, playModeOnly: false },
      async () => 'result');
    await router.handleRequest(makeRequest({ requestId: 'req_1' }));
    // After completion, slot should be free
    await router.handleRequest(makeRequest({ requestId: 'req_2' }));
    const responses = router.flush();
    expect(responses?.filter(r => r.status === 'ok')).toHaveLength(2);
  });

  it('decrements activeCount on handler error', async () => {
    const router = new AsyncChannelRouter();
    router.register('physics', { maxConcurrent: 1, timeoutMs: 10000, supportsProgress: false, playModeOnly: false },
      async () => { throw new Error('boom'); });
    await router.handleRequest(makeRequest({ requestId: 'req_1' }));
    // Slot should be freed despite error
    await router.handleRequest(makeRequest({ requestId: 'req_2' }));
    const responses = router.flush();
    expect(responses?.filter(r => r.status === 'error')).toHaveLength(2);
  });

  it('reports progress for progress-enabled channels', async () => {
    const router = new AsyncChannelRouter();
    router.register('ai', { maxConcurrent: 3, timeoutMs: 120000, supportsProgress: true, playModeOnly: false },
      async (_method, _args, reportProgress) => {
        reportProgress(50, 'Halfway there');
        return 'done';
      });
    await router.handleRequest(makeRequest({ channel: 'ai', method: 'generateTexture', requestId: 'req_1' }));
    const responses = router.flush();
    expect(responses).toHaveLength(2);
    expect(responses![0].status).toBe('progress');
    expect(responses![0].progress?.percent).toBe(50);
    expect(responses![0].progress?.message).toBe('Halfway there');
    expect(responses![1].status).toBe('ok');
    expect(responses![1].data).toBe('done');
  });

  it('progress is no-op for non-progress channels', async () => {
    const router = new AsyncChannelRouter();
    router.register('physics', { maxConcurrent: 32, timeoutMs: 1000, supportsProgress: false, playModeOnly: false },
      async (_method, _args, reportProgress) => {
        reportProgress(50, 'should be ignored');
        return 'result';
      });
    await router.handleRequest(makeRequest());
    const responses = router.flush();
    expect(responses).toHaveLength(1);
    expect(responses![0].status).toBe('ok');
  });

  it('flush drains responses and second flush returns undefined', async () => {
    const router = new AsyncChannelRouter();
    router.register('physics', { maxConcurrent: 32, timeoutMs: 1000, supportsProgress: false, playModeOnly: false },
      async () => 42);
    await router.handleRequest(makeRequest());
    const first = router.flush();
    expect(first).toHaveLength(1);
    const second = router.flush();
    expect(second).toBeUndefined();
  });

  it('wraps handler errors with requestId in logs', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = new AsyncChannelRouter();
    router.register('physics', { maxConcurrent: 32, timeoutMs: 1000, supportsProgress: false, playModeOnly: false },
      async () => { throw new Error('kaboom'); });
    await router.handleRequest(makeRequest({ requestId: 'req_42' }));
    const responses = router.flush();
    expect(responses![0].requestId).toBe('req_42');
    expect(responses![0].error).toContain('kaboom');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('req_42'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  it('rejects playModeOnly channel when not in play mode', async () => {
    const router = new AsyncChannelRouter();
    router.register('physics', { maxConcurrent: 32, timeoutMs: 1000, supportsProgress: false, playModeOnly: true },
      async () => 'result');
    router.setPlayMode(false);
    await router.handleRequest(makeRequest());
    const responses = router.flush();
    expect(responses![0].status).toBe('error');
    expect(responses![0].error).toContain('play mode');
  });

  it('allows playModeOnly channel when in play mode', async () => {
    const router = new AsyncChannelRouter();
    router.register('physics', { maxConcurrent: 32, timeoutMs: 1000, supportsProgress: false, playModeOnly: true },
      async () => 'result');
    router.setPlayMode(true);
    await router.handleRequest(makeRequest());
    const responses = router.flush();
    expect(responses![0].status).toBe('ok');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/scripting/__tests__/asyncChannelRouter.test.ts`
Expected: FAIL (module not found)

**Step 3: Implement AsyncChannelRouter**

Create `web/src/lib/scripting/asyncChannelRouter.ts`:

```typescript
import type { AsyncChannel, AsyncRequest, AsyncResponse, ChannelConfig } from './asyncTypes';
import { CHANNEL_ALLOWED_METHODS } from './asyncTypes';

type AsyncHandler = (
  method: string,
  args: Record<string, unknown>,
  reportProgress: (percent: number, message?: string) => void
) => Promise<unknown>;

interface ChannelState {
  config: ChannelConfig;
  handler: AsyncHandler;
  activeCount: number;
}

export class AsyncChannelRouter {
  private channels = new Map<string, ChannelState>();
  private pendingResponses: AsyncResponse[] = [];
  private inPlayMode = false;

  register(channel: AsyncChannel, config: ChannelConfig, handler: AsyncHandler): void {
    this.channels.set(channel, { config, handler, activeCount: 0 });
  }

  setPlayMode(playing: boolean): void {
    this.inPlayMode = playing;
  }

  async handleRequest(request: AsyncRequest): Promise<void> {
    const state = this.channels.get(request.channel);

    if (!state) {
      this.pendingResponses.push({
        requestId: request.requestId,
        status: 'error',
        error: `[${request.requestId}] Unknown channel: '${request.channel}'`,
      });
      return;
    }

    if (!CHANNEL_ALLOWED_METHODS[request.channel as AsyncChannel]?.has(request.method)) {
      this.pendingResponses.push({
        requestId: request.requestId,
        status: 'error',
        error: `[${request.requestId}] Method '${request.method}' not allowed on channel '${request.channel}'`,
      });
      return;
    }

    if (state.config.playModeOnly && !this.inPlayMode) {
      this.pendingResponses.push({
        requestId: request.requestId,
        status: 'error',
        error: `[${request.requestId}] Channel '${request.channel}' is only available in play mode`,
      });
      return;
    }

    if (state.activeCount >= state.config.maxConcurrent) {
      this.pendingResponses.push({
        requestId: request.requestId,
        status: 'error',
        error: `[${request.requestId}] Channel '${request.channel}' at max concurrent (${state.config.maxConcurrent})`,
      });
      return;
    }

    state.activeCount++;

    const reportProgress = state.config.supportsProgress
      ? (percent: number, message?: string) => {
          this.pendingResponses.push({
            requestId: request.requestId,
            status: 'progress',
            progress: { percent, message },
          });
        }
      : (_percent: number, _message?: string) => {};

    try {
      const data = await state.handler(
        request.method,
        request.args as Record<string, unknown>,
        reportProgress
      );
      this.pendingResponses.push({ requestId: request.requestId, status: 'ok', data });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[forge:async:${request.channel}] ${request.method} handler error (${request.requestId}):`, err);
      this.pendingResponses.push({
        requestId: request.requestId,
        status: 'error',
        error: `[${request.requestId}] ${errorMsg}`,
      });
    } finally {
      state.activeCount--;
    }
  }

  flush(): AsyncResponse[] | undefined {
    if (this.pendingResponses.length === 0) return undefined;
    return this.pendingResponses.splice(0);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/scripting/__tests__/asyncChannelRouter.test.ts`
Expected: PASS (all 10 tests)

**Step 5: Commit**

```bash
git add web/src/lib/scripting/asyncChannelRouter.ts web/src/lib/scripting/__tests__/asyncChannelRouter.test.ts
git commit -m "feat(async): add AsyncChannelRouter with tests"
```

---

### Task 3: Channel Handlers

**Files:**
- Create: `web/src/lib/scripting/asyncHandlers/physicsHandler.ts`
- Create: `web/src/lib/scripting/asyncHandlers/audioHandler.ts`
- Create: `web/src/lib/scripting/asyncHandlers/aiHandler.ts`
- Create: `web/src/lib/scripting/asyncHandlers/assetHandler.ts`
- Create: `web/src/lib/scripting/asyncHandlers/animationHandler.ts`
- Create: `web/src/lib/scripting/asyncHandlers/index.ts`
- Create: `web/src/lib/scripting/__tests__/asyncHandlers.test.ts`

**Step 1: Write failing tests for handlers**

Create `web/src/lib/scripting/__tests__/asyncHandlers.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createPhysicsHandler } from '../asyncHandlers/physicsHandler';
import { createAudioHandler } from '../asyncHandlers/audioHandler';
import { createAnimationHandler } from '../asyncHandlers/animationHandler';
import { createAIHandler } from '../asyncHandlers/aiHandler';
import { createAssetHandler } from '../asyncHandlers/assetHandler';

describe('physicsHandler', () => {
  it('dispatches raycast to WASM handle_command', async () => {
    const mockWasm = { handle_command: vi.fn().mockReturnValue({ hit: true, entityId: 'e1' }) };
    const handler = createPhysicsHandler(() => mockWasm);
    const result = await handler('raycast', { origin: [0,0,0], direction: [1,0,0], maxDistance: 100 }, () => {});
    expect(mockWasm.handle_command).toHaveBeenCalledWith('raycast_query', expect.objectContaining({ origin: [0,0,0] }));
    expect(result).toEqual({ hit: true, entityId: 'e1' });
  });

  it('dispatches raycast2d to WASM handle_command', async () => {
    const mockWasm = { handle_command: vi.fn().mockReturnValue(null) };
    const handler = createPhysicsHandler(() => mockWasm);
    const result = await handler('raycast2d', { originX: 0, originY: 0, dirX: 1, dirY: 0, maxDistance: 50 }, () => {});
    expect(mockWasm.handle_command).toHaveBeenCalledWith('raycast2d_query', expect.anything());
    expect(result).toBeNull();
  });

  it('throws when engine not ready', async () => {
    const handler = createPhysicsHandler(() => null);
    await expect(handler('raycast', {}, () => {})).rejects.toThrow('Engine not ready');
  });

  it('throws for unknown physics method', async () => {
    const mockWasm = { handle_command: vi.fn() };
    const handler = createPhysicsHandler(() => mockWasm);
    await expect(handler('unknown_method', {}, () => {})).rejects.toThrow('Unknown physics method');
  });
});

describe('audioHandler', () => {
  it('calls audioManager.detectLoopPoints', async () => {
    const mockAudioManager = { detectLoopPoints: vi.fn().mockResolvedValue([{ startTime: 0, endTime: 5 }]) };
    const handler = createAudioHandler(() => mockAudioManager as any);
    const result = await handler('detectLoopPoints', { assetId: 'asset-1' }, () => {});
    expect(mockAudioManager.detectLoopPoints).toHaveBeenCalledWith('asset-1');
    expect(result).toEqual([{ startTime: 0, endTime: 5 }]);
  });

  it('throws for unknown audio method', async () => {
    const handler = createAudioHandler(() => ({} as any));
    await expect(handler('unknown', {}, () => {})).rejects.toThrow('Unknown audio method');
  });
});

describe('animationHandler', () => {
  it('dispatches listClips to WASM', async () => {
    const mockWasm = { handle_command: vi.fn().mockReturnValue(['walk', 'run', 'idle']) };
    const handler = createAnimationHandler(() => mockWasm);
    const result = await handler('listClips', { entityId: 'e1' }, () => {});
    expect(mockWasm.handle_command).toHaveBeenCalledWith('query_animation_clips', { entityId: 'e1' });
    expect(result).toEqual(['walk', 'run', 'idle']);
  });

  it('returns empty array when engine not ready', async () => {
    const handler = createAnimationHandler(() => null);
    const result = await handler('listClips', { entityId: 'e1' }, () => {});
    expect(result).toEqual([]);
  });
});

describe('aiHandler', () => {
  it('polls until completed and reports progress', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ status: 'processing', progress: 50, message: 'Generating...' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ status: 'completed', data: { url: 'https://example.com/tex.png' } }) });

    const handler = createAIHandler(mockFetch, 10); // 10ms poll interval for test speed
    const progressCalls: { percent: number; message?: string }[] = [];
    const reportProgress = (percent: number, message?: string) => { progressCalls.push({ percent, message }); };
    const result = await handler('generateTexture', { prompt: 'lava rock' }, reportProgress);
    expect(result).toEqual({ url: 'https://example.com/tex.png' });
    expect(progressCalls.length).toBeGreaterThanOrEqual(2); // initial 0% + at least one poll progress
    expect(progressCalls[0]).toEqual({ percent: 0, message: 'Submitting request...' });
  });

  it('throws on provider failure', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ jobId: 'job-2' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ status: 'failed', error: 'Provider error' }) });

    const handler = createAIHandler(mockFetch, 10);
    await expect(handler('generateTexture', { prompt: 'test' }, () => {})).rejects.toThrow('Provider error');
  });
});

describe('assetHandler', () => {
  it('reports progress during load', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['fake-image'])),
    });
    const handler = createAssetHandler(mockFetch);
    const progressCalls: { percent: number; message?: string }[] = [];
    const result = await handler('loadImage', { url: 'https://example.com/img.png' }, (p, m) => progressCalls.push({ percent: p, message: m }));
    expect(result).toBeDefined();
    expect(progressCalls.length).toBeGreaterThanOrEqual(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/scripting/__tests__/asyncHandlers.test.ts`
Expected: FAIL (modules not found)

**Step 3: Implement handlers**

Create each handler file. Each handler is a factory function that receives its dependencies (WASM module, audio manager, fetch) and returns an `AsyncHandler` function.

`web/src/lib/scripting/asyncHandlers/physicsHandler.ts`:
```typescript
type WasmModule = { handle_command: (cmd: string, payload: unknown) => unknown } | null;

export function createPhysicsHandler(getWasm: () => WasmModule) {
  return async (method: string, args: Record<string, unknown>, _reportProgress: (percent: number, message?: string) => void): Promise<unknown> => {
    const wasm = getWasm();
    if (!wasm?.handle_command) throw new Error('Engine not ready');

    switch (method) {
      case 'raycast':
        return wasm.handle_command('raycast_query', args);
      case 'raycast2d':
        return wasm.handle_command('raycast2d_query', args);
      case 'isGrounded': {
        const result = wasm.handle_command('raycast2d_query', {
          originX: args.originX ?? 0,
          originY: args.originY ?? 0,
          dirX: 0,
          dirY: -1,
          maxDistance: (args.distance as number) ?? 0.1,
        });
        return result !== null;
      }
      case 'overlapSphere':
        return wasm.handle_command('overlap_sphere_query', args);
      default:
        throw new Error(`Unknown physics method: ${method}`);
    }
  };
}
```

`web/src/lib/scripting/asyncHandlers/audioHandler.ts`:
```typescript
interface AudioManagerLike {
  detectLoopPoints: (assetId: string) => Promise<unknown>;
}

export function createAudioHandler(getAudioManager: () => AudioManagerLike) {
  return async (method: string, args: Record<string, unknown>, _reportProgress: (percent: number, message?: string) => void): Promise<unknown> => {
    const mgr = getAudioManager();
    switch (method) {
      case 'detectLoopPoints':
        return mgr.detectLoopPoints(args.assetId as string);
      case 'getWaveform':
        // Future: implement waveform extraction
        throw new Error('getWaveform not yet implemented');
      default:
        throw new Error(`Unknown audio method: ${method}`);
    }
  };
}
```

`web/src/lib/scripting/asyncHandlers/animationHandler.ts`:
```typescript
type WasmModule = { handle_command: (cmd: string, payload: unknown) => unknown } | null;

export function createAnimationHandler(getWasm: () => WasmModule) {
  return async (method: string, args: Record<string, unknown>, _reportProgress: (percent: number, message?: string) => void): Promise<unknown> => {
    const wasm = getWasm();

    switch (method) {
      case 'listClips': {
        if (!wasm?.handle_command) return [];
        const result = wasm.handle_command('query_animation_clips', args);
        return result ?? [];
      }
      case 'getClipDuration': {
        if (!wasm?.handle_command) return 0;
        const result = wasm.handle_command('query_clip_duration', args);
        return result ?? 0;
      }
      default:
        throw new Error(`Unknown animation method: ${method}`);
    }
  };
}
```

`web/src/lib/scripting/asyncHandlers/aiHandler.ts`:
```typescript
type FetchFn = typeof globalThis.fetch;

const DEFAULT_POLL_INTERVAL_MS = 2000;

export function createAIHandler(fetchFn: FetchFn = globalThis.fetch, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS) {
  return async (method: string, args: Record<string, unknown>, reportProgress: (percent: number, message?: string) => void): Promise<unknown> => {
    reportProgress(0, 'Submitting request...');

    const response = await fetchFn(`/api/generate/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      throw new Error(`AI generation request failed: ${response.status}`);
    }

    const { jobId } = await response.json() as { jobId: string };

    // Poll until complete
    while (true) {
      await new Promise(r => setTimeout(r, pollIntervalMs));

      const statusResponse = await fetchFn(`/api/generate/status/${jobId}`);
      if (!statusResponse.ok) {
        throw new Error(`AI generation status check failed: ${statusResponse.status}`);
      }

      const result = await statusResponse.json() as {
        status: string;
        progress?: number;
        message?: string;
        data?: unknown;
        error?: string;
      };

      if (result.status === 'completed') return result.data;
      if (result.status === 'failed') throw new Error(result.error || 'AI generation failed');
      reportProgress(result.progress ?? 50, result.message);
    }
  };
}
```

`web/src/lib/scripting/asyncHandlers/assetHandler.ts`:
```typescript
type FetchFn = typeof globalThis.fetch;

export function createAssetHandler(fetchFn: FetchFn = globalThis.fetch) {
  return async (method: string, args: Record<string, unknown>, reportProgress: (percent: number, message?: string) => void): Promise<unknown> => {
    switch (method) {
      case 'loadImage': {
        reportProgress(0, 'Fetching image...');
        const response = await fetchFn(args.url as string);
        if (!response.ok) throw new Error(`Failed to load image: ${response.status}`);
        reportProgress(50, 'Decoding...');
        const blob = await response.blob();
        const dataUrl = await blobToDataUrl(blob);
        reportProgress(100, 'Complete');
        return { dataUrl, size: blob.size, type: blob.type };
      }
      case 'loadModel': {
        reportProgress(0, 'Fetching model...');
        const response = await fetchFn(args.url as string);
        if (!response.ok) throw new Error(`Failed to load model: ${response.status}`);
        reportProgress(50, 'Processing...');
        const blob = await response.blob();
        const dataUrl = await blobToDataUrl(blob);
        reportProgress(100, 'Complete');
        return { dataUrl, size: blob.size, type: blob.type };
      }
      default:
        throw new Error(`Unknown asset method: ${method}`);
    }
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}
```

`web/src/lib/scripting/asyncHandlers/index.ts`:
```typescript
export { createPhysicsHandler } from './physicsHandler';
export { createAudioHandler } from './audioHandler';
export { createAnimationHandler } from './animationHandler';
export { createAIHandler } from './aiHandler';
export { createAssetHandler } from './assetHandler';

import type { AsyncChannelRouter } from '../asyncChannelRouter';
import type { ChannelConfig } from '../asyncTypes';
import { CHANNEL_CONFIGS } from '../asyncTypes';
import { createPhysicsHandler } from './physicsHandler';
import { createAudioHandler } from './audioHandler';
import { createAnimationHandler } from './animationHandler';
import { createAIHandler } from './aiHandler';
import { createAssetHandler } from './assetHandler';

type WasmModule = { handle_command: (cmd: string, payload: unknown) => unknown } | null;
interface AudioManagerLike {
  detectLoopPoints: (assetId: string) => Promise<unknown>;
}

export function registerAllHandlers(
  router: AsyncChannelRouter,
  deps: {
    getWasm: () => WasmModule;
    getAudioManager: () => AudioManagerLike;
  }
): void {
  router.register('physics', CHANNEL_CONFIGS.physics, createPhysicsHandler(deps.getWasm));
  router.register('animation', CHANNEL_CONFIGS.animation, createAnimationHandler(deps.getWasm));
  router.register('audio', CHANNEL_CONFIGS.audio, createAudioHandler(deps.getAudioManager));
  router.register('ai', CHANNEL_CONFIGS.ai, createAIHandler());
  router.register('asset', CHANNEL_CONFIGS.asset, createAssetHandler());
  // multiplayer: registered later when multiplayer is implemented
}
```

**Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/scripting/__tests__/asyncHandlers.test.ts`
Expected: PASS

**Step 5: Run lint and TypeScript**

Run: `cd web && npx eslint --max-warnings 0 src/lib/scripting/asyncHandlers/ src/lib/scripting/asyncTypes.ts src/lib/scripting/asyncChannelRouter.ts && npx tsc --noEmit`
Expected: PASS (zero warnings, no type errors)

**Step 6: Commit**

```bash
git add web/src/lib/scripting/asyncHandlers/ web/src/lib/scripting/__tests__/asyncHandlers.test.ts
git commit -m "feat(async): add channel handlers for physics, audio, ai, asset, animation"
```

---

### Task 4: Worker-Side Async Protocol

**Files:**
- Modify: `web/src/lib/scripting/scriptWorker.ts` (lines 66-100 for state, 108-770 for forge API, 846-999 for message handler)
- Create: `web/src/lib/scripting/__tests__/scriptWorkerAsync.test.ts`

**Step 1: Write failing tests for worker-side async**

Create `web/src/lib/scripting/__tests__/scriptWorkerAsync.test.ts`. Uses existing pattern from `scriptWorker.test.ts`: stub `self` with mock `postMessage`, `vi.resetModules()` + dynamic import.

Key tests (see design doc section 8.1 for full list):
- `asyncRequest sends correct message format`
- `ok response resolves promise`
- `error response rejects with requestId`
- `progress calls onProgress callback`
- `timeout rejects pending requests`
- `stop rejects all pending`
- `max pending enforced` (test the per-channel count the worker tracks — note: worker doesn't enforce channel limits, main thread does, but worker tracks total pending)
- `requestId counter resets on init`
- `late response after timeout silently dropped`
- `channel timeouts from init message used`

Test file should import the worker module after resetting modules (same pattern as `scriptWorker.test.ts`). The tests exercise the `asyncRequest` function by:
1. Calling forge.physics2d.raycast() which internally calls asyncRequest
2. Verifying postMessage was called with `{ type: 'async_request', ... }`
3. Simulating a tick message with `asyncResponses` and verifying the Promise resolves/rejects

**Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/scripting/__tests__/scriptWorkerAsync.test.ts`
Expected: FAIL

**Step 3: Modify scriptWorker.ts**

Add to the top of `scriptWorker.ts` (after line 98, before `distanceBetween`):

```typescript
// --- Async request/response protocol ---
import type { AsyncChannel, AsyncResponse } from './asyncTypes';

interface PendingAsyncRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: { percent: number; message?: string }) => void;
  createdAt: number;
  channel: AsyncChannel;
  method: string;
}

const pendingAsyncRequests = new Map<string, PendingAsyncRequest>();
let nextRequestId = 0;
let channelTimeouts: Record<string, number> = {};

function generateRequestId(): string {
  return `req_${++nextRequestId}`;
}

function asyncRequest(
  channel: AsyncChannel,
  method: string,
  args: unknown,
  onProgress?: (progress: { percent: number; message?: string }) => void
): Promise<unknown> {
  const requestId = generateRequestId();

  return new Promise((resolve, reject) => {
    pendingAsyncRequests.set(requestId, {
      resolve, reject, onProgress,
      createdAt: performance.now(),
      channel, method,
    });

    (self as unknown as Worker).postMessage({
      type: 'async_request',
      requestId, channel, method, args,
    });
  });
}

function processAsyncResponses(responses: AsyncResponse[]) {
  for (const resp of responses) {
    const pending = pendingAsyncRequests.get(resp.requestId);
    if (!pending) continue;

    if (resp.status === 'ok') {
      pending.resolve(resp.data);
      pendingAsyncRequests.delete(resp.requestId);
    } else if (resp.status === 'error') {
      pending.reject(new Error(resp.error || 'Unknown async error'));
      pendingAsyncRequests.delete(resp.requestId);
    } else if (resp.status === 'progress') {
      pending.onProgress?.(resp.progress!);
    }
  }
}

function checkAsyncTimeouts() {
  const now = performance.now();
  for (const [id, req] of pendingAsyncRequests) {
    const timeout = channelTimeouts[req.channel] ?? 10_000;
    if (now - req.createdAt > timeout) {
      console.warn(`[forge:async] ${req.channel}.${req.method} failed (${id}): timed out after ${timeout}ms`);
      req.reject(new Error(`[${id}] Async '${req.channel}.${req.method}' timed out after ${timeout}ms`));
      pendingAsyncRequests.delete(id);
    }
  }
}

function cleanupAsyncRequests() {
  for (const [, req] of pendingAsyncRequests) {
    req.reject(new Error('Script execution stopped'));
  }
  pendingAsyncRequests.clear();
  nextRequestId = 0;
}
```

Update `buildForgeApi` — replace the `physics2d.raycast` and `physics2d.isGrounded` stubs (lines 299-305):

```typescript
raycast: (originX: number, originY: number, dirX: number, dirY: number, maxDistance = 100) =>
  asyncRequest('physics', 'raycast2d', { originX, originY, dirX, dirY, maxDistance }),
isGrounded: (eid: string, distance = 0.1) =>
  asyncRequest('physics', 'isGrounded', { entityId: eid, distance }),
```

Update `animation.listClips` (line 370-373):

```typescript
listClips: (eid: string) => {
  // Sync stub — deprecated, use listClipsAsync
  return [] as string[];
},
listClipsAsync: (eid: string) =>
  asyncRequest('animation', 'listClips', { entityId: eid }),
```

Add new `ai` namespace to forge API (after the `skeleton2d` section, before `time`):

```typescript
ai: {
  generateTexture: (prompt: string, onProgress?: (p: { percent: number; message?: string }) => void) =>
    asyncRequest('ai', 'generateTexture', { prompt }, onProgress),
  generateModel: (prompt: string, onProgress?: (p: { percent: number; message?: string }) => void) =>
    asyncRequest('ai', 'generateModel', { prompt }, onProgress),
  generateSound: (prompt: string, onProgress?: (p: { percent: number; message?: string }) => void) =>
    asyncRequest('ai', 'generateSound', { prompt }, onProgress),
  generateVoice: (text: string, onProgress?: (p: { percent: number; message?: string }) => void) =>
    asyncRequest('ai', 'generateVoice', { text }, onProgress),
  generateMusic: (prompt: string, onProgress?: (p: { percent: number; message?: string }) => void) =>
    asyncRequest('ai', 'generateMusic', { prompt }, onProgress),
},
```

Update `case 'init'` (line 850-885) — add after `uiDirty = false;` (line 863):

```typescript
// Reset async protocol state
cleanupAsyncRequests();
channelTimeouts = msg.channelTimeouts || {};
```

Update `case 'tick'` (line 888-945) — add BEFORE the `pendingCommands = [];` line (line 932), BEFORE calling onUpdate:

```typescript
// Process async responses before running scripts
if (msg.asyncResponses) {
  processAsyncResponses(msg.asyncResponses);
}
checkAsyncTimeouts();
```

Update `case 'stop'` (line 948-966) — add before `scripts = [];` (line 959):

```typescript
cleanupAsyncRequests();
```

**Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/scripting/__tests__/scriptWorkerAsync.test.ts`
Expected: PASS

**Step 5: Run existing scriptWorker tests to verify no regressions**

Run: `cd web && npx vitest run src/lib/scripting/__tests__/scriptWorker.test.ts src/lib/scripting/__tests__/scriptWorkerIntegration.test.ts src/lib/scripting/__tests__/scriptSecurity.test.ts`
Expected: PASS (all existing tests still pass)

**Step 6: Run lint**

Run: `cd web && npx eslint --max-warnings 0 src/lib/scripting/scriptWorker.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add web/src/lib/scripting/scriptWorker.ts web/src/lib/scripting/__tests__/scriptWorkerAsync.test.ts
git commit -m "feat(async): add async request/response protocol to script worker"
```

---

### Task 5: Main-Thread Integration (useScriptRunner)

**Files:**
- Modify: `web/src/lib/scripting/useScriptRunner.ts` (lines 113-493)

**Step 1: Modify useScriptRunner to integrate the router**

Add imports at top of `useScriptRunner.ts`:

```typescript
import { AsyncChannelRouter } from './asyncChannelRouter';
import { registerAllHandlers } from './asyncHandlers';
import { CHANNEL_CONFIGS } from './asyncTypes';
import type { AsyncRequest } from './asyncTypes';
```

Add router ref alongside `workerRef` (after line 116):

```typescript
const routerRef = useRef<AsyncChannelRouter | null>(null);
```

Inside the `if (engineMode === 'play' ...)` block, after creating the worker (line 142), instantiate the router:

```typescript
const router = new AsyncChannelRouter();
registerAllHandlers(router, {
  getWasm: () => wasmModule,
  getAudioManager: () => audioManager,
});
router.setPlayMode(true);
routerRef.current = router;
```

Add `async_request` case to `worker.onmessage` switch (after the `dialogue_set_variable` case, around line 279):

```typescript
case 'async_request': {
  const request = msg as AsyncRequest;
  if (routerRef.current) {
    routerRef.current.handleRequest(request);
  }
  break;
}
```

Update the `setPlayTickCallback` to flush router responses into tick messages. In the `worker.postMessage({ type: 'tick', ... })` call (around line 404), add:

```typescript
asyncResponses: routerRef.current?.flush(),
```

Update the `worker.postMessage({ type: 'init', ... })` call (around line 337) to include channel timeouts:

```typescript
channelTimeouts: Object.fromEntries(
  Object.entries(CHANNEL_CONFIGS).map(([ch, cfg]) => [ch, cfg.timeoutMs])
),
```

In the cleanup block when leaving play mode (line 460-471), add:

```typescript
if (routerRef.current) {
  routerRef.current.setPlayMode(false);
  routerRef.current = null;
}
```

**Step 2: Run lint and TypeScript**

Run: `cd web && npx eslint --max-warnings 0 src/lib/scripting/useScriptRunner.ts && npx tsc --noEmit`
Expected: PASS

**Step 3: Run all scripting tests**

Run: `cd web && npx vitest run src/lib/scripting/`
Expected: PASS (all tests including existing ones)

**Step 4: Commit**

```bash
git add web/src/lib/scripting/useScriptRunner.ts
git commit -m "feat(async): integrate AsyncChannelRouter into useScriptRunner"
```

---

### Task 6: Full Test Suite Validation

**Files:**
- Modify: `TESTING.md`

**Step 1: Run full test suite**

Run: `cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run`
Expected: PASS (zero lint warnings, no type errors, all tests pass)

**Step 2: Run MCP tests**

Run: `cd mcp-server && npx vitest run`
Expected: PASS

**Step 3: Add manual test cases to TESTING.md**

Add a new section "Async Script Protocol" with:
1. Play mode script calls `forge.physics2d.raycast()`, logs result via `forge.log()` — verify value appears in console
2. Script issues 40 physics raycasts in one frame — verify first 32 succeed, remaining 8 rejected with clear error + requestId
3. Stop play mode with pending AI generation — verify no console errors or unhandled rejections
4. Script calls `forge.ai.generateTexture()` with progress callback — verify progress logs appear before final result

**Step 4: Commit**

```bash
git add TESTING.md
git commit -m "docs: add async protocol manual test cases to TESTING.md"
```

---

### Task 7: E2E Test Fixtures and Tests

**Files:**
- Create: `web/e2e/fixtures/async-protocol/physics-raycast.json`
- Create: `web/e2e/fixtures/async-protocol/ai-generateTexture.json`
- Create: `web/e2e/tests/async-protocol.spec.ts`

**Step 1: Create fixture files**

Record-style fixtures with request/response pairs. Physics fixtures can be simple mock shapes; AI fixtures should include the full poll lifecycle (submit → progress → complete).

`web/e2e/fixtures/async-protocol/physics-raycast.json`:
```json
{
  "description": "Physics 2D raycast response",
  "response": { "hit": true, "entityId": "target-1", "point": [5, 0], "normal": [0, 1] }
}
```

`web/e2e/fixtures/async-protocol/ai-generateTexture.json`:
```json
{
  "description": "AI texture generation lifecycle",
  "submitResponse": { "jobId": "test-job-1" },
  "pollResponses": [
    { "status": "processing", "progress": 25, "message": "Generating mesh..." },
    { "status": "processing", "progress": 75, "message": "Applying textures..." },
    { "status": "completed", "data": { "url": "https://cdn.example.com/texture.png" } }
  ]
}
```

**Step 2: Create E2E test file**

`web/e2e/tests/async-protocol.spec.ts`:

Test cases per design doc section 8.5:
- Script async raycast (real WASM — needs engine build)
- Script async timeout produces error with requestId
- Concurrent async across channels
- Stop play mode cleans up pending
- AI progress with fixture replay via `page.route()`

**NOTE:** These tests require a WASM build. If the engine is not built, mark them as `test.skip()` with a comment. The CI pipeline includes WASM build before E2E.

**Step 3: Run E2E tests (if WASM build available)**

Run: `cd web && npx playwright test e2e/tests/async-protocol.spec.ts`
Expected: PASS (or skip if no WASM build)

**Step 4: Commit**

```bash
git add web/e2e/fixtures/async-protocol/ web/e2e/tests/async-protocol.spec.ts
git commit -m "test(async): add E2E tests with recorded fixtures for async protocol"
```

---

### Task 8: Final Verification and Cleanup

**Step 1: Run complete validation suite**

```bash
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run
cd ../mcp-server && npx vitest run
```

Expected: All pass.

**Step 2: Verify no regressions in existing tests**

Run: `cd web && npx vitest run src/lib/scripting/`
Expected: All existing scriptWorker, scriptSecurity, scriptWorkerIntegration tests still pass alongside new async tests.

**Step 3: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore(async): final cleanup and verification"
```
