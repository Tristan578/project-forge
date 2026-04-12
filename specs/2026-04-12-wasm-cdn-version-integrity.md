# Spec: WASM CDN Version Integrity

> **Status:** DRAFT — Awaiting Approval
> **Date:** 2026-04-12
> **Scope:** Prevent JS glue ↔ WASM binary version mismatch from stale CDN cache
> **Ticket:** #8211

## Problem

When a new WASM build is deployed, a race exists between the CDN-cached JS glue (`forge_engine.js`) and the WASM binary (`forge_engine_bg.wasm`). The current `wasm-manifest.json` only hashes the WASM binary — there is no mechanism to detect that the JS glue file is from a different build. Three crash scenarios exist:

1. **Old JS glue + new WASM binary**: Browser imports cached `forge_engine.js` (which references old exports) but fetches a new `forge_engine_bg.wasm` via cache-busted `?v=<hash>`. The glue calls functions that no longer exist in the binary, producing `TypeError: wasm.xxx is not a function`.

2. **CDN partial failure → split-origin load**: CDN serves JS glue successfully but times out on the WASM binary. The fallback loop currently loads the WASM from same-origin, but the JS glue (already evaluated from CDN) contains relative import paths that break across origins.

3. **Empty same-origin fallback**: The CD pipeline does not copy WASM artifacts into `web/public/` before deploying to Vercel, so same-origin paths 404 in production — the entire fallback tier is dead.

The existing Vercel Skew Protection covers framework assets but explicitly does **not** cover imperatively-loaded WASM binaries (documented in `docs/production-support.md:772`).

## Solution

Three changes, ordered by risk reduction:

### Phase 1: Version integrity in wasm-manifest.json (build + client)

**Build script changes (`build_wasm.sh` lines 73–89):**

Extend `wasm-manifest.json` to include a hash of the JS glue file and a `buildId` that ties both files together:

```json
{
  "wasmFile": "forge_engine_bg.wasm",
  "jsFile": "forge_engine.js",
  "wasmHash": "a1b2c3d4e5f67890",
  "jsHash": "f0e1d2c3b4a59876",
  "buildId": "a1b2c3d4f0e1d2c3"
}
```

- `wasmHash`: SHA-256 first 16 hex of WASM binary (existing, renamed from `hash`)
- `jsHash`: SHA-256 first 16 hex of JS glue file (new)
- `buildId`: XOR of `wasmHash` and `jsHash` (new) — a single value that changes when either file changes
- Backward compat: client reads `hash` as fallback if `wasmHash` is absent

**Client changes (`useEngine.ts`):**

In `loadWasmFromPath()`, after fetching `wasm-manifest.json`, compute the expected `buildId` from `wasmHash` XOR `jsHash`. Then:

1. Append `?v=<buildId>` to **both** JS glue and WASM URLs (not just WASM)
2. If the manifest has a `buildId`, store it in a module-scoped variable
3. After WASM init succeeds, check the module's exported `build_id()` function (see Rust changes) against the manifest's `buildId`
4. On mismatch: log a Sentry breadcrumb, skip CDN for this session, retry from next path in the fallback list

**Why `buildId` instead of just two hashes:** A single compound value simplifies the cache-bust query param and gives the client one comparison instead of two.

### Phase 2: Populate same-origin fallback in CD pipeline

**CD pipeline changes (`.github/workflows/cd.yml`):**

Add a step in `deploy-staging` and `deploy-production` jobs, between artifact download and `vercel deploy`, that copies WASM artifacts into `web/public/`:

```yaml
- name: Populate same-origin WASM fallback
  run: |
    for variant in engine-pkg-webgl2 engine-pkg-webgpu engine-pkg-webgl2-runtime engine-pkg-webgpu-runtime; do
      mkdir -p "web/public/${variant}"
      if [ -d "engine/pkg-${variant#engine-pkg-}" ]; then
        cp "engine/pkg-${variant#engine-pkg-}/"* "web/public/${variant}/"
      fi
    done
```

This ensures `/engine-pkg-*/` paths resolve via Vercel's static file serving when the CDN is down.

**Also regenerate manifests** in the CI step (since `build_wasm.sh` ran on a different runner):

```yaml
- name: Generate WASM manifests for same-origin
  run: bash scripts/generate-wasm-manifests.sh web/public
```

Extract the manifest generation loop from `build_wasm.sh` lines 73–89 into a standalone `scripts/generate-wasm-manifests.sh` that accepts a base directory argument. Both `build_wasm.sh` and the CD pipeline call it.

### Phase 3: CDN fallback monitoring

**Sentry breadcrumbs (already partially implemented):**

The `tryLoadFromPaths()` loop at `useEngine.ts:418-420` already adds a breadcrumb and tracks a PostHog event on CDN failure. Extend this:

1. **Add `setTag('wasm.source', origin)` after successful load** — either `'cdn'` or `'same-origin'`. This tag is searchable in Sentry and lets us alert on same-origin fallback spikes.
2. **Add `setTag('wasm.buildId', buildId)` after successful load** — ties Sentry errors to the exact WASM build.
3. **Breadcrumb on version mismatch** — if the buildId check (Phase 1) detects a mismatch, log `{ category: 'wasm', message: 'Version mismatch detected, retrying', level: 'error', data: { expected, actual } }` before falling back.

### Rust Changes (engine/)

None required. The `buildId` validation uses manifest-only comparison (JS-side). A Rust-exported `build_id()` function would require `wasm-bindgen` changes and a rebuild — unnecessary since the manifest already couples the two files.

### Web Changes Summary

| File | Change |
|------|--------|
| `build_wasm.sh` | Add `jsHash` and `buildId` to manifest generation |
| `scripts/generate-wasm-manifests.sh` | New — extracted manifest generation script |
| `web/src/hooks/useEngine.ts` | Read extended manifest, add `?v=buildId` to JS URL, add Sentry tags on load |
| `web/src/lib/monitoring/cdnAnalytics.ts` | No changes needed (retry logic unchanged) |
| `.github/workflows/cd.yml` | Add same-origin fallback population step + manifest generation |

### MCP Changes

None — this is infrastructure, not a user-facing command.

### Test Plan

**Unit tests (`web/src/hooks/__tests__/useEngine.test.ts`):**
- `fetchWasmManifest` returns extended manifest fields (`wasmHash`, `jsHash`, `buildId`)
- `fetchWasmManifest` falls back to legacy `hash` field when `wasmHash` is absent
- `getWasmBasePaths` returns CDN + same-origin when CDN configured
- `getWasmBasePaths` returns only same-origin when CDN not configured

**Build script tests (`scripts/generate-wasm-manifests.test.sh` or inline in CI):**
- Manifest contains all 4 fields (`wasmFile`, `jsFile`, `wasmHash`, `jsHash`, `buildId`)
- `buildId` changes when either file changes
- `buildId` is deterministic (same inputs → same output)

**Integration test (manual, post-deploy):**
- Deploy to staging with `NEXT_PUBLIC_ENGINE_CDN_URL` set
- Verify `wasm-manifest.json` is accessible at both CDN and same-origin paths
- Verify Sentry receives `wasm.source` and `wasm.buildId` tags on editor load
- Simulate CDN failure (unset `NEXT_PUBLIC_ENGINE_CDN_URL`) and verify same-origin loads succeed

## Acceptance Criteria

- Given a fresh deployment, when the editor loads, then both JS glue and WASM binary URLs include `?v=<buildId>` cache-bust params
- Given a stale CDN cache serving old JS glue, when the manifest `buildId` doesn't match the loaded module, then the client falls back to same-origin and logs a Sentry breadcrumb
- Given CDN is unreachable, when the editor loads, then WASM loads from same-origin (`/engine-pkg-*/`) without error
- Given a deployment, when checking `web/public/engine-pkg-*/`, then all 4 variant directories contain `forge_engine.js`, `forge_engine_bg.wasm`, and `wasm-manifest.json`
- Given any editor load, when checking Sentry, then `wasm.source` and `wasm.buildId` tags are present on the event scope

## Constraints

- `wasm-manifest.json` format change must be backward-compatible (client must handle legacy manifests with only `hash` field)
- JS glue `import()` does not support query params in all bundlers — use dynamic URL construction, not static import paths
- Same-origin WASM files add ~20-40MB to Vercel deployment size (4 variants × 5-10MB each) — within Vercel's 250MB limit
- `shasum -a 256` must be available on both macOS (local) and Ubuntu (CI) — it is on both

## Implementation Order

1. Extract `generate-wasm-manifests.sh` from `build_wasm.sh` (no behavior change)
2. Extend manifest format with `jsHash` and `buildId`
3. Update `useEngine.ts` to read extended manifest and add Sentry tags
4. Add CD pipeline steps for same-origin fallback population
5. Add/update unit tests
6. Manual staging verification
