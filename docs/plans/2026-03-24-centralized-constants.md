# Plan: Centralized Constants Architecture

> **Status:** IMPLEMENTED
> **Date:** 2026-03-24
> **Scope:** Extract hardcoded magic numbers, provider strings, enum literals, and scope patterns into centralized config modules under `web/src/lib/config/`.

## Problem

The codebase has hundreds of hardcoded numeric literals and string constants scattered across files. Examples from the current codebase:

- **Timeouts**: `45_000` appears in 8+ E2E files, `30_000` in 15+ locations (vitest configs, playwright, hooks, API routes), `60_000` in 20+ locations (playwright, WASM loading, rate limiting, API routes, bridge manager)
- **Provider names**: `'anthropic'`, `'openai'`, `'replicate'` repeated as raw strings in circuit breaker, registry, chat route, analytics, monitoring, sprite generation, and tests
- **Rate limit windows**: `5 * 60 * 1000` appears in 5 API routes, `60_000` as default window in 10+ places, with inconsistent patterns (`5 * 60 * 1000` vs `300_000`)
- **API scopes**: `['scene:read', 'scene:write', 'ai:generate', 'project:manage']` duplicated in `schema.ts` and `api-key/route.ts`
- **PixelArtStyle**: Defined independently in both `pixelArtClient.ts` and `pixelArtHandlers.ts` with identical values
- **AIPanelCategory**: String literal union defined only in `panelRegistry.ts`, validated by string set in tests

When any of these values needs to change, a developer must grep the entire codebase and update every occurrence. This has already caused bugs (the `'anthropic'` provider mapping issue in the embedding capability, where `registry.ts` line 155 mapped embedding to `'openai'` but the circuit breaker type listed `'anthropic'`).

## Solution

Create four config modules in `web/src/lib/config/` as the single source of truth for all domain constants. Existing consumers are updated to import from these modules instead of hardcoding values.

---

## Module 1: `web/src/lib/config/timeouts.ts`

```typescript
/**
 * Centralized timeout and timing constants.
 *
 * Every numeric timeout in the codebase MUST import from this module.
 * Hardcoded timeout literals in source files are flagged by the
 * pre-commit grep check.
 */

// ---------------------------------------------------------------------------
// E2E / Playwright timeouts
// ---------------------------------------------------------------------------

/** Global Playwright test timeout (per test) */
export const E2E_TEST_TIMEOUT_MS = 60_000;

/** Hydration / WASM engine init wait in E2E tests */
export const E2E_HYDRATION_TIMEOUT_MS = 45_000;

/** Element visibility assertion timeout in E2E tests */
export const E2E_VISIBILITY_TIMEOUT_MS = 30_000;

/** Navigation timeout for Playwright page.goto */
export const E2E_NAVIGATION_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Vitest timeouts
// ---------------------------------------------------------------------------

/** Default vitest test timeout across all workspace configs */
export const VITEST_TEST_TIMEOUT_MS = 30_000;

/** Default vitest hook (beforeEach/afterEach) timeout */
export const VITEST_HOOK_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Engine / WASM loading
// ---------------------------------------------------------------------------

/** GPU capability detection timeout (WebGPU requestAdapter) */
export const GPU_INIT_TIMEOUT_MS = 30_000;

/** WASM binary fetch + compile timeout */
export const WASM_FETCH_TIMEOUT_MS = 60_000;

/** Global engine status timeout (covers GPU + WASM + first frame) */
export const ENGINE_GLOBAL_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// API / Server timeouts
// ---------------------------------------------------------------------------

/** Default Vercel function maxDuration for standard API routes (seconds) */
export const API_MAX_DURATION_DEFAULT_S = 10;

/** maxDuration for AI chat streaming route (seconds) */
export const API_MAX_DURATION_CHAT_S = 120;

/** maxDuration for expensive generation routes (3D model, music) (seconds) */
export const API_MAX_DURATION_HEAVY_GEN_S = 180;

/** maxDuration for standard generation routes (sprite, texture, etc.) (seconds) */
export const API_MAX_DURATION_STANDARD_GEN_S = 60;

/** maxDuration for batch operations (voice batch, localization) (seconds) */
export const API_MAX_DURATION_BATCH_S = 120;

/** maxDuration for simple DB operations (refund) (seconds) */
export const API_MAX_DURATION_SIMPLE_S = 10;

/** Health monitor cron route maxDuration (seconds) */
export const API_MAX_DURATION_CRON_S = 30;

/** External API call timeout (e.g., OpenAI, Replicate image generation) */
export const EXTERNAL_API_TIMEOUT_MS = 60_000;

/** Replicate status poll timeout */
export const REPLICATE_STATUS_TIMEOUT_MS = 15_000;

/** WebSocket message timeout (MCP transport) */
export const WEBSOCKET_MESSAGE_TIMEOUT_MS = 30_000;

/** Reaper bridge operation timeout */
export const REAPER_BRIDGE_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Rate limiting windows
// ---------------------------------------------------------------------------

/** Default rate limit window for public routes: 5 minutes */
export const RATE_LIMIT_PUBLIC_WINDOW_MS = 5 * 60 * 1000; // 300_000

/** Default rate limit window for admin/authenticated routes: 1 minute */
export const RATE_LIMIT_ADMIN_WINDOW_MS = 60_000;

/** Default rate limit window for moderation/appeal routes: 10 minutes */
export const RATE_LIMIT_APPEAL_WINDOW_MS = 10 * 60 * 1000; // 600_000

/** Default max requests for public routes per window */
export const RATE_LIMIT_PUBLIC_MAX = 30;

/** Default max requests for admin routes per window */
export const RATE_LIMIT_ADMIN_MAX = 10;

/** Default max requests for play/game routes per window */
export const RATE_LIMIT_PLAY_MAX = 60;

// ---------------------------------------------------------------------------
// Debounce / cooldown intervals
// ---------------------------------------------------------------------------

/** Viewport resize debounce interval */
export const DEBOUNCE_VIEWPORT_MS = 100;

/** Transform auto-save debounce interval */
export const DEBOUNCE_TRANSFORM_AUTOSAVE_MS = 2_000;

/** Onboarding tip cooldown */
export const TIP_COOLDOWN_MS = 30_000;

/** Feature gating error TTL */
export const ERROR_TTL_MS = 30_000;

/** Health endpoint cache TTL */
export const HEALTH_CACHE_TTL_MS = 30_000;

/** Bridge manager cache TTL */
export const BRIDGE_CACHE_TTL_MS = 60_000;

// ---------------------------------------------------------------------------
// Circuit breaker timing
// ---------------------------------------------------------------------------

/** Circuit breaker sliding window duration */
export const CIRCUIT_BREAKER_WINDOW_MS = 5 * 60 * 1000;

/** Time before half-open probe after circuit opens */
export const CIRCUIT_BREAKER_HALF_OPEN_MS = 60_000;

// ---------------------------------------------------------------------------
// Webhook retry timing
// ---------------------------------------------------------------------------

/** Default max delay for exponential backoff in webhook retries */
export const WEBHOOK_RETRY_MAX_DELAY_MS = 60_000;
```

### Migration notes for Module 1

Files that currently define or hardcode these values:

| Current location | Constant | Replace with |
|---|---|---|
| `web/src/hooks/useEngine.ts:18` | `GPU_INIT_TIMEOUT_MS = 30_000` | Re-export from config |
| `web/src/hooks/useEngine.ts:19` | `WASM_FETCH_TIMEOUT_MS = 60_000` | Re-export from config |
| `web/src/hooks/useEngineStatus.ts:18` | `GLOBAL_TIMEOUT = 30_000` | Import `ENGINE_GLOBAL_TIMEOUT_MS` |
| `web/src/hooks/useViewport.ts:9` | `DEBOUNCE_MS = 100` | Import `DEBOUNCE_VIEWPORT_MS` |
| `web/src/hooks/events/transformEvents.ts:12` | `TRANSFORM_DEBOUNCE_MS = 2000` | Import `DEBOUNCE_TRANSFORM_AUTOSAVE_MS` |
| `web/src/hooks/useFeatureGating.ts:76` | `ERROR_TTL_MS = 30_000` | Re-export from config |
| `web/src/app/api/health/route.ts:38` | `CACHE_TTL_MS = 30_000` | Import `HEALTH_CACHE_TTL_MS` |
| `web/src/lib/bridges/bridgeManager.ts:156` | `CACHE_TTL_MS = 60_000` | Import `BRIDGE_CACHE_TTL_MS` |
| `web/src/lib/rateLimit.ts:257` | `windowMs = 5 * 60 * 1000` | Import `RATE_LIMIT_PUBLIC_WINDOW_MS` |
| `web/src/lib/rateLimit.ts:278` | `windowMs = 60_000` | Import `RATE_LIMIT_ADMIN_WINDOW_MS` |
| `web/src/stores/onboardingStore.ts:184` | `30000` | Import `TIP_COOLDOWN_MS` |
| `web/src/lib/providers/circuitBreaker.ts:295` | `windowMs: 5 * 60 * 1000` | Import `CIRCUIT_BREAKER_WINDOW_MS` |
| `web/src/lib/providers/circuitBreaker.ts:299` | `halfOpenAfterMs: 60 * 1000` | Import `CIRCUIT_BREAKER_HALF_OPEN_MS` |
| `web/src/lib/auth/webhookRetry.ts:36` | `maxDelayMs: 60_000` | Import `WEBHOOK_RETRY_MAX_DELAY_MS` |
| `mcp-server/src/transport/websocket.ts:100` | `TIMEOUT_MS = 30000` | Import `WEBSOCKET_MESSAGE_TIMEOUT_MS` |
| `web/e2e/helpers/wait-helpers.ts:73` | `timeout = 45000` | Import `E2E_HYDRATION_TIMEOUT_MS` |
| `web/e2e/helpers/wait-helpers.ts:91` | `timeout = 30000` | Import `E2E_VISIBILITY_TIMEOUT_MS` |
| `web/playwright.config.ts:11,17` | `60_000`, `30_000` | Import E2E constants |
| `web/vitest.config.ts:7-8` (and node/jsdom variants) | `30000` | Import `VITEST_TEST_TIMEOUT_MS` |
| 8 E2E spec files | `{ timeout: 45_000 }` inline | Import `E2E_HYDRATION_TIMEOUT_MS` |

**Important**: `useEngine.ts` currently exports `GPU_INIT_TIMEOUT_MS` and `WASM_FETCH_TIMEOUT_MS` which are imported by tests. These must become re-exports from config to avoid breaking the public API:

```typescript
// web/src/hooks/useEngine.ts — after migration
export { GPU_INIT_TIMEOUT_MS, WASM_FETCH_TIMEOUT_MS } from '@/lib/config/timeouts';
```

---

## Module 2: `web/src/lib/config/providers.ts`

```typescript
/**
 * Centralized AI provider constants.
 *
 * All provider name strings, capability mappings, and backend identifiers
 * MUST be imported from this module. Raw string literals like 'anthropic'
 * or 'openai' in source files are flagged by the pre-commit grep check.
 *
 * Model IDs remain in `@/lib/ai/models.ts` — this module covers provider
 * infrastructure, not model versioning.
 */

// ---------------------------------------------------------------------------
// Provider names (used by circuit breaker, analytics, monitoring)
// ---------------------------------------------------------------------------

/**
 * All known AI provider names that participate in circuit breaking
 * and health monitoring.
 */
export const PROVIDER_NAMES = [
  'anthropic',
  'openai',
  'meshy',
  'elevenlabs',
  'suno',
  'replicate',
  'removebg',
  'openrouter',
  'vercel-gateway',
  'github-models',
] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

// ---------------------------------------------------------------------------
// Backend identifiers
// ---------------------------------------------------------------------------

export const BACKEND_IDS = [
  'direct',
  'vercel-gateway',
  'openrouter',
  'github-models',
  'cloudflare-ai',
  'byok',
] as const;

export type BackendId = (typeof BACKEND_IDS)[number];

// ---------------------------------------------------------------------------
// Provider capabilities
// ---------------------------------------------------------------------------

export const PROVIDER_CAPABILITIES = [
  'chat',
  'embedding',
  'image',
  'model3d',
  'texture',
  'sfx',
  'voice',
  'music',
  'sprite',
  'bg_removal',
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

// ---------------------------------------------------------------------------
// Direct backend: capability -> upstream provider mapping
// ---------------------------------------------------------------------------

/**
 * When routing through the 'direct' backend, this map determines which
 * upstream provider handles each capability. This is the source of truth
 * for `backendIdToProviderName()` in registry.ts.
 */
export const DIRECT_CAPABILITY_PROVIDER: Record<ProviderCapability, ProviderName> = {
  chat: 'anthropic',
  embedding: 'openai',
  model3d: 'meshy',
  texture: 'meshy',
  sfx: 'elevenlabs',
  voice: 'elevenlabs',
  music: 'suno',
  image: 'openai',
  sprite: 'replicate',
  bg_removal: 'removebg',
};

// ---------------------------------------------------------------------------
// Backend -> circuit breaker provider name mapping
// ---------------------------------------------------------------------------

export const BACKEND_TO_PROVIDER: Partial<Record<BackendId, ProviderName>> = {
  'vercel-gateway': 'vercel-gateway',
  'openrouter': 'openrouter',
  'github-models': 'github-models',
};

// ---------------------------------------------------------------------------
// Image generation constraints (per provider)
// ---------------------------------------------------------------------------

export interface ImageSizeConstraint {
  /** Allowed width x height combinations */
  allowedSizes: readonly string[];
  /** Default size if none specified */
  defaultSize: string;
  /** Maximum dimension in pixels */
  maxDimension: number;
}

export const IMAGE_SIZE_CONSTRAINTS: Record<string, ImageSizeConstraint> = {
  'dall-e-3': {
    allowedSizes: ['1024x1024', '1024x1792', '1792x1024'],
    defaultSize: '1024x1024',
    maxDimension: 1792,
  },
  'sdxl': {
    allowedSizes: ['512x512', '768x768', '1024x1024'],
    defaultSize: '1024x1024',
    maxDimension: 1024,
  },
};

// ---------------------------------------------------------------------------
// Sprite generation
// ---------------------------------------------------------------------------

export const SPRITE_PROVIDERS = ['auto', 'dalle3', 'sdxl'] as const;
export type SpriteProvider = (typeof SPRITE_PROVIDERS)[number];

export const SPRITE_SIZES = ['32x32', '64x64', '128x128', '256x256', '512x512', '1024x1024'] as const;
export type SpriteSize = (typeof SPRITE_SIZES)[number];

/** Token costs per sprite generation provider */
export const SPRITE_TOKEN_COST: Record<Exclude<SpriteProvider, 'auto'>, number> = {
  dalle3: 20,
  sdxl: 10,
};

/** Estimated generation time per provider (seconds) */
export const SPRITE_ESTIMATED_SECONDS: Record<Exclude<SpriteProvider, 'auto'>, number> = {
  dalle3: 15,
  sdxl: 30,
};

// ---------------------------------------------------------------------------
// Pixel art generation
// ---------------------------------------------------------------------------

export const PIXEL_ART_STYLES = ['character', 'prop', 'tile', 'icon', 'environment'] as const;
export type PixelArtStyle = (typeof PIXEL_ART_STYLES)[number];

export const PIXEL_ART_SIZES = [16, 32, 64, 128] as const;
export type PixelArtSize = (typeof PIXEL_ART_SIZES)[number];

export const PIXEL_ART_DITHERING_MODES = ['none', 'bayer4x4', 'bayer8x8'] as const;
export type DitheringMode = (typeof PIXEL_ART_DITHERING_MODES)[number];

// ---------------------------------------------------------------------------
// Circuit breaker defaults
// ---------------------------------------------------------------------------

export const CIRCUIT_BREAKER_DEFAULTS = {
  errorRateThreshold: 0.5,
  minRequestsToEvaluate: 3,
  costAnomalyMultiplier: 2,
} as const;
```

### Migration notes for Module 2

| Current location | What to replace | Replace with |
|---|---|---|
| `web/src/lib/providers/types.ts` | `ProviderCapability` type, `BackendId` type | Re-export from config |
| `web/src/lib/providers/circuitBreaker.ts:272-282` | `ProviderName` type | Re-export from config |
| `web/src/lib/providers/circuitBreaker.ts:310-312` | `allProviders` array literal | Import `PROVIDER_NAMES` |
| `web/src/lib/providers/registry.ts:153-164` | `capabilityProviderMap` object | Import `DIRECT_CAPABILITY_PROVIDER` |
| `web/src/lib/providers/registry.ts:168-172` | `map` object in `backendIdToProviderName` | Import `BACKEND_TO_PROVIDER` |
| `web/src/lib/generate/pixelArtClient.ts:5` | `PixelArtStyle` type | Import from config |
| `web/src/lib/chat/handlers/pixelArtHandlers.ts:14` | `VALID_STYLES` array | Import `PIXEL_ART_STYLES` |
| `web/src/lib/chat/handlers/pixelArtHandlers.ts:12` | `VALID_SIZES` | Import `PIXEL_ART_SIZES` |
| `web/src/lib/chat/handlers/pixelArtHandlers.ts:13` | `VALID_DITHERING` | Import `PIXEL_ART_DITHERING_MODES` |
| `web/src/app/api/generate/sprite/route.ts:26-27` | Inline size/provider types | Import from config |
| `web/src/app/api/generate/sprite/route.ts:68-69` | Inline token cost logic | Import `SPRITE_TOKEN_COST` |

**Important**: `types.ts` currently defines `ProviderCapability` and `BackendId` and is imported throughout the provider subsystem. To avoid a massive import rewrite, `types.ts` should re-export from config:

```typescript
// web/src/lib/providers/types.ts — after migration
export type { ProviderCapability, BackendId } from '@/lib/config/providers';
// ... rest of types.ts unchanged
```

---

## Module 3: `web/src/lib/config/scopes.ts`

```typescript
/**
 * API key scope definitions and validation.
 *
 * Single source of truth for all MCP/API key scope strings.
 * Used by:
 *   - DB schema default (`web/src/lib/db/schema.ts`)
 *   - API key creation route (`web/src/app/api/keys/api-key/route.ts`)
 *   - Any future scope-checking middleware
 */

// ---------------------------------------------------------------------------
// Scope definitions
// ---------------------------------------------------------------------------

/**
 * Valid scope domains (the part before the colon).
 */
export const SCOPE_DOMAINS = ['scene', 'ai', 'project'] as const;
export type ScopeDomain = (typeof SCOPE_DOMAINS)[number];

/**
 * Valid scope verbs per domain.
 */
export const SCOPE_VERBS: Record<ScopeDomain, readonly string[]> = {
  scene: ['read', 'write'],
  ai: ['generate'],
  project: ['manage'],
};

/**
 * All valid API key scopes. This is the canonical list.
 */
export const API_KEY_SCOPES = [
  'scene:read',
  'scene:write',
  'ai:generate',
  'project:manage',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/**
 * Default scopes assigned to new API keys.
 * Currently all scopes — restrict as needed.
 */
export const DEFAULT_API_KEY_SCOPES: readonly ApiKeyScope[] = API_KEY_SCOPES;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Regex pattern for a valid scope string: `domain:verb` */
export const SCOPE_PATTERN = /^[a-z]+:[a-z_]+$/;

/** Set for O(1) lookup */
const VALID_SCOPE_SET = new Set<string>(API_KEY_SCOPES);

/**
 * Check whether a string is a valid API key scope.
 *
 * @param s - The string to validate
 * @returns True if `s` is a recognized scope
 */
export function isValidScope(s: string): s is ApiKeyScope {
  return VALID_SCOPE_SET.has(s);
}

/**
 * Build a scope string from domain and verb parts.
 * Returns the scope if valid, throws if the combination is not recognized.
 *
 * @example
 * ```ts
 * const s = scope('ai', 'generate'); // 'ai:generate'
 * ```
 */
export function scope(domain: ScopeDomain, verb: string): ApiKeyScope {
  const candidate = `${domain}:${verb}`;
  if (!isValidScope(candidate)) {
    throw new Error(
      `Invalid scope "${candidate}". Valid scopes: ${API_KEY_SCOPES.join(', ')}`
    );
  }
  return candidate;
}

/**
 * Validate an array of scope strings. Returns the invalid entries.
 *
 * @param scopes - Array of strings to check
 * @returns Array of strings that are NOT valid scopes (empty if all valid)
 */
export function findInvalidScopes(scopes: readonly string[]): string[] {
  return scopes.filter((s) => !isValidScope(s));
}
```

### Migration notes for Module 3

| Current location | What to replace | Replace with |
|---|---|---|
| `web/src/lib/db/schema.ts:77` | `.default(['scene:read', 'scene:write', 'ai:generate', 'project:manage'])` | `.default([...DEFAULT_API_KEY_SCOPES])` |
| `web/src/lib/db/schema.ts:622` | `ApiKeyScope` type definition | Re-export from config |
| `web/src/app/api/keys/api-key/route.ts:12` | `VALID_SCOPES` array | Import `API_KEY_SCOPES` |
| `web/src/app/api/keys/api-key/route.ts:32` | `scopes.filter(...)` validation | Import `findInvalidScopes` |

**Note**: The DB schema currently defines `ApiKeyScope` as a type alias. After migration, `schema.ts` should import and re-export it from config so downstream consumers are unaffected.

---

## Module 4: `web/src/lib/config/enums.ts`

```typescript
/**
 * Centralized enum-like constant objects.
 *
 * These are NOT TypeScript enums (which are problematic for tree-shaking).
 * Instead they use `as const` objects with derived union types.
 */

// ---------------------------------------------------------------------------
// AI Panel Categories
// ---------------------------------------------------------------------------

/**
 * Categories for grouping AI panels in the AI Studio sidebar.
 * Source of truth for `AIPanelCategory` used by panelRegistry.
 */
export const AI_PANEL_CATEGORIES = ['creation', 'polish', 'intelligence', 'tools'] as const;
export type AIPanelCategory = (typeof AI_PANEL_CATEGORIES)[number];

/** Set for O(1) validation */
export const AI_PANEL_CATEGORY_SET = new Set<string>(AI_PANEL_CATEGORIES);

// ---------------------------------------------------------------------------
// GDD Scope
// ---------------------------------------------------------------------------

/**
 * Valid game design document scope levels.
 * Used by `gddGenerator.ts` for scope validation.
 */
export const GDD_SCOPES = ['small', 'medium', 'large'] as const;
export type GddScope = (typeof GDD_SCOPES)[number];

/** Set for O(1) validation */
export const GDD_SCOPE_SET = new Set<string>(GDD_SCOPES);

// ---------------------------------------------------------------------------
// Pixel Art Palettes (IDs only — full palette data stays in pixelArtHandlers)
// ---------------------------------------------------------------------------

/**
 * Valid palette IDs for pixel art generation.
 * The actual color arrays remain in the handler module; this array
 * is for validation in shared code.
 */
export const PIXEL_ART_PALETTE_IDS = [
  'gameboy',
  'nes',
  'snes',
  'cga',
  'pico8',
  'endesga32',
  'lospec500',
] as const;

export type PixelArtPaletteId = (typeof PIXEL_ART_PALETTE_IDS)[number];
```

### Migration notes for Module 4

| Current location | What to replace | Replace with |
|---|---|---|
| `web/src/lib/workspace/panelRegistry.ts:7` | `AIPanelCategory` type | Import from config/enums |
| `web/src/lib/workspace/__tests__/panelRegistry.test.ts:85` | Inline `Set(['creation', ...])` | Import `AI_PANEL_CATEGORY_SET` |
| `web/src/lib/ai/gddGenerator.ts:53` | `VALID_SCOPES: ReadonlySet<string>` | Import `GDD_SCOPE_SET` |

---

## Module 5: Barrel export — `web/src/lib/config/index.ts`

```typescript
/**
 * Config barrel — re-exports all config modules for convenience.
 *
 * Prefer direct imports from specific modules for tree-shaking:
 *   import { GPU_INIT_TIMEOUT_MS } from '@/lib/config/timeouts';
 *
 * Use the barrel only when importing from multiple config modules:
 *   import { GPU_INIT_TIMEOUT_MS, PROVIDER_NAMES } from '@/lib/config';
 */

export * from './timeouts';
export * from './providers';
export * from './scopes';
export * from './enums';
```

---

## ESLint Rule Concept: `no-magic-timeouts`

### What it checks

Flag numeric literals that match known timeout/timing patterns when used as arguments to timing-related functions or assigned to timeout-named variables.

### Patterns to flag

1. **Numeric literals >= 1000 in timeout-like positions:**
   - Arguments to `setTimeout`, `setInterval`, `AbortSignal.timeout`
   - Property values in objects with keys matching `timeout`, `window`, `delay`, `ttl`, `cooldown`, `duration`
   - Default parameter values for parameters named `*timeout*`, `*window*`, `*delay*`

2. **Numeric literals in `{ timeout: NNNN }` object patterns:**
   - Especially in Playwright: `toBeVisible({ timeout: 45_000 })`, `page.goto(url, { timeout: 60_000 })`
   - In vitest config: `testTimeout`, `hookTimeout`

3. **Raw provider name strings in non-test files:**
   - `'anthropic'`, `'openai'`, `'replicate'`, `'meshy'`, `'elevenlabs'`, `'suno'`, `'removebg'` as standalone string literals
   - Exclude: import paths, error message strings, log messages, comments

### Directory scoping

| Pattern | Scope |
|---|---|
| Timeout literals | `web/src/**/*.ts` (not test files) |
| Timeout literals in E2E | `web/e2e/**/*.ts` |
| Provider name strings | `web/src/lib/**/*.ts`, `web/src/app/api/**/*.ts` (exclude `__tests__/`) |

### Example violations and fixes

```typescript
// VIOLATION: magic timeout in E2E
await expect(locator).toBeVisible({ timeout: 45_000 });
// FIX:
import { E2E_HYDRATION_TIMEOUT_MS } from '@/lib/config/timeouts';
await expect(locator).toBeVisible({ timeout: E2E_HYDRATION_TIMEOUT_MS });

// VIOLATION: magic timeout in hook
const DEBOUNCE_MS = 100;
// FIX:
import { DEBOUNCE_VIEWPORT_MS } from '@/lib/config/timeouts';

// VIOLATION: raw provider string in production code
const capabilityProviderMap = { chat: 'anthropic', embedding: 'openai' };
// FIX:
import { DIRECT_CAPABILITY_PROVIDER } from '@/lib/config/providers';

// OK — not flagged (test file):
expect(getDirectProviderKey('anthropic')).toBe('sk-ant-123');

// OK — not flagged (part of error message):
throw new Error(`Anthropic API error ${response.status}`);
```

### Implementation note

This would be a custom ESLint rule in `web/eslint-rules/no-magic-timeouts.js` (local plugin). It is NOT worth building as a published package — it is specific to this codebase. The rule can start as a warning and be promoted to error once all existing violations are cleaned up.

---

## Pre-Commit Hook Enhancement

Add to the existing `web/scripts/pre-push-quality-gate.sh` (or create a companion `scripts/check-magic-constants.sh` that the hook calls):

### Grep patterns for hardcoded values

```bash
#!/usr/bin/env bash
# check-magic-constants.sh — Detect common hardcoded constants that should use centralized config
set -euo pipefail

ERRORS=0
ROOT="$(git rev-parse --show-toplevel)"

# ---------------------------------------------------------------------------
# 1. Timeout literals in production code (not test files, not config module)
# ---------------------------------------------------------------------------
echo "Checking for hardcoded timeout literals..."

# Pattern: bare numeric literals that are common timeout values
# Excludes: config/timeouts.ts itself, test files, node_modules, .next
TIMEOUT_HITS=$(grep -rn --include="*.ts" --include="*.tsx" \
  -E '(timeout|Timeout|TIMEOUT|window[Mm]s|delay|ttl|cooldown)\s*[:=]\s*[0-9][0-9_]*[0-9]' \
  "$ROOT/web/src" "$ROOT/web/e2e" \
  --exclude-dir=node_modules --exclude-dir=.next \
  | grep -v 'config/timeouts' \
  | grep -v '__tests__/' \
  | grep -v '\.test\.' \
  | grep -v '\.spec\.' \
  | grep -v '// allowed-magic-constant' \
  || true)

if [ -n "$TIMEOUT_HITS" ]; then
  echo "WARNING: Found hardcoded timeout values (should import from @/lib/config/timeouts):"
  echo "$TIMEOUT_HITS"
  # Start as warning, not error — flip to ERRORS=$((ERRORS+1)) once migration is complete
fi

# ---------------------------------------------------------------------------
# 2. Raw provider name strings in production code
# ---------------------------------------------------------------------------
echo "Checking for hardcoded provider name strings..."

PROVIDER_HITS=$(grep -rn --include="*.ts" --include="*.tsx" \
  -E "'\b(anthropic|openai|meshy|elevenlabs|suno|replicate|removebg)\b'" \
  "$ROOT/web/src/lib" "$ROOT/web/src/app/api" \
  --exclude-dir=node_modules --exclude-dir=.next \
  | grep -v 'config/providers' \
  | grep -v '__tests__/' \
  | grep -v '\.test\.' \
  | grep -v '// allowed-magic-constant' \
  | grep -v 'Error\|error\|Error(' \
  | grep -v 'import ' \
  || true)

if [ -n "$PROVIDER_HITS" ]; then
  echo "WARNING: Found hardcoded provider names (should import from @/lib/config/providers):"
  echo "$PROVIDER_HITS"
fi

# ---------------------------------------------------------------------------
# 3. Duplicated scope arrays
# ---------------------------------------------------------------------------
echo "Checking for hardcoded scope arrays..."

SCOPE_HITS=$(grep -rn --include="*.ts" \
  -E "'scene:read'|'scene:write'|'ai:generate'|'project:manage'" \
  "$ROOT/web/src" \
  --exclude-dir=node_modules --exclude-dir=.next \
  | grep -v 'config/scopes' \
  | grep -v '__tests__/' \
  | grep -v '\.test\.' \
  | grep -v '// allowed-magic-constant' \
  || true)

if [ -n "$SCOPE_HITS" ]; then
  echo "WARNING: Found hardcoded scope strings (should import from @/lib/config/scopes):"
  echo "$SCOPE_HITS"
fi

echo "Magic constant check complete."
exit $ERRORS
```

### Allowlist mechanism

Any line that genuinely needs a raw constant (rare) can add the comment `// allowed-magic-constant` to suppress the grep. This is intentionally friction-ful — it forces developers to justify each exception.

### Integration with existing hooks

The check should be called from the existing pre-push quality gate:

```bash
# In web/scripts/pre-push-quality-gate.sh, add after lint check:
echo "--- Magic constant check ---"
bash "$ROOT/web/scripts/check-magic-constants.sh"
```

Start as **warnings only** (exit 0 regardless). After the builder agent completes the migration and all violations are resolved, flip to exit 1 on findings.

---

## Implementation Order

A builder agent should execute this in the following order:

1. **Create the four config modules** (`timeouts.ts`, `providers.ts`, `scopes.ts`, `enums.ts`, `index.ts`)
2. **Add tests** for each module (especially `scopes.ts` which has logic)
3. **Migrate `timeouts.ts` consumers** — start with hooks (highest impact, fewest files), then E2E, then API routes
4. **Migrate `providers.ts` consumers** — start with `types.ts` re-export, then circuit breaker, then registry
5. **Migrate `scopes.ts` consumers** — schema.ts and api-key route (only 2 files)
6. **Migrate `enums.ts` consumers** — panelRegistry and gddGenerator (only 2-3 files)
7. **Add `check-magic-constants.sh`** and wire into pre-push hook as warnings
8. **Run full test suite** to verify no regressions

### Files created (new)

- `web/src/lib/config/timeouts.ts`
- `web/src/lib/config/providers.ts`
- `web/src/lib/config/scopes.ts`
- `web/src/lib/config/enums.ts`
- `web/src/lib/config/index.ts`
- `web/src/lib/config/__tests__/timeouts.test.ts`
- `web/src/lib/config/__tests__/providers.test.ts`
- `web/src/lib/config/__tests__/scopes.test.ts`
- `web/src/lib/config/__tests__/enums.test.ts`
- `web/scripts/check-magic-constants.sh`

### Files modified (existing)

Approximately 35-40 files across:
- 8 E2E spec/helper files (timeout imports)
- 3 vitest config files (timeout imports)
- 1 playwright config (timeout imports)
- 6 hooks (timeout re-exports/imports)
- 5 API routes (rate limit constant imports)
- 4 provider modules (type re-exports, constant imports)
- 2 generator modules (pixel art, GDD enum imports)
- 2 scope-related files (schema, api-key route)
- 2 panel-related files (panelRegistry, test)
- 1 pre-push hook (wire new check)

### What NOT to migrate

- **`maxDuration` exports in API routes** — These are Next.js convention (`export const maxDuration = N`). Moving them to a central config would break the co-location pattern Next.js expects. Keep them as-is but document the canonical values in `timeouts.ts` as comments.
- **Test files** — Hardcoded values in test assertions are acceptable (they verify the config values).
- **`models.ts`** — Already centralized. Leave it as the source of truth for model IDs.
- **Error message strings containing provider names** — These are human-readable, not programmatic constants.

---

## Constraints

- All config modules must be pure TypeScript with zero runtime dependencies (no React, no Next.js, no Node.js APIs) so they can be imported from any environment (server, client, E2E, vitest)
- No circular imports — config modules must NOT import from `lib/providers/`, `lib/ai/`, or any consumer module
- Tree-shaking: use `as const` objects and named exports, not default exports or classes
- The existing `validateEnv.ts` in `web/src/lib/config/` remains unchanged — it serves a different purpose (runtime environment validation)
