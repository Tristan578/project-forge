# Test Overhaul Spec — SpawnForge

**Date:** 2026-03-02
**Status:** Approved
**Approach:** Risk-First Tiers (B)

## Problem Statement

SpawnForge reports 4,985 tests across 190 files, but real coverage is critically weak:

- **137+ placeholder tests** assert `expect(true).toBe(true)` or `expect('string').toBe('string')` — exercising zero application code
- **72 API route handlers** have zero test coverage — including Stripe webhooks, billing, auth, and publishing
- **36 duplicate test files** across deprecated and current directories inflate counts
- **170+ arbitrary `waitForTimeout()` calls** in E2E make the suite brittle
- **Coverage thresholds at 20/15/15/20** are meaningless gates
- **25+ completed features** have zero E2E coverage
- **~4 of 29 component test files** actually render components

The test suite creates a false sense of safety. A failing payment webhook, a broken auth flow, or a security bypass would ship undetected.

## Design Principles

1. **Tests must exercise application code.** If a test file doesn't import from `src/`, it's not a test.
2. **No literal assertions.** `expect(true).toBe(true)` is banned. Every assertion must depend on code behavior.
3. **API route tests call the actual handler.** Mock DB and auth layers, but the handler function runs.
4. **E2E tests assert on behavior.** Checking panel visibility is a smoke test. Feature tests verify workflows produce correct outcomes.
5. **No arbitrary timeouts.** Use Playwright's `waitForSelector`, `waitForFunction`, `expect().toBeVisible()`, or `page.waitForResponse()`.
6. **Coverage thresholds are ratcheted up** — they only increase, never decrease.
7. **Duplicate test files are consolidated** — one canonical location per test.

## Architecture

### Unit Test Structure (Vitest)

```
web/src/
├── app/api/**/__tests__/       ← API route handler tests (NEW)
├── components/editor/__tests__/ ← Component render tests (REWRITTEN)
├── hooks/events/__tests__/      ← Event handler tests (EXISTS, expand)
├── lib/**/__tests__/            ← Library unit tests (EXISTS, expand)
├── stores/slices/__tests__/     ← Store slice tests (EXISTS, strong)
└── test/
    ├── fixtures.ts              ← Entity/data factories (EXISTS)
    ├── apiTestUtils.ts          ← API route test helpers (NEW)
    └── componentTestUtils.ts    ← Component render helpers (NEW)
```

### E2E Test Structure (Playwright)

```
web/e2e/
├── fixtures/
│   └── editor-page.ts          ← Page Object Model (EXISTS)
├── helpers/
│   └── wait-helpers.ts         ← Condition-based wait utilities (NEW)
├── tests/
│   ├── smoke.spec.ts           ← Existing (KEEP)
│   ├── entity-crud.spec.ts     ← Existing (KEEP, expand)
│   ├── ...                     ← Existing specs (UPGRADE — remove waitForTimeout)
│   ├── billing-flow.spec.ts    ← NEW
│   ├── publish-e2e.spec.ts     ← NEW (upgrade from stub)
│   ├── scripting-exec.spec.ts  ← NEW
│   ├── ui-builder.spec.ts      ← NEW
│   ├── particles.spec.ts       ← NEW
│   └── ...
```

### API Route Test Pattern

```typescript
// web/src/app/api/billing/checkout/__tests__/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { POST } from '../route';

// Mock external deps at boundary
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ db: mockDb }));

describe('POST /api/billing/checkout', () => {
  it('returns 401 when not authenticated', async () => {
    mockAuth({ userId: null });
    const req = new Request('http://localhost/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ tier: 'creator' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('creates Stripe checkout session for valid tier upgrade', async () => {
    mockAuth({ userId: 'clerk_123' });
    mockUser({ tier: 'starter' });
    const req = new Request('http://localhost/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ tier: 'creator' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain('checkout.stripe.com');
  });
});
```

### Component Test Pattern (Replacing Placeholders)

```typescript
// web/src/components/editor/__tests__/AudioMixerPanel.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AudioMixerPanel } from '../AudioMixerPanel';

// Provide required store/context
const wrapper = createTestWrapper({ initialState: mockAudioState });

describe('AudioMixerPanel', () => {
  it('renders master bus with volume slider', () => {
    render(<AudioMixerPanel />, { wrapper });
    expect(screen.getByRole('slider', { name: /master/i })).toBeInTheDocument();
  });

  it('mutes bus when mute button clicked', async () => {
    render(<AudioMixerPanel />, { wrapper });
    const muteBtn = screen.getByRole('button', { name: /mute master/i });
    await fireEvent.click(muteBtn);
    expect(screen.getByRole('slider', { name: /master/i })).toHaveAttribute('aria-disabled', 'true');
  });
});
```

### E2E Wait Pattern (Replacing waitForTimeout)

```typescript
// BEFORE (flaky):
await page.waitForTimeout(500);
await expect(page.locator('.inspector')).toBeVisible();

// AFTER (resilient):
await expect(page.locator('.inspector')).toBeVisible({ timeout: 5000 });

// For store state:
await page.waitForFunction(() => {
  const state = window.__STORE__?.getState();
  return state?.selectedIds?.length > 0;
}, { timeout: 5000 });

// For network:
await page.waitForResponse(resp =>
  resp.url().includes('/api/projects') && resp.status() === 200
);
```

## Tier Breakdown

### Tier 0 — Infrastructure (Foundation)

**Goal:** Clean the rot. Every subsequent tier depends on this.

| Work Item | Details |
|-----------|---------|
| Delete duplicate test files | Remove 36 duplicates. Canonical locations: `stores/slices/__tests__/`, `lib/<domain>/__tests__/` |
| Delete/rewrite placeholder ARIA tests | 8 files, ~137 fake assertions. Either rewrite with real component rendering or delete entirely. |
| Create `apiTestUtils.ts` | Request builder, mock auth/DB helpers, response assertion helpers for route handler testing |
| Create `componentTestUtils.ts` | `createTestWrapper()` with store providers, mock engine context, render helpers |
| Create `wait-helpers.ts` for E2E | `waitForStoreState()`, `waitForEntitySpawn()`, `waitForPanelLoad()` — condition-based replacements for `waitForTimeout()` |
| Eliminate all `waitForTimeout()` from E2E | Replace 170+ instances across 25 spec files with condition-based waits |
| Add Playwright retry: 2 in CI | Prevents transient failures from killing the suite |
| Raise coverage thresholds to 40/30/35/40 | Enforced in CI — no regression allowed |
| Add test quality lint rule | Custom ESLint rule or vitest plugin that fails on `expect(true).toBe(true)` patterns |
| Vitest config: include `.test.tsx` | Currently only includes `.test.ts` — component tests need `.tsx` |

**Exit Criteria:**
- Zero duplicate test files
- Zero placeholder assertions in the codebase
- Zero `waitForTimeout()` calls in E2E specs
- Coverage thresholds enforced at 40/30/35/40
- All existing tests still pass

### Tier 1 — Money & Security

**Goal:** Test every code path that handles money, credentials, or access control.

| Work Item | Details |
|-----------|---------|
| Stripe webhook route tests | `POST /api/stripe/webhook` — signature verification, subscription created/updated/deleted, payment failed, idempotency |
| Billing checkout route tests | `POST /api/billing/checkout` — auth, tier validation, Stripe session creation, error handling |
| Billing portal route tests | `POST /api/billing/portal` — auth, portal URL generation |
| Billing status route tests | `GET /api/billing/status` — subscription state, tier mapping |
| Auth webhook route tests | `POST /api/auth/webhook` — Clerk webhook signature, user.created/updated/deleted events, DB sync |
| Token balance/purchase/usage tests | 3 routes — balance lookup, purchase flow, usage tracking |
| Key management route tests | `GET/POST/DELETE /api/keys/*` — CRUD, encryption round-trip, provider validation |
| Publishing route tests | `POST /api/publish`, `GET /api/publish/check-slug`, `GET /api/publish/list` — slug validation, tier limits, asset packaging |
| User profile/delete route tests | `GET/DELETE /api/user/*` — profile read, account deletion cascade |
| Admin route tests | 4 admin routes — economics, config, featured, moderation — with admin auth assertion |
| BYOK key resolver tests | `lib/keys/resolver.ts` — currently 0% coverage. Key lookup, decryption, provider routing |
| Content filter tests (expand) | Currently 83% — cover edge cases, prompt injection patterns, bypass attempts |
| CSP header validation E2E | Verify Content-Security-Policy headers are present and correct on page load |
| Auth flow E2E | Full sign-in → session → API call → sign-out flow (mocked Clerk in E2E) |

**Exit Criteria:**
- 100% statement coverage on all billing/payment routes
- 100% statement coverage on auth webhook and key management
- 90%+ on publishing and admin routes
- Coverage thresholds raised to 55/45/50/55

### Tier 2 — Core UX Flows

**Goal:** Every feature a user touches has functional E2E and deep unit tests.

| Work Item | Details |
|-----------|---------|
| Entity CRUD E2E depth | Expand beyond spawn/delete — test reparenting, multi-select, rename, visibility toggle, undo/redo chains |
| Material workflow E2E | Apply material → change properties → verify inspector state → undo → verify revert |
| Script execution E2E | Write script → run in play mode → verify console output → stop → verify state restored |
| Scene management E2E | Create scene → rename → duplicate → switch → delete → verify no data bleed |
| Export pipeline E2E | Configure export → trigger → verify download blob content structure |
| Animation workflow E2E | Create clip → add keyframes → play → verify timeline state |
| Physics simulation E2E | Add physics → play → verify entity moves → stop → verify position restored |
| Chat command depth E2E | Complex multi-step commands — "create a scene with 3 entities and a light" |
| Component render tests | Rewrite 8 ARIA test files as real render tests: InspectorPanel, AudioMixer, SceneHierarchy, DrawerPanel, AddEntityMenu, etc. |
| chatStore unit tests | Currently 17% — cover message add/remove, token tracking, right panel tab, AI response handling |
| userStore unit tests | Currently 25% — cover tier state, permissions, token balance, profile updates |
| Chat handler tests (remaining 14) | asset, audio, dialogue, entity, game, particle, physics, procedural, scene, script, sprite, ui, query expansion, helpers |
| Root hook tests | useEngine (WASM loading states), useEngineEvents (event delegation), useResponsiveLayout (breakpoints) |
| scriptWorker tests (expand) | Currently 33% — cover message handling, sandbox eval, forge API proxy, error recovery |
| WGSL compiler tests (expand) | Currently 67% — cover error cases, all shader types, validation |

**Exit Criteria:**
- Every core editor workflow has a functional E2E spec (not just panel visibility)
- Component tests render actual components and assert on DOM
- chatStore and userStore at 80%+
- All 23 chat handlers tested
- Coverage thresholds raised to 70/60/65/70

### Tier 3 — Feature Completeness

**Goal:** Full coverage across every shipped feature.

| Work Item | Details |
|-----------|---------|
| AI generation client tests | elevenlabsClient, meshyClient, spriteClient, sunoClient — mock HTTP, test request building, response parsing, error handling |
| AI generation route tests | 17 generate/* routes — request validation, provider dispatch, status polling, refund logic |
| Community route tests | 9 community/* routes — CRUD, flagging, rating, pagination |
| Marketplace route tests | 11 marketplace/* routes — listing, purchase, download, seller management |
| Job queue route tests | 2 jobs/* routes — list, status |
| Feedback/health/docs routes | 3 simple routes — basic coverage |
| In-Game UI Builder E2E | Widget creation → placement → data binding → play-mode render |
| Visual scripting E2E | Node graph creation → compilation → execution → verify output |
| Dialogue system E2E | Tree creation → branching → runtime display → choice selection |
| Particle system E2E | Create particles → configure → play → verify (WebGL2 mode) |
| Game camera E2E | Switch camera modes → verify behavior in play mode |
| Physics joints E2E | Create joint → configure limits → play → verify constraint |
| Game templates E2E | Select template → instantiate → verify entities spawned correctly |
| Scene transitions E2E | Configure transition → trigger scene switch → verify overlay animation |
| Procedural systems E2E | CSG boolean, terrain generation, extrude/lathe — verify mesh output |
| 2D subsystem E2E | Sprite creation, tilemap editing, 2D physics — verify 2D-specific workflows |
| Advanced audio E2E | Bus routing, reverb zones, spatial audio positioning |
| Post-processing E2E | Toggle effects → verify settings persist → verify in play mode |
| Monitoring setup tests | Sentry client/server initialization, error capture |
| Database migration tests | Schema validation, migration up/down |
| Sprite sheet importer (expand) | Currently 55% — cover all import formats, error cases |

**Exit Criteria:**
- Every completed roadmap phase has at least one functional E2E spec
- All 72 API routes have test coverage
- Coverage thresholds raised to 85/75/80/85
- Zero untested shipped features

## Coverage Threshold Ratchet

| Milestone | Statements | Branches | Functions | Lines |
|-----------|-----------|----------|-----------|-------|
| Current | 20% | 15% | 15% | 20% |
| Post Tier 0 | 40% | 30% | 35% | 40% |
| Post Tier 1 | 55% | 45% | 50% | 55% |
| Post Tier 2 | 70% | 60% | 65% | 70% |
| Post Tier 3 | 85% | 75% | 80% | 85% |

Thresholds are enforced in `vitest.config.ts` and CI. They only go up.

## Playwright Config Changes

```typescript
// playwright.config.ts changes:
{
  retries: process.env.CI ? 2 : 0,        // Was: 0
  timeout: 45_000,                          // Was: 30_000
  expect: { timeout: 15_000 },              // Was: 10_000
}
```

## Test Quality Enforcement

### Vitest Custom Reporter or Pre-commit Check

A script that scans test files and fails if:
- Any `expect(true).toBe(true)` or `expect('literal').toBe('literal')` pattern found
- Any test file has zero imports from `src/` (excluding test utilities)
- Any test file exists in a deprecated location (e.g., `stores/__tests__/`)

### E2E Lint

A script that scans E2E specs and fails if:
- Any `waitForTimeout()` call found
- Any test has only `.toBeVisible()` assertions without behavioral verification

## File Changes Summary

| File | Change |
|------|--------|
| `web/vitest.config.ts` | Add `.test.tsx` include, raise thresholds progressively |
| `web/playwright.config.ts` | Add retries, increase timeouts |
| `web/src/test/apiTestUtils.ts` | NEW — API route testing helpers |
| `web/src/test/componentTestUtils.ts` | NEW — Component render test helpers |
| `web/e2e/helpers/wait-helpers.ts` | NEW — Condition-based wait utilities |
| `web/src/stores/__tests__/*` | DELETE — consolidated to `slices/__tests__/` |
| `web/src/lib/**/duplicate.test.ts` | DELETE — consolidated to `__tests__/` dirs |
| `web/src/components/editor/__tests__/*Aria*` | REWRITE or DELETE — 8 files |
| 25 E2E spec files | EDIT — replace all `waitForTimeout()` |
| 72 new test files | NEW — API route handler tests |
| ~15 new E2E spec files | NEW — feature coverage |
| ~10 expanded test files | EDIT — deeper coverage |

## Estimated Scope

| Tier | New/Modified Files | Test Cases Added |
|------|-------------------|-----------------|
| Tier 0 | ~60 modified, ~40 deleted, 4 new | ~0 net new (cleanup) |
| Tier 1 | ~25 new test files | ~350-450 |
| Tier 2 | ~30 new/modified test files, ~15 E2E specs | ~500-700 |
| Tier 3 | ~40 new test files, ~15 E2E specs | ~600-800 |
| **Total** | ~170 files touched | ~1,500-2,000 net new meaningful tests |
