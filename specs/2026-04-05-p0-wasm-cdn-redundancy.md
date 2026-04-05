# P0: WASM CDN Redundancy — Eliminate Single Point of Failure

> Closes #8178 — WASM CDN single point of failure — R2 down = blank screen

## Problem

The 3D editor loads WASM binaries exclusively from a single Cloudflare R2 origin (`engine.spawnforge.ai`). If this CDN is down:

1. `fetch()` for `forge_engine_bg.wasm` fails
2. If WebGPU path fails, there's a fallback to WebGL2 — but both use the same CDN origin
3. User sees InitOverlay's error state with browser requirements — no retry, no fallback CDN
4. Editor is completely non-functional

### Current Architecture

```
Browser
  → useEngine.ts (loadWasm)
    → probeWebGPU()
    → loadWasmFromPath(`${ENGINE_CDN_ROOT}/engine-pkg-${backend}/`)
      → fetchWasmWithMetrics(wasmUrl, ...)  // single fetch, no retry
      → wasm.default(response)              // WASM compilation
    → [if WebGPU fails] retry with WebGL2 path (SAME CDN origin)
    → [if both fail] setLoadingState({ phase: 'error' })
```

Key observations from `web/src/hooks/useEngine.ts`:
- `ENGINE_CDN_ROOT` is a single origin (line 220-224): either `${CDN_BASE}/${VERSION}` or `${CDN_BASE}/latest`
- WebGPU → WebGL2 fallback exists (line 402-421) but both hit the same R2 bucket
- No retry logic on fetch failure — single attempt per backend
- `fetchWasmWithMetrics()` in `cdnAnalytics.ts` is a thin wrapper around `fetch()` with no retry
- Error recovery exists (`resetEngine()`, `recoverEngine()`) but only for post-load crashes, not fetch failures

### CDN Infrastructure

- R2 bucket: `spawnforge-engine` on Cloudflare account `0b949ff499d179e24dde841f71d6134f`
- Cloudflare Worker `engine-cdn` deployed at `engine.spawnforge.ai/*` — adds CORS headers (source in repo, deployed via wrangler)
- WASM files: ~8-15MB each, 4 variants (editor-webgpu, editor-webgl2, runtime-webgpu, runtime-webgl2)
- Versioned paths: `/<git-sha>/engine-pkg-{backend}/forge_engine_bg.wasm`
- Fallback path: `/latest/engine-pkg-{backend}/forge_engine_bg.wasm`

## Implementation Plan

### Phase 1: Fetch retry with exponential backoff

**Goal**: Handle transient CDN failures (network blip, 502, timeout).

Modify `loadWasmFromPath()` in `useEngine.ts` to retry the WASM fetch up to 3 times with exponential backoff:

```typescript
async function fetchWithRetry(
  url: string,
  signal: AbortSignal,
  maxAttempts = 3,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(url, { signal });
      if (response.ok) return response;
      // 5xx = transient, retry. 4xx = permanent, fail fast.
      if (response.status < 500) throw new Error(`WASM fetch failed: ${response.status}`);
      lastError = new Error(`WASM fetch failed: ${response.status}`);
    } catch (err) {
      if (signal.aborted) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < maxAttempts - 1) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError!;
}
```

**Files**: `web/src/hooks/useEngine.ts`, `web/src/lib/monitoring/cdnAnalytics.ts`

### Phase 2: Same-origin fallback (Vercel static assets)

**Goal**: If CDN is completely down, load WASM from Vercel's own static asset CDN.

**Critical constraint**: The JS glue file (`forge_engine.js`) and the WASM binary (`forge_engine_bg.wasm`) are a coupled pair. The JS glue contains relative path references to the WASM binary. They MUST be loaded from the same origin — you cannot load the JS from CDN and the WASM from same-origin or vice versa.

1. **`build_wasm.ps1` already copies WASM to `web/public/`** — confirmed at line 125-128. The .gitignore excludes these. Same-origin fallback is already physically possible.

2. **Add fallback origin resolution** that swaps the ENTIRE base path (both JS glue and WASM):

```typescript
function getWasmBasePaths(backend: 'webgpu' | 'webgl2'): string[] {
  const paths: string[] = [];

  // Primary: R2 CDN (versioned or latest)
  if (ENGINE_CDN_ROOT) {
    paths.push(`${ENGINE_CDN_ROOT}/engine-pkg-${backend}/`);
  }

  // Fallback: same-origin (Vercel static assets from web/public/)
  // Both JS glue AND WASM binary must come from the same origin
  paths.push(`/engine-pkg-${backend}/`);

  return paths;
}
```

3. **Modify `loadWasm()`** to try each base path in order. The existing `loadWasmFromPath()` already loads both JS and WASM from the same `basePath`, so this is a loop around the existing function:

```typescript
for (const basePath of getWasmBasePaths(backend)) {
  try {
    wasmModule = await loadWasmFromPath(basePath, jsFile, wasmFile, signal, onProgress);
    return wasmModule;
  } catch (err) {
    console.warn(`WASM load failed from ${basePath}:`, err);
    continue;
  }
}
throw new Error('Failed to load WASM from all origins');
```

4. **CORS note**: The R2 CDN origin uses a Cloudflare Worker (`engine-cdn`) to add CORS headers. Same-origin fallback doesn't need CORS since it's served by Vercel. No CORS issues on fallback.

**Build pipeline clarification**: WASM binaries are gitignored and NOT built during Vercel's `next build`. They are:
- Built locally via `build_wasm.ps1` (requires Rust toolchain)
- Uploaded to R2 CDN via `/deploy-engine` skill (`wrangler r2 object put`)
- Copied to `web/public/` by the build script for local dev

For the same-origin fallback to work in production, the CD pipeline must include a step that downloads the current WASM binaries from R2 into `web/public/` before `next build`. This can be a GitHub Actions step:
```yaml
- name: Fetch WASM from R2 for same-origin fallback
  run: |
    for variant in editor-webgpu editor-webgl2 runtime-webgpu runtime-webgl2; do
      mkdir -p web/public/engine-pkg-${variant}
      curl -sL https://engine.spawnforge.ai/${COMMIT_SHA}/engine-pkg-${variant}/forge_engine.js \
        -o web/public/engine-pkg-${variant}/forge_engine.js
      curl -sL https://engine.spawnforge.ai/${COMMIT_SHA}/engine-pkg-${variant}/forge_engine_bg.wasm \
        -o web/public/engine-pkg-${variant}/forge_engine_bg.wasm
    done
```

**Tradeoff**: Vercel deployment size increases by ~32-60MB (4 WASM variants). Vercel Pro plan limit is 250MB per deployment — verified we're well within budget. Adds ~30s to deploy for the download step.

**Files**: `web/src/hooks/useEngine.ts`, `.github/workflows/cd.yml` (add WASM download step), `build_wasm.ps1` (already copies to public/ for local dev)

### Phase 3: User-visible retry in InitOverlay

**Goal**: When WASM fails to load, let users manually retry instead of requiring a page refresh.

The InitOverlay already has a "Try WebGL2" button for GPU failures. Add:
1. **"Retry" button** in the error state that calls `resetEngine()` + triggers reload
2. **Loading attempt counter** displayed: "Attempt 2 of 3..."
3. **CDN status in error message**: "Engine download failed (CDN unavailable). Retrying from backup..."

**Note**: InitOverlay already has a retry mechanism gated on `canRetry && isTimedOut` — but CDN fetch failures hit the `error` phase, not the timeout path. Fix: extend the retry button to also show when `loadingState.phase === 'error'`.

**Files**: `web/src/components/editor/InitOverlay.tsx`, `web/src/hooks/useEngine.ts` (expose attempt count in LoadingState)

### Phase 4: CDN health monitoring

**Goal**: Detect CDN degradation before users hit it.

1. **Post-deploy smoke test** (`.github/workflows/post-deploy-smoke.yml` already has WASM URL check) — ensure it runs on every deploy
2. **PostHog event on CDN fallback** — track when users hit the same-origin fallback (means CDN was down)
3. **Sentry breadcrumb** on each WASM fetch attempt with URL and status

**Files**: `.github/workflows/post-deploy-smoke.yml`, `web/src/hooks/useEngine.ts`

## Documentation Updates

- Update `.claude/rules/gotchas.md`: add "WASM CDN fallback — same-origin requires both JS glue + WASM from same origin"
- Update `docs/production-support.md`: document the fallback behavior and how to force same-origin in emergencies
- Update `.env.example`: mark `NEXT_PUBLIC_ENGINE_CDN_URL` as optional (same-origin fallback when unset)

## Test Plan

- [ ] Unit test: `fetchWithRetry` retries on 502, fails fast on 404
- [ ] Unit test: `getWasmBasePaths` returns CDN first, same-origin second
- [ ] Unit test: `loadWasm` falls back to same-origin when CDN fails
- [ ] Unit test: InitOverlay shows retry button on error
- [ ] E2E test: Engine loads with `NEXT_PUBLIC_ENGINE_CDN_URL` unset (same-origin path)
- [ ] Manual test: Block `engine.spawnforge.ai` in DevTools, verify fallback works

## Estimated Scope

- **Phase 1**: 2 files, ~30 lines — **30 minutes**
- **Phase 2**: 2 files, ~40 lines — **1 hour**
- **Phase 3**: 2 files, ~50 lines — **1 hour**
- **Phase 4**: 2 files, ~20 lines — **30 minutes**
