# Spec: E1 — Wire Game Creation Pipeline to Chat API

> **Status:** DRAFT
> **Date:** 2026-04-12
> **Ticket:** #8350
> **Scope:** Connect the existing game creation pipeline (`web/src/lib/game-creation/`) to user-facing code paths so "describe a game -> AI builds it -> play it" works end-to-end.

## Problem

The game creation pipeline (decomposer, planBuilder, pipelineRunner, 9 executors) was built in Phase 2A but is **never called from any user-facing code**:

- `web/src/lib/game-creation/index.ts` exports `decomposeIntoSystems`, `buildPlan`, `runPipeline`, `EXECUTOR_REGISTRY` — zero imports found in `web/src/app/` or `web/src/components/`.
- `QuickStartFlow.tsx` collects a user prompt ("A jungle platformer where...") then **discards it** — calls `loadTemplate(card.templateId)` instead.
- `chat/route.ts` SYSTEM_PROMPT mentions "orchestrating" game creation but the route never invokes the pipeline.
- `GDDPanel.tsx` imports from a legacy `gddGenerator` module, not from `game-creation/`.

**Result:** SpawnForge's headline feature — "describe a game and AI builds it" — doesn't work.

## Architectural Constraint

**The pipeline MUST run client-side.** 7 of 9 executors call `ctx.dispatchCommand()` which sends JSON to the Bevy WASM engine via `wasm-bindgen` — a browser-only API. The server's role is limited to:

1. LLM calls (decomposer) — `fetchAI()` requires server-side API keys
2. Asset generation API calls — `assetGenerateExecutor` calls external APIs

Everything else (scene creation, entity setup, physics, scripts, verification, polish) runs in the browser.

## Solution Overview

```
User prompt (chat or QuickStart)
    |
    v
[Intent Detection] -- "make me a platformer" vs "change the color to red"
    |                       |
    v                       v
Pipeline trigger        Normal MCP chat
    |
    v
[POST /api/game/decompose] -- server-side LLM call
    |
    v
OrchestratorGDD (JSON response)
    |
    v
[Client: buildPlan()] -- pure JS, topological sort, tier caps
    |
    v
OrchestratorPlan + TokenEstimate
    |
    v
[orchestratorSlice] -- Zustand state for pipeline progress
    |
    v
[OrchestratorPanel] -- approval gate UI, progress display
    |
    v  (user approves)
[Client: runPipeline()] -- sequential step execution
    |   |   |
    |   |   +-- onStepComplete -> update slice
    |   +------ onGateReached -> approval dialog
    +---------- onPlanStatusChange -> update slice
    |
    v
Game built in editor
```

## Deliverable 1: orchestratorSlice

**File:** `web/src/stores/slices/orchestratorSlice.ts`
**Test:** `web/src/stores/slices/__tests__/orchestratorSlice.test.ts`

### State Shape

```typescript
export interface OrchestratorSlice {
  // Pipeline state
  orchestratorStatus: OrchestratorStatus;
  currentPlan: OrchestratorPlan | null;
  currentStepIndex: number;
  stepStatuses: Record<string, PlanStep['status']>;

  // Gate resolution
  pendingGate: ApprovalGate | null;

  // Token estimate
  tokenEstimate: TokenEstimate | null;
  reservationId: string | null;

  // Error state
  orchestratorError: string | null;

  // Actions
  startDecomposition: (prompt: string, projectType: '2d' | '3d') => Promise<void>;
  setPlan: (plan: OrchestratorPlan) => void;
  setOrchestratorStatus: (status: OrchestratorStatus) => void;
  updateStepStatus: (stepId: string, status: PlanStep['status']) => void;
  setPendingGate: (gate: ApprovalGate | null) => void;
  resolveGate: (decision: 'approved' | 'rejected') => void;
  cancelPipeline: () => void;
  resetOrchestrator: () => void;
  runPipelineFromPlan: () => Promise<void>;
}

export type OrchestratorStatus =
  | 'idle'
  | 'decomposing'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';
```

### Key Design Decisions

1. **Status is a flat union, not nested.** The slice tracks `orchestratorStatus` independently from the plan's `status` field. The plan is the data model; the slice status is the UI state machine. This avoids mutations to the plan object for UI updates.

2. **`stepStatuses` is a denormalized map.** Avoids deep object updates on `currentPlan.steps[n].status`. The plan object is set once via `setPlan()` and only the step status map gets updated per-step.

3. **Gate resolution is synchronous from the slice's perspective.** `setPendingGate()` pauses the pipeline (via a Promise that the runner awaits), `resolveGate()` resolves it. The Promise plumbing lives in `runPipelineFromPlan()`, not in the slice state.

4. **AbortController lives outside the store.** Created in `runPipelineFromPlan()`, stored as a module-level ref. `cancelPipeline()` calls `.abort()` and sets status to `cancelled`.

### Wire into editorStore.ts

Add to the composition root:
```typescript
import { OrchestratorSlice, createOrchestratorSlice } from './slices/orchestratorSlice';

export type EditorState = /* existing */ & OrchestratorSlice;

export const useEditorStore = create<EditorState>()((...args) => ({
  /* existing slices */
  ...createOrchestratorSlice(...args),
}));
```

No dispatcher wiring needed — the orchestrator slice calls `getCommandDispatcher()` and `getCommandBatchDispatcher()` directly from `editorStore.ts` to build the `ExecutorContext`.

### Test Plan

Using `sliceTestTemplate.ts` pattern:
- Initial state is `idle` with null plan
- `startDecomposition()` sets status to `decomposing`, calls decompose endpoint
- `setPlan()` populates plan and token estimate
- `updateStepStatus()` updates denormalized map
- `setPendingGate()` sets gate, status transitions to `awaiting_approval`
- `resolveGate('approved')` clears gate, status resumes `executing`
- `resolveGate('rejected')` sets status to `cancelled`
- `cancelPipeline()` sets status to `cancelled`
- `resetOrchestrator()` returns to `idle` initial state

---

## Deliverable 2: Server Decompose Endpoint

**File:** `web/src/app/api/game/decompose/route.ts`
**Test:** `web/src/app/api/game/decompose/__tests__/route.test.ts`

### API Contract

```
POST /api/game/decompose
Authorization: Bearer <clerk-session>

Request:
{
  "prompt": string,         // max 1000 chars
  "projectType": "2d" | "3d",
  "userTier": "starter" | "hobbyist" | "creator" | "pro"
}

Response 200:
{
  "gdd": OrchestratorGDD
}

Response 400: { "error": "validation_error", "details": [...] }
Response 401: { "error": "unauthorized" }
Response 429: { "error": "rate_limited" }
Response 500: { "error": "decomposition_failed", "message": string }
```

### Implementation

```typescript
import { safeAuth } from '@/lib/auth/safe-auth';
import { rateLimitPublicRoute } from '@/lib/api/rateLimit';
import { decomposeIntoSystems } from '@/lib/game-creation';
import { withApiMiddleware } from '@/lib/api/middleware';
import { z } from 'zod';

const requestSchema = z.object({
  prompt: z.string().min(1).max(1000),
  projectType: z.enum(['2d', '3d']),
  userTier: z.enum(['starter', 'hobbyist', 'creator', 'pro']),
});
```

### Key Design Decisions

1. **Thin wrapper.** The route does auth, rate limiting, validation, and calls `decomposeIntoSystems()`. No business logic in the route itself.

2. **No streaming.** Decomposition is a single LLM call (2-5s). SSE adds complexity for no UX benefit — the client shows a spinner during `decomposing` status.

3. **Rate limit: 5 req/min.** Game creation is expensive. Tier-based limits can be added later.

4. **`userTier` in request body, not derived server-side.** The tier is used for the `buildPlan()` step which runs client-side. The server doesn't need it for decomposition, but we include it to avoid a second round-trip. Validated against the user's actual tier server-side.

### Test Plan

- Valid request returns 200 with GDD structure
- Missing/invalid fields return 400
- Unauthenticated request returns 401
- Rate limiting returns 429 after threshold
- LLM failure returns 500 with message

---

## Deliverable 3: Token Budget Reservation

**File:** `web/src/lib/tokens/budget.ts`
**Test:** `web/src/lib/tokens/__tests__/budget.test.ts`

### API

```typescript
export interface BudgetReservation {
  reservationId: string;
  userId: string;
  estimatedTotal: number;
  actualUsed: number;
  status: 'active' | 'released' | 'expired';
  createdAt: string;
}

/** Reserve tokens upfront for a pipeline run. Atomic deduction. */
export async function reserveTokenBudget(
  userId: string,
  estimatedTotal: number,
): Promise<
  | { success: true; reservationId: string; remaining: TokenBalance }
  | { success: false; error: 'INSUFFICIENT_TOKENS'; balance: TokenBalance; cost: number }
>;

/** Release unused tokens after pipeline completes or cancels. */
export async function releaseUnusedBudget(
  userId: string,
  reservationId: string,
  actualUsed: number,
): Promise<{ refunded: number; remaining: TokenBalance }>;

/** Record per-step usage against a reservation (for tracking only). */
export async function recordStepUsage(
  reservationId: string,
  stepId: string,
  tokensUsed: number,
): Promise<void>;
```

### Implementation Strategy

1. **`reserveTokenBudget()`** calls the existing `deductTokens()` with operation `'pipeline_reserve'` and the `totalVarianceHigh` estimate. This uses the atomic UPDATE...WHERE pattern already proven in the token service.

2. **`releaseUnusedBudget()`** calculates `reserved - actualUsed` and calls `refundTokens()` for the remainder. The refund is idempotent (existing CTE pattern).

3. **`recordStepUsage()`** inserts a `token_usage` row with `operation: 'pipeline_step'` and metadata `{ reservationId, stepId }`. This is for audit only — the actual deduction happened at reservation time.

4. **No new DB tables.** Reservations use the existing `token_usage` table with metadata to track reservation state. A reservation is "active" if no corresponding refund row exists.

### Key Design Decisions

- **Reserve the high-variance estimate.** Users see the worst-case cost upfront. Unused tokens are refunded immediately on completion/cancellation. This prevents mid-pipeline "insufficient tokens" failures.
- **No expiration timer.** Reservations expire implicitly when the pipeline completes/fails/cancels. A stale reservation (browser crash) can be cleaned up by a background job later — not in E1 scope.

### Test Plan

- Reserve deducts tokens atomically
- Reserve fails with insufficient balance
- Release refunds the difference (reserved - actual)
- Release is idempotent (second call is no-op)
- Step usage records audit rows without additional deduction

---

## Deliverable 4: OrchestratorPanel Component

**File:** `web/src/components/editor/OrchestratorPanel.tsx`
**Test:** `web/src/components/editor/__tests__/OrchestratorPanel.test.tsx`

### Component Structure

```
OrchestratorPanel
  |-- PipelineHeader       (title, status badge, cancel button)
  |-- StepList             (scrollable list of steps with status icons)
  |   |-- StepItem         (name, status indicator, timing)
  |-- TokenCostBar         (estimate breakdown, current usage vs reserved)
  |-- ApprovalGateDialog   (modal: plan review / asset review / final review)
```

### State Bindings

```typescript
const status = useEditorStore(s => s.orchestratorStatus);
const plan = useEditorStore(s => s.currentPlan);
const stepStatuses = useEditorStore(s => s.stepStatuses);
const pendingGate = useEditorStore(s => s.pendingGate);
const tokenEstimate = useEditorStore(s => s.tokenEstimate);
const resolveGate = useEditorStore(s => s.resolveGate);
const cancelPipeline = useEditorStore(s => s.cancelPipeline);
```

### Panel Integration

Register in `panelRegistry.ts` as `'orchestrator'`. The panel opens automatically when `orchestratorStatus` transitions away from `idle` (via a `useEffect` in `EditorLayout`).

The panel uses the existing dockview drawer pattern — appears as a right-side drawer, same as the AI chat panel. Does NOT replace the chat panel; they can coexist.

### ApprovalGateDialog

A modal dialog (using the existing `Dialog` primitive from `@spawnforge/ui`) that renders:

- **gate_plan:** Scene summaries table (name, entity count, system descriptions from `displayData.sceneSummaries`)
- **gate_assets:** Asset list with estimated token costs and fallback indicators
- **gate_final:** Completion summary (entity/scene/script counts, warnings)

Two buttons: "Approve" and "Cancel Game Creation". No "reject and modify" — that's future scope.

### Key Design Decisions

1. **No SSE from server.** Pipeline runs client-side, so progress updates come from Zustand store reactivity, not server-sent events. The `onStepComplete` callback writes to the store; React re-renders the panel.

2. **Step names are user-friendly.** Map executor names to display labels: `scene_create` -> "Creating scene", `entity_setup` -> "Setting up entities", etc.

3. **Cancel is immediate.** `cancelPipeline()` aborts the AbortController, which causes the next step check in `runPipeline()` to skip remaining steps. In-flight LLM calls may still complete but their results are discarded.

### Test Plan (RTL)

- Renders idle state (no panel content)
- Renders step list when plan is set
- Step status icons update as steps complete
- Approval gate dialog opens when `pendingGate` is set
- Approve button calls `resolveGate('approved')`
- Cancel button calls `cancelPipeline()`
- Token cost bar shows estimate breakdown

---

## Deliverable 5: Chat Intent Detection

**File:** `web/src/lib/chat/intentDetector.ts`
**Test:** `web/src/lib/chat/__tests__/intentDetector.test.ts`

### API

```typescript
export interface IntentResult {
  intent: 'game_creation' | 'normal_chat';
  confidence: number;       // 0-1
  extractedPrompt?: string; // cleaned prompt for decomposer
}

export function detectGameCreationIntent(message: string): IntentResult;
```

### Heuristic Rules

The detector is **keyword-based first** (no LLM call for intent detection):

**Strong signals** (confidence >= 0.9):
- "make me a game", "create a game", "build a game", "generate a game"
- "make me a [genre]" where genre in `['platformer', 'shooter', 'puzzle', 'rpg', 'racer', 'adventure', 'sandbox', 'strategy']`

**Medium signals** (confidence >= 0.6):
- "I want a game where...", "game about...", "game with..."
- Contains 2+ of: player, enemy, level, score, lives, jump, shoot, collect

**Weak signals** (confidence < 0.5, route to normal chat):
- Single-word messages, questions, commands about existing entities
- Contains "change", "modify", "update", "fix", "move", "delete" (editing intent)

### Integration Point

In the chat UI (`ChatPanel.tsx` or `useChatSubmit` hook), before sending a message to the chat API:

```typescript
const intent = detectGameCreationIntent(userMessage);
if (intent.intent === 'game_creation' && intent.confidence >= 0.7) {
  // Trigger pipeline via orchestratorSlice
  startDecomposition(intent.extractedPrompt ?? userMessage, projectType);
  // Show feedback in chat: "Starting game creation..."
  return;
}
// Otherwise, send to /api/chat as normal
```

### Key Design Decisions

1. **Client-side only.** No LLM call for intent detection. Keywords are fast and sufficient for v1. False negatives (user says "make me a game" but gets normal chat) are acceptable — the user can try again or use the QuickStart flow.

2. **Confidence threshold at 0.7.** Below this, fall through to normal chat. Users can always explicitly trigger pipeline via QuickStart or a future `/create` command.

3. **No persistent state.** Intent detection is stateless — runs on every message independently. Multi-turn "game creation conversation" is future scope.

### Test Plan

- "make me a platformer" -> game_creation, confidence >= 0.9
- "make me a jungle platformer where you collect gems" -> game_creation, confidence >= 0.9
- "change the player color to red" -> normal_chat
- "what is a game engine?" -> normal_chat
- "I want a game where you fly through caves" -> game_creation, confidence >= 0.6
- Edge cases: empty string, very long input, injection attempts

---

## Deliverable 6: QuickStartFlow Fix

**File:** `web/src/components/onboarding/QuickStartFlow.tsx` (modify existing)

### Current Behavior

```typescript
// Line 101-102: prompt is collected but DISCARDED
await loadTemplate(card.templateId);
```

### New Behavior

```typescript
const handleGenerate = useCallback(async () => {
  if (!selectedType || isGenerating) return;
  const card = GAME_TYPE_CARDS.find((c) => c.id === selectedType);
  if (!card) return;

  setIsGenerating(true);
  setGenerateError(null);
  try {
    // Build prompt: game type as hint prefix + user's description
    const fullPrompt = `${card.label}: ${prompt}`;

    // Trigger the pipeline via orchestratorSlice
    const startDecomposition = useEditorStore.getState().startDecomposition;
    const projectType = useEditorStore.getState().projectType ?? '3d';
    await startDecomposition(fullPrompt, projectType);

    // Close QuickStart — OrchestratorPanel takes over
    localStorage.setItem(STORAGE_KEY, '1');
    onComplete();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start game creation.';
    setGenerateError(message);
  } finally {
    setIsGenerating(false);
  }
}, [selectedType, isGenerating, prompt, onComplete]);
```

### Key Design Decisions

1. **Game type is a prefix, not the entire input.** "Platformer: A jungle adventure with gem collecting" gives the decomposer both the category hint and the user's creative input.

2. **QuickStart closes on success.** The OrchestratorPanel takes over UI responsibility. Step 3 ("Your game is ready!") is replaced by the OrchestratorPanel's progress view.

3. **Fallback on error.** If decomposition fails, the QuickStart shows the error and lets the user retry. No fallback to `loadTemplate()` — that path is removed.

4. **`loadTemplate()` remains available.** Other code paths (e.g., template gallery) can still call it. We're not removing the function, just not calling it from QuickStart's primary flow.

### Test Plan

- QuickStart "Generate" button triggers `startDecomposition()` with prefixed prompt
- Error from decomposition displays in error area
- QuickStart closes on successful decomposition start
- Game type prefix is correctly prepended

---

## Deliverable 7: Client-Side Pipeline Orchestration

This is the glue code inside `orchestratorSlice.runPipelineFromPlan()` that connects all pieces.

### Sequence

```
1. User triggers pipeline (chat intent or QuickStart)
2. orchestratorSlice.startDecomposition(prompt, projectType)
   a. Set status = 'decomposing'
   b. POST /api/game/decompose -> get GDD
   c. buildPlan(gdd, projectId, userTier, tokenBalance)
   d. Set status = 'planning'
   e. reserveTokenBudget(userId, plan.tokenEstimate.totalVarianceHigh)
   f. setPlan(plan), set tokenEstimate
   g. Set status = 'awaiting_approval' (gate_plan fires immediately)

3. User approves gate_plan
4. orchestratorSlice.runPipelineFromPlan()
   a. Build ExecutorContext from editorStore state
   b. Create AbortController
   c. Set status = 'executing'
   d. Call runPipeline() with callbacks:
      - onStepComplete: updateStepStatus(), recordStepUsage()
      - onGateReached: setPendingGate(), await resolution Promise
      - onPlanStatusChange: setOrchestratorStatus()
   e. On completion: releaseUnusedBudget()
   f. On failure/cancel: releaseUnusedBudget() with actualUsed=0

5. OrchestratorPanel renders reactively from slice state
```

### ExecutorContext Construction

```typescript
const ctx: ExecutorContext = {
  dispatchCommand: getCommandDispatcher()!,
  dispatchCommandBatch: getCommandBatchDispatcher() ?? undefined,
  store: useEditorStore.getState(),
  projectType,
  userTier,
  signal: abortController.signal,
  resolveStepOutput: () => undefined, // overridden by runPipeline()
};
```

### Gate Resolution Pattern

```typescript
// In runPipelineFromPlan():
let gateResolver: ((decision: 'approved' | 'rejected') => void) | null = null;

const callbacks: PipelineCallbacks = {
  onGateReached: (gate) => {
    return new Promise<'approved' | 'rejected'>((resolve) => {
      gateResolver = resolve;
      set({ pendingGate: gate, orchestratorStatus: 'awaiting_approval' });
    });
  },
};

// In resolveGate action:
resolveGate: (decision) => {
  if (gateResolver) {
    gateResolver(decision);
    gateResolver = null;
  }
  set({ pendingGate: null, orchestratorStatus: decision === 'approved' ? 'executing' : 'cancelled' });
},
```

---

## Deliverable 8: E2E Test

**File:** `web/e2e/tests/game-creation.spec.ts`

### Test Scenario: "First Game in 5 Minutes"

```typescript
test('user describes a game and pipeline builds it', async ({ page }) => {
  // 1. Mock the decompose endpoint with a deterministic GDD
  await page.route('**/api/game/decompose', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ gdd: MOCK_GDD }),
    });
  });

  // 2. Navigate to editor (auth bypass)
  await page.goto('/dev');
  await page.waitForSelector('[data-testid="editor-layout"]');

  // 3. Type game description in chat
  await page.fill('[data-testid="chat-input"]', 'Make me a platformer with jumping');
  await page.press('[data-testid="chat-input"]', 'Enter');

  // 4. Wait for orchestrator panel to appear
  await page.waitForSelector('[data-testid="orchestrator-panel"]');

  // 5. Approve the plan gate
  await page.waitForSelector('[data-testid="gate-approve-btn"]');
  await page.click('[data-testid="gate-approve-btn"]');

  // 6. Wait for pipeline to reach asset gate or completion
  await page.waitForSelector('[data-testid="orchestrator-status-completed"]', {
    timeout: 30000,
  });

  // 7. Verify entities were created in the scene graph
  const sceneNodes = await page.evaluate(() => {
    const store = (window as any).__EDITOR_STORE;
    if (!store) return {};
    return store.getState().sceneGraph.nodes;
  });
  expect(Object.keys(sceneNodes).length).toBeGreaterThan(0);
});
```

### MOCK_GDD

A minimal GDD with 1 scene, 2 entities (player + platform), 2 systems (movement, physics). Deterministic — no LLM calls in E2E.

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `web/src/stores/slices/orchestratorSlice.ts` | CREATE | Pipeline state management |
| `web/src/stores/slices/__tests__/orchestratorSlice.test.ts` | CREATE | Slice tests |
| `web/src/stores/slices/index.ts` | MODIFY | Export orchestrator slice |
| `web/src/stores/editorStore.ts` | MODIFY | Add OrchestratorSlice to composition |
| `web/src/app/api/game/decompose/route.ts` | CREATE | Server decompose endpoint |
| `web/src/app/api/game/decompose/__tests__/route.test.ts` | CREATE | Endpoint tests |
| `web/src/lib/tokens/budget.ts` | CREATE | Token budget reservation |
| `web/src/lib/tokens/__tests__/budget.test.ts` | CREATE | Budget tests |
| `web/src/components/editor/OrchestratorPanel.tsx` | CREATE | Pipeline progress UI |
| `web/src/components/editor/__tests__/OrchestratorPanel.test.tsx` | CREATE | Panel RTL tests |
| `web/src/lib/chat/intentDetector.ts` | CREATE | Game creation intent detection |
| `web/src/lib/chat/__tests__/intentDetector.test.ts` | CREATE | Intent detection tests |
| `web/src/components/onboarding/QuickStartFlow.tsx` | MODIFY | Wire to pipeline |
| `web/src/lib/workspace/panelRegistry.ts` | MODIFY | Register orchestrator panel |
| `web/e2e/tests/game-creation.spec.ts` | CREATE | E2E test |

## Non-Goals (Explicitly Out of Scope)

- **Multi-turn game creation conversation** — v1 is single-prompt-in, pipeline-out
- **Reject-and-modify approval gates** — v1 is approve or cancel
- **LLM-based intent classification** — v1 uses keyword heuristics
- **Reservation expiration/cleanup** — background job for stale reservations is post-E1
- **Asset generation server endpoint** — `assetGenerateExecutor` already handles its own API calls via `ExecutorContext`
- **GDDPanel migration** — `GDDPanel.tsx` can remain as-is; the OrchestratorPanel replaces it functionally

## Security Considerations

1. **Decompose endpoint validates tier server-side** — cannot trust client-sent `userTier` for authorization. Used only for plan building hints. Actual tier enforcement happens in `buildPlan()` via asset caps.
2. **Prompt sanitization** — `decomposeIntoSystems()` already calls `sanitizePrompt()` and validates all LLM output via Zod schemas.
3. **Rate limiting** — 5 req/min on decompose endpoint via `rateLimitPublicRoute()`. Must `await` the call.
4. **No LLM objects spread into engine** — All executors use allowlisted fields with `Number.isFinite()` guards (already implemented in Phase 2A).

## Dependencies

- Existing: `web/src/lib/game-creation/*` (Phase 2A, all 9 executors)
- Existing: `web/src/lib/tokens/service.ts` (deductTokens, refundTokens)
- Existing: `web/src/lib/auth/safe-auth.ts` (safeAuth)
- Existing: `web/src/lib/api/rateLimit.ts` (rateLimitPublicRoute)
- Existing: `@spawnforge/ui` Dialog primitive

## Implementation Order

1. orchestratorSlice + tests (no external deps)
2. /api/game/decompose + tests (parallel with 1)
3. Token budget reservation + tests (parallel with 1-2)
4. OrchestratorPanel + tests (needs slice from 1)
5. Intent detection + tests (parallel with 4)
6. QuickStartFlow fix (needs slice from 1, endpoint from 2)
7. Wire everything together (needs 1-6)
8. E2E test (needs 1-7)
