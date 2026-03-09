# Async Channel Protocol for Script Worker

**Date:** 2026-03-09
**Status:** Approved
**Scope:** Typed async request/response protocol with per-channel concurrency, timeouts, and progress streaming

## Problem Statement

SpawnForge's script worker communicates with the main thread via fire-and-forget `postMessage`. Scripts can issue commands (`forge.physics.applyForce()`), but there is no mechanism to receive results back. This blocks any API that needs to return data asynchronously — physics raycasts, audio analysis, AI generation, asset loading, and future multiplayer RPC.

## Design Decisions

- **Approach 3 (Message Bus with Typed Channels)** selected over unified router or per-domain registries. Per-channel concurrency, timeouts, and progress support justify the small abstraction cost. Multiplayer is confirmed as a future feature, making the channel pattern pay for itself.
- **Main thread handles all processing.** No additional workers — WASM and Web Audio are main-thread-bound. AI/asset operations are I/O-bound (fetch), not CPU-bound.
- **Bridge operations (Aseprite, etc.) excluded from scripts.** Editor-only, server-side `execFile` — different trust boundary.
- **Hybrid progress model.** Simple request/response for fast channels (physics, animation). Progress streaming for slow channels (AI, asset).
- **Recorded fixture pattern for E2E tests.** Integration tests record real API responses; Playwright replays fixtures. No external service calls in CI.

## 1. Message Protocol

### 1.1 Request (Worker → Main Thread)

```typescript
interface AsyncRequest {
  type: 'async_request';
  requestId: string;       // Monotonic: "req_1", "req_2" (reset on init)
  channel: AsyncChannel;   // "physics" | "audio" | "ai" | "asset" | "animation" | "multiplayer"
  method: string;          // "raycast", "detectLoopPoints", "generateTexture"
  args: unknown;           // Structured-clone-safe payload
}

type AsyncChannel = 'physics' | 'audio' | 'ai' | 'asset' | 'animation' | 'multiplayer';
```

Requests are a separate message type from the existing `commands` batch. Fire-and-forget commands are untouched.

### 1.2 Response (Main Thread → Worker, batched in tick)

```typescript
interface AsyncResponse {
  requestId: string;
  status: 'ok' | 'error' | 'progress';
  data?: unknown;          // Final result (status = 'ok')
  error?: string;          // Error message (status = 'error')
  progress?: {             // Intermediate update (status = 'progress')
    percent: number;       // 0-100
    message?: string;      // "Generating mesh..."
  };
}

// Added to existing tick message:
interface TickMessage {
  // ... existing fields ...
  asyncResponses?: AsyncResponse[];
}
```

Progress responses do NOT resolve the Promise — only `ok` and `error` do. Progress is delivered via an optional callback.

### 1.3 Correlation ID Generation

Worker-side monotonic counter, reset on `init`:

```typescript
let nextRequestId = 0;
function generateRequestId(): string {
  return `req_${++nextRequestId}`;
}
```

## 2. Channel Configuration

```typescript
interface ChannelConfig {
  maxConcurrent: number;
  timeoutMs: number;
  supportsProgress: boolean;
  playModeOnly: boolean;
}
```

| Channel | maxConcurrent | timeout | progress | playModeOnly | Rationale |
|---------|:---:|:---:|:---:|:---:|---|
| `physics` | 32 | 1,000ms | No | Yes | High-frequency raycasts, sub-frame WASM calls |
| `animation` | 8 | 2,000ms | No | Yes | Clip queries, state lookups |
| `audio` | 4 | 10,000ms | No | No | `detectLoopPoints` works in editor too |
| `ai` | 3 | 120,000ms | Yes | No | Meshy/ElevenLabs/Suno — long, expensive |
| `asset` | 4 | 30,000ms | Yes | No | Image/model loading — moderate duration |
| `multiplayer` | 16 | 10,000ms | No | Yes | Future — RPC calls during gameplay |

Requests to a full channel are immediately rejected (no queueing).

### 2.1 Method Allowlist

```typescript
const CHANNEL_ALLOWED_METHODS: Record<AsyncChannel, Set<string>> = {
  physics:     new Set(['raycast', 'raycast2d', 'isGrounded', 'overlapSphere']),
  animation:   new Set(['listClips', 'getClipDuration']),
  audio:       new Set(['detectLoopPoints', 'getWaveform']),
  ai:          new Set(['generateTexture', 'generateModel', 'generateSound', 'generateVoice', 'generateMusic']),
  asset:       new Set(['loadImage', 'loadModel']),
  multiplayer: new Set([]),
};
```

## 3. Worker-Side API

### 3.1 Pending Request Registry

```typescript
interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: { percent: number; message?: string }) => void;
  createdAt: number;
  channel: AsyncChannel;
  method: string;
}

const pendingRequests = new Map<string, PendingRequest>();
```

### 3.2 Generic Request Helper

```typescript
function asyncRequest(
  channel: AsyncChannel,
  method: string,
  args: unknown,
  onProgress?: (progress: { percent: number; message?: string }) => void
): Promise<unknown> {
  const requestId = generateRequestId();

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, {
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
```

### 3.3 Response Processing (in tick handler, before onUpdate)

```typescript
if (msg.asyncResponses) {
  for (const resp of msg.asyncResponses) {
    const pending = pendingRequests.get(resp.requestId);
    if (!pending) continue;

    if (resp.status === 'ok') {
      pending.resolve(resp.data);
      pendingRequests.delete(resp.requestId);
    } else if (resp.status === 'error') {
      pending.reject(new Error(resp.error || 'Unknown async error'));
      pendingRequests.delete(resp.requestId);
    } else if (resp.status === 'progress') {
      pending.onProgress?.(resp.progress!);
    }
  }
}
```

### 3.4 Timeout Checking

Channel timeouts delivered from main thread in `init` message:

```typescript
// Added to init message:
{ type: 'init', ..., channelTimeouts: Record<AsyncChannel, number> }
```

```typescript
function checkTimeouts(channelTimeouts: Record<string, number>) {
  const now = performance.now();
  for (const [id, req] of pendingRequests) {
    const timeout = channelTimeouts[req.channel] ?? 10_000;
    if (now - req.createdAt > timeout) {
      req.reject(new Error(`[${id}] Async '${req.channel}.${req.method}' timed out after ${timeout}ms`));
      pendingRequests.delete(id);
    }
  }
}
```

### 3.5 Cleanup

```typescript
// On 'stop':
for (const [, req] of pendingRequests) {
  req.reject(new Error('Script execution stopped'));
}
pendingRequests.clear();
nextRequestId = 0;

// On 'init':
pendingRequests.clear();
nextRequestId = 0;
```

### 3.6 forge.* API Surface

```typescript
// Simple (no progress):
physics2d: {
  raycast: (originX, originY, dirX, dirY, maxDistance = 100) =>
    asyncRequest('physics', 'raycast2d', { originX, originY, dirX, dirY, maxDistance }),
  isGrounded: (eid, distance = 0.1) =>
    asyncRequest('physics', 'isGrounded', { entityId: eid, distance }),
},

// Progress-aware:
ai: {
  generateTexture: (prompt: string, onProgress?) =>
    asyncRequest('ai', 'generateTexture', { prompt }, onProgress),
  generateModel: (prompt: string, onProgress?) =>
    asyncRequest('ai', 'generateModel', { prompt }, onProgress),
},
```

## 4. Main-Thread Router

### 4.1 AsyncChannelRouter

New file: `web/src/lib/scripting/asyncChannelRouter.ts`

```typescript
type AsyncHandler = (method: string, args: Record<string, unknown>) => Promise<unknown>;
type AsyncHandlerWithProgress = (
  method: string,
  args: Record<string, unknown>,
  reportProgress: (percent: number, message?: string) => void
) => Promise<unknown>;

class AsyncChannelRouter {
  private channels = new Map<string, ChannelState>();
  private pendingResponses: AsyncResponse[] = [];

  register(channel: AsyncChannel, config: ChannelConfig, handler): void;
  async handleRequest(request: AsyncRequest): Promise<void>;
  flush(): AsyncResponse[] | undefined;
}
```

Router validates: channel exists → method in allowlist → concurrency not exceeded → playModeOnly check → dispatch to handler. All error paths produce an `AsyncResponse` with `requestId` preserved.

### 4.2 Handler Registration

```typescript
const router = new AsyncChannelRouter();

router.register('physics', PHYSICS_CONFIG, async (method, args) => {
  if (!wasmModule?.handle_command) throw new Error('Engine not ready');
  switch (method) {
    case 'raycast': return wasmModule.handle_command('raycast_query', args);
    case 'raycast2d': return wasmModule.handle_command('raycast2d_query', args);
    case 'isGrounded': { /* downward raycast */ }
  }
});

router.register('ai', AI_CONFIG, async (method, args, reportProgress) => {
  reportProgress(0, 'Submitting request...');
  const { jobId } = await fetch(`/api/generate/${method}`, { method: 'POST', body: JSON.stringify(args) }).then(r => r.json());
  while (true) {
    const result = await fetch(`/api/generate/status/${jobId}`).then(r => r.json());
    if (result.status === 'completed') return result.data;
    if (result.status === 'failed') throw new Error(result.error);
    reportProgress(result.progress ?? 50, result.message);
    await new Promise(r => setTimeout(r, 2000));
  }
});
```

### 4.3 Flushing into Tick

```typescript
worker.postMessage({
  type: 'tick',
  ...,
  asyncResponses: router.flush(),
});
```

## 5. Security Model

**Layer 1 — Channel allowlist:** `CHANNEL_ALLOWED_METHODS` is the sole gate. Unknown channel or method = immediate error.

**Layer 2 — Per-channel concurrency caps:** Prevents flooding any single subsystem.

**Layer 3 — Data sanitization:** Responses must NEVER include file paths, auth tokens, API keys, or store state beyond what's synced via tick data.

**Excluded from scripts:** Bridge operations (Aseprite, etc.) — editor-only, server-side `execFile`.

**Interaction with existing security:**
- `MAX_COMMANDS_PER_FRAME` (100) unchanged, does NOT apply to async requests
- Watchdog timer unaffected — `async_request` sent outside `onUpdate`
- `SCRIPT_ALLOWED_COMMANDS` unchanged — parallel system

## 6. Error Handling

### 6.1 Error Categories

| Scenario | Response | Timing |
|----------|----------|--------|
| Unknown channel | `error` | Same tick |
| Method not in allowlist | `error` | Same tick |
| Channel at max concurrent | `error` | Same tick |
| Engine not ready | `error` | Same tick |
| Handler throws | `error` | When handler fails |
| Request timeout | Promise rejected (worker-side) | On tick after timeout |
| Play mode stopped | All pending rejected | Immediately |
| Worker terminated | Promises orphaned | Acceptable |

### 6.2 RequestId in All Errors

All error messages include the `requestId` for traceability:

```typescript
// Worker-side logging:
console.warn(`[forge:async] ${req.channel}.${req.method} failed (${id}): ${errorMessage}`);

// Error objects scripts receive:
new Error(`[${requestId}] Async '${channel}.${method}' timed out after ${timeout}ms`)

// Main-thread handler logging:
console.error(`[forge:async:${request.channel}] ${request.method} handler error (${request.requestId}):`, err);
```

### 6.3 Edge Cases

- **Response after timeout:** Worker already deleted pending request. Response silently dropped via `if (!pending) continue`.
- **Progress after timeout:** Same — harmlessly ignored.
- **Rapid init/stop cycles:** Both boundaries clear `pendingRequests` and reset counter. No leaked requests.
- **Edit mode request to playModeOnly channel:** Immediate error response.
- **Unhandled Promise rejection:** Logged by worker's global `onunhandledrejection` handler.

## 7. Migration and Backward Compatibility

**Never convert an existing synchronous method to async.**

- **Already async (upgrade in-place):** `forge.physics2d.raycast()`, `forge.physics2d.isGrounded()` — already return Promises (stubs).
- **Currently synchronous (add async variant):** `forge.animation.listClips()` → keep sync stub, add `forge.animation.listClipsAsync()`. Deprecate sync with one-per-session console warning.
- **New methods (async from birth):** All `forge.ai.*`, `forge.asset.*`, `forge.audio.detectLoopPoints()`.

Fire-and-forget commands (`pendingCommands` + `flushCommands()`) are completely untouched.

## 8. Test Plan

### 8.1 Unit Tests — Worker Side (`scriptWorkerAsync.test.ts`)

- asyncRequest sends correct message format (type, requestId, channel, method, args)
- ok response resolves promise with data
- error response rejects with requestId in message
- progress response calls onProgress callback, Promise stays pending
- progress then ok resolves correctly
- timeout rejects with requestId in error message
- stop rejects all pending
- max pending per channel enforced (immediate rejection)
- requestId counter resets on init
- late response after timeout silently dropped
- channel timeouts from init message used

### 8.2 Unit Tests — Router (`asyncChannelRouter.test.ts`)

- unknown channel returns error response
- disallowed method returns error response
- concurrency limit enforced
- activeCount decrements on handler completion
- activeCount decrements on handler error
- progress reported for progress-enabled channel
- progress no-op for non-progress channel
- flush drains and returns responses, second flush returns undefined
- handler error caught and wrapped with requestId
- playModeOnly channel rejects in edit mode

### 8.3 Unit Tests — Handlers (`asyncHandlers.test.ts`)

- physics handler dispatches to WASM handle_command
- physics handler throws when engine not ready
- audio handler calls audioManager.detectLoopPoints
- ai handler polls until completed, reports progress
- ai handler throws on provider failure
- asset handler reports progress during load

### 8.4 Integration Tests (`scriptWorkerAsyncIntegration.test.ts`)

- end-to-end raycast from script (request → tick response → resolve)
- multiple channels concurrent (physics + audio same frame)
- AI generation with progress (request → progress → progress → ok)
- channel independence under load (full physics doesn't block AI)

### 8.5 E2E Tests (`web/e2e/tests/async-protocol.spec.ts`)

Uses recorded fixture pattern — integration tests record real API responses, Playwright replays fixtures via `page.route()` interception.

- script async raycast returns result (real WASM, no mocking)
- script async timeout produces error with requestId (real WASM)
- script async progress callback fires (fixture-mocked AI route)
- concurrent async across channels (real WASM + fixture-mocked)
- stop play mode cleans up pending (no unhandled rejections)
- channel concurrency limit visible to user (real WASM)

### 8.6 Manual Test Cases (TESTING.md)

1. Play mode script calls `forge.physics2d.raycast()`, logs result — verify value in console
2. Script issues 40 physics raycasts in one frame — first 32 succeed, remaining 8 rejected with requestId
3. Stop play mode with pending AI generation — no console errors
4. Script calls `forge.ai.generateTexture()` with progress callback — progress logs appear before result

## 9. Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `web/src/lib/scripting/asyncChannelRouter.ts` | AsyncChannelRouter class, ChannelConfig, AsyncChannel type, CHANNEL_ALLOWED_METHODS |
| `web/src/lib/scripting/asyncHandlers/physicsHandler.ts` | Physics channel handler |
| `web/src/lib/scripting/asyncHandlers/audioHandler.ts` | Audio channel handler |
| `web/src/lib/scripting/asyncHandlers/aiHandler.ts` | AI channel handler with progress polling |
| `web/src/lib/scripting/asyncHandlers/assetHandler.ts` | Asset channel handler with progress |
| `web/src/lib/scripting/asyncHandlers/animationHandler.ts` | Animation channel handler |
| `web/src/lib/scripting/asyncHandlers/index.ts` | Re-exports + registerAllHandlers() |
| `web/src/lib/scripting/__tests__/asyncChannelRouter.test.ts` | Router unit tests |
| `web/src/lib/scripting/__tests__/scriptWorkerAsync.test.ts` | Worker-side async tests |
| `web/src/lib/scripting/__tests__/asyncHandlers.test.ts` | Handler unit tests |
| `web/e2e/tests/async-protocol.spec.ts` | E2E tests with fixture replay |
| `web/e2e/fixtures/async-protocol/` | Recorded response fixtures |

### Modified Files

| File | Changes |
|------|---------|
| `web/src/lib/scripting/scriptWorker.ts` | pendingRequests, asyncRequest(), response processing, timeout checking, forge.* API updates |
| `web/src/lib/scripting/useScriptRunner.ts` | Router instantiation, handler registration, async_request in onmessage, flush in tick, channelTimeouts in init |
| `web/src/lib/scripting/types.ts` | AsyncRequest, AsyncResponse, AsyncChannel, ChannelConfig type exports |
| `TESTING.md` | Manual test cases |
