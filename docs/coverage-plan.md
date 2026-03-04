# Test Coverage Plan: 55/45/50/55

> **Target:** 55% statements / 45% branches / 50% functions / 55% lines
> **Current:** 41% statements / 34% branches / 35% functions / 42% lines
> **Gap:** ~2,930 uncovered statements to cover

## Baseline (2026-03-03)

| Metric | Current | Target | Delta |
|--------|---------|--------|-------|
| Statements | 41.12% | 55% | +13.88% |
| Branches | 34.12% | 45% | +10.88% |
| Functions | 34.89% | 50% | +15.11% |
| Lines | 42.28% | 55% | +12.72% |

Total codebase: 21,099 statements. Currently covering 8,676. Need to reach ~11,605.

---

## Principles

1. **Depth over breadth** — Test real behavior, not just line counts. Every test should assert meaningful outcomes.
2. **No snapshot-only tests** — Snapshots are fragile. Test interactions, state transitions, and rendered output.
3. **Mock at boundaries** — Mock `fetch`, `wasm-bindgen`, `localStorage`, Clerk auth. Never mock the unit under test.
4. **Full E2E testability** — The entire application path (UI → store → command → bridge mock → store update → UI re-render) must be exercisable in tests.
5. **Deterministic** — No `setTimeout` races, no flaky async. Use `waitFor`, `act`, and explicit assertions.

---

## Phase 1: Core Logic (Target: +1,000 stmts → ~46%)

High-value pure logic files with no DOM dependency. These are the fastest wins with the deepest impact.

### 1A. Chat System Logic

| File | Uncovered | Current % | Priority |
|------|-----------|-----------|----------|
| `src/lib/chat/context.ts` | 229 | 31% | P0 |
| `src/stores/chatStore.ts` | 215 | 17% | P0 |
| `src/lib/chat/executor.legacy.ts` | 248 | 59% | P1 |

**What to test:**
- `context.ts` — Scene context builder: test with varied scene states (empty, 1 entity, 100 entities, nested hierarchies, all component types). Assert context string format, token budget trimming, entity summarization.
- `chatStore.ts` — Full message lifecycle: sendMessage → streaming → tool calls → response. Test error recovery, abort, rate limiting, conversation history management, model switching.
- `executor.legacy.ts` — Already at 59%. Fill gaps: error branches, unknown command handling, batch execution edge cases.

### 1B. Scripting Engine

| File | Uncovered | Current % | Priority |
|------|-----------|-----------|----------|
| `src/lib/scripting/scriptWorker.ts` | 260 | 34% | P0 |
| `src/lib/scripting/useScriptRunner.ts` | 209 | 0% | P1 |

**What to test:**
- `scriptWorker.ts` — Script compilation, `forge.*` API surface (entity manipulation, physics, audio, UI), sandbox security (blocked globals, prototype pollution), error handling, script lifecycle (init → update → destroy).
- `useScriptRunner.ts` — Hook lifecycle with `renderHook`: script loading, play/pause/stop state transitions, error boundary integration, cleanup on unmount.

### 1C. Remaining API Routes

| File | Uncovered | Current % | Priority |
|------|-----------|-----------|----------|
| `src/app/api/chat/route.ts` | 82 | 0% | P0 |
| `src/app/api/docs/route.ts` | ~40 | 0% | P2 |
| `src/app/api/jobs/route.ts` | ~30 | 0% | P2 |

**What to test:**
- `chat/route.ts` — Auth gating, rate limiting, request validation, streaming response format, error responses for missing API keys, model selection, token deduction.
- `docs/route.ts`, `jobs/route.ts` — Auth, input validation, response shape.

---

## Phase 2: Hooks & State (Target: +800 stmts → ~50%)

Custom hooks that bridge WASM ↔ React. These are critical integration points.

### 2A. Engine Hooks

| File | Uncovered | Current % | Priority |
|------|-----------|-----------|----------|
| `src/hooks/useGenerationPolling.ts` | 144 | 0% | P0 |
| `src/hooks/useEngineStatus.ts` | 81 | 7% | P0 |
| `src/hooks/useWasmLoader.ts` | ~60 | low | P1 |

**What to test:**
- `useGenerationPolling.ts` — Poll lifecycle: start → poll → complete/error/timeout. Test retry logic, cancellation, concurrent polls, status transitions.
- `useEngineStatus.ts` — WebGPU detection, WASM loading states, fallback to WebGL2, error states.
- Test with `renderHook` from `@testing-library/react`. Mock `fetch` and `navigator.gpu`.

### 2B. Store Gaps

| File | Uncovered | Current % | Priority |
|------|-----------|-----------|----------|
| `src/stores/chatStore.ts` | 215 | 17% | covered in 1A |
| `src/stores/uiBuilderStore.ts` | 75 | 84% | P2 |

---

## Phase 3: Editor Components (Target: +1,200 stmts → ~55%)

React component tests using jsdom + `@testing-library/react`. Focus on the largest components first.

### 3A. High-Impact Components (0% coverage, 100+ stmts each)

| File | Uncovered | Priority |
|------|-----------|----------|
| `src/components/editor/PixelArtEditor.tsx` | 268 | P0 |
| `src/components/editor/GameComponentInspector.tsx` | 240 | P0 |
| `src/components/editor/TimelinePanel.tsx` | 226 | P0 |
| `src/components/editor/SceneHierarchy.tsx` | 172 | P0 |
| `src/components/editor/AssetPanel.tsx` | 155 | P1 |
| `src/components/editor/MaterialInspector.tsx` | 152 | P1 |
| `src/components/editor/SceneSettings.tsx` | 150 | P1 |
| `src/components/chat/ChatInput.tsx` | 149 | P1 |
| `src/components/editor/EditorLayout.tsx` | 121 | P1 |
| `src/components/editor/ExportDialog.tsx` | 119 | P1 |

**Testing approach for components:**
- Render with a mock Zustand store provider (already have `componentTestUtils.tsx`).
- Test user interactions: click, type, drag, keyboard shortcuts.
- Assert store mutations, not DOM details.
- For inspector panels: test that changing a value dispatches the correct engine command.
- For complex components (PixelArtEditor, TimelinePanel): test the state machine / interaction model, not pixel output.

### 3B. Medium Components (0% coverage, 50-100 stmts)

| File | Uncovered | Priority |
|------|-----------|----------|
| `src/components/editor/SpriteSheetImportDialog.tsx` | 135 | P2 |
| `src/components/editor/DocsPanel.tsx` | 133 | P2 |
| `src/components/editor/DialogueTreeEditor.tsx` | 125 | P2 |
| `src/components/editor/ParticleInspector.tsx` | 125 | P2 |
| `src/components/editor/ScriptExplorerPanel.tsx` | 125 | P2 |
| `src/components/editor/TutorialOverlay.tsx` | 123 | P2 |
| `src/components/editor/AnimationClipInspector.tsx` | 122 | P2 |
| `src/components/editor/ScriptEditorPanel.tsx` | 118 | P2 |
| `src/components/editor/InspectorPanel.tsx` | 98 | P2 |

---

## Execution Order

Work is ordered by coverage-per-effort ratio. Each phase should be a separate PR.

### Sprint 1: Pure Logic (PR #1)
- [ ] `src/lib/chat/context.ts` — context builder tests
- [ ] `src/stores/chatStore.ts` — message lifecycle, streaming, tool calls
- [ ] `src/app/api/chat/route.ts` — API route tests
- [ ] `src/lib/scripting/scriptWorker.ts` — expand existing tests
- **Expected gain:** ~750 statements (+3.5%)

### Sprint 2: Hooks & Scripting (PR #2)
- [ ] `src/hooks/useGenerationPolling.ts` — poll lifecycle
- [ ] `src/hooks/useEngineStatus.ts` — WASM/WebGPU detection
- [ ] `src/lib/scripting/useScriptRunner.ts` — script lifecycle hook
- [ ] `src/lib/chat/executor.legacy.ts` — fill remaining branches
- **Expected gain:** ~700 statements (+3.3%)

### Sprint 3: Big Editor Components (PR #3)
- [ ] `PixelArtEditor.tsx` — canvas tool interactions
- [ ] `GameComponentInspector.tsx` — component CRUD
- [ ] `TimelinePanel.tsx` — keyframe editing
- [ ] `SceneHierarchy.tsx` — tree interactions, drag-and-drop
- **Expected gain:** ~600 statements (+2.8%)

### Sprint 4: Inspector & Dialog Components (PR #4)
- [ ] `MaterialInspector.tsx` — material property editing
- [ ] `SceneSettings.tsx` — scene config
- [ ] `ChatInput.tsx` — message composition, slash commands
- [ ] `AssetPanel.tsx` — asset browsing, import
- [ ] `EditorLayout.tsx` — panel arrangement
- [ ] `ExportDialog.tsx` — export config
- **Expected gain:** ~850 statements (+4.0%)

### Sprint 5: Remaining Components + Polish (PR #5)
- [ ] Remaining P2 components from 3B
- [ ] `src/app/api/docs/route.ts`, `src/app/api/jobs/route.ts`
- [ ] Branch coverage sweeps on files already above 70% stmts
- **Expected gain:** ~500 statements (+2.4%)

---

## Test Infrastructure

### Already in place
- `src/test/utils/apiTestUtils.ts` — `mockNextResponse`, `makeUser`, `mockFetchResponse`
- `src/test/utils/componentTestUtils.tsx` — React render wrapper with providers
- `src/test/utils/fixtures.ts` — Entity/scene fixtures
- `vitest.config.ts` — jsdom environment, path aliases, coverage config

### Needed additions
- **Store test helper** — Utility to create a pre-populated Zustand store for component tests (inject specific entities, materials, scenes without full initialization).
- **Engine command spy** — Mock `handle_command()` bridge that records commands and optionally returns canned responses. Enables testing the full UI → command → store cycle.
- **Streaming response mock** — Helper for testing `ReadableStream` / SSE responses from the chat API.
- **Canvas mock** — Lightweight `HTMLCanvasElement` stub for PixelArtEditor and shader preview tests (jsdom has no canvas).

---

## Metrics Tracking

After each sprint PR, report:

```
Statements: XX.XX% (was YY.YY%, target 55%)
Branches:   XX.XX% (was YY.YY%, target 45%)
Functions:  XX.XX% (was YY.YY%, target 50%)
Lines:      XX.XX% (was YY.YY%, target 55%)
```

CI enforces thresholds — no PR merges if coverage regresses below the current floor. The thresholds in `vitest.config.ts` will be raised incrementally as each sprint lands:

| After Sprint | Statements | Branches | Functions | Lines |
|-------------|-----------|----------|-----------|-------|
| Current | 20 | 15 | 15 | 20 |
| Sprint 1 | 44 | 37 | 38 | 45 |
| Sprint 2 | 47 | 40 | 42 | 48 |
| Sprint 3 | 50 | 42 | 45 | 51 |
| Sprint 4 | 53 | 44 | 48 | 54 |
| Sprint 5 | 55 | 45 | 50 | 55 |
