# Game Creation Orchestrator (Phase 2A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the systems-not-genres game creation orchestrator that decomposes any natural language game description into composable systems, builds an execution plan, and runs it to produce a playable game in the SpawnForge editor.

**Architecture:** 6-layer pipeline: Types (done) -> Decomposer (LLM + Zod) -> Plan Builder (topological sort) -> Pipeline Runner (generic step executor) -> Step Executors (8 domain-specific) -> System Registry (4 system definitions). All async TypeScript, no WASM changes.

**Tech Stack:** TypeScript, Zod 4.x, AI SDK (fetchAI), existing EditorState/dispatchCommand

**Source Spec:** `specs/2026-03-25-game-creation-orchestrator-phase2a-v4.md` (v4, 4/4 review PASS)

**Existing:** `web/src/lib/game-creation/types.ts` is complete. All other files need creation.

---

## Task 0: Prerequisite — Shadow Reflect and Proxy in Script Worker

**Files:**
- Modify: `web/src/lib/scripting/sandboxGlobals.ts:27-34`
- Modify: `web/src/lib/scripting/__tests__/scriptSandbox.test.ts` (update count)
- Modify: `web/src/lib/scripting/__tests__/scriptSecurity.test.ts` (update count)

- [ ] **Step 1: Add Reflect and Proxy to SHADOWED_GLOBALS**

In `web/src/lib/scripting/sandboxGlobals.ts`, add two entries after `'Function', 'eval'`:

```typescript
export const SHADOWED_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
  'indexedDB', 'caches', 'navigator', 'location',
  'EventSource', 'BroadcastChannel',
  'self', 'globalThis',
  'Function', 'eval',
  'Reflect', 'Proxy',       // S6: required for custom_script_generate sandbox safety
] as const;
```

- [ ] **Step 2: Update test assertions**

In `scriptSecurity.test.ts`, change `expect(SHADOWED_GLOBALS).toHaveLength(14)` to `16`.
In `scriptSandbox.test.ts`, update any assertion on the globals count from 14 to 16.

- [ ] **Step 3: Run tests**

Run: `cd web && npx vitest run src/lib/scripting/__tests__/scriptSandbox.test.ts src/lib/scripting/__tests__/scriptSecurity.test.ts`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/scripting/sandboxGlobals.ts web/src/lib/scripting/__tests__/scriptSandbox.test.ts web/src/lib/scripting/__tests__/scriptSecurity.test.ts
git commit -m "fix: shadow Reflect and Proxy in script worker sandbox (S6 prerequisite)"
```

---

## Task 1: System Registry — 5 files

**Files:**
- Create: `web/src/lib/game-creation/systems/index.ts`
- Create: `web/src/lib/game-creation/systems/movement.ts`
- Create: `web/src/lib/game-creation/systems/camera.ts`
- Create: `web/src/lib/game-creation/systems/world.ts`
- Create: `web/src/lib/game-creation/systems/entities.ts`
- Test: `web/src/lib/game-creation/__tests__/systemRegistry.test.ts`

System definitions tell the plan builder what steps each system category needs. Each system definition has a `setupSteps()` function that returns step inputs.

- [ ] **Step 1: Write systemRegistry.test.ts**

Test that:
1. SYSTEM_REGISTRY has entries for movement, camera, world, entities
2. Each registered system has a valid `setupSteps` that returns an array
3. Unknown categories return undefined from the registry
4. `setupSteps` returns steps with valid executor names
5. Movement system returns physics_profile + character_setup steps

Reference spec section: "Layer 6: System Registry" (line 1946)

- [ ] **Step 2: Run test — verify it fails**

Run: `cd web && npx vitest run src/lib/game-creation/__tests__/systemRegistry.test.ts`
Expected: FAIL (modules don't exist)

- [ ] **Step 3: Implement systems/index.ts**

Creates `SYSTEM_REGISTRY` Map and `registerSystem()`. Imports and registers all 4 systems.

```typescript
import type { GameSystem, OrchestratorGDD, ExecutorName } from '../types';

export interface SystemStepInput {
  executor: ExecutorName;
  input: Record<string, unknown>;
}

export interface SystemDefinition {
  category: string;
  setupSteps: (system: GameSystem, gdd: OrchestratorGDD) => SystemStepInput[];
}

export const SYSTEM_REGISTRY = new Map<string, SystemDefinition>();

export function registerSystem(def: SystemDefinition): void {
  SYSTEM_REGISTRY.set(def.category, def);
}
```

Then import `./movement`, `./camera`, `./world`, `./entities` (each self-registers).

- [ ] **Step 4: Implement movement.ts, camera.ts, world.ts, entities.ts**

Each file calls `registerSystem()` with a `setupSteps` function. Reference spec section "Layer 6: System Registry" for exact implementations:
- **movement**: returns `physics_profile` + `character_setup` steps
- **camera**: returns `scene_create` step with camera config
- **world**: returns `scene_create` step with world config
- **entities**: returns `entity_setup` steps per scene entity

- [ ] **Step 5: Run tests — verify they pass**

Run: `cd web && npx vitest run src/lib/game-creation/__tests__/systemRegistry.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/game-creation/systems/
git add web/src/lib/game-creation/__tests__/systemRegistry.test.ts
git commit -m "feat: add system registry with 4 system definitions (movement, camera, world, entities)"
```

---

## Task 2: Decomposer — 1 file + tests

**Files:**
- Create: `web/src/lib/game-creation/decomposer.ts`
- Test: `web/src/lib/game-creation/__tests__/decomposer.test.ts`

The decomposer takes a natural language prompt and produces an OrchestratorGDD via LLM call + Zod validation.

- [ ] **Step 1: Write decomposer.test.ts**

Test that (10+ tests):
1. Valid LLM JSON output is parsed and validated
2. Invalid JSON triggers retry (up to MAX_RETRIES)
3. Schema validation failure triggers retry
4. Sanitization strips injection attempts from title, mood, referenceGames, constraints
5. Unsafe mood falls back to 'neutral' (V4-5)
6. Unsafe referenceGames entries are dropped entirely (V4-5)
7. Unsafe constraints are dropped entirely (NB3)
8. sanitizePrompt is called on the user prompt before LLM call
9. Unsafe user prompt throws Error
10. projectType is propagated to the output GDD

Mock `fetchAI` from `@/lib/ai/client` and `sanitizePrompt` from `@/lib/ai/contentSafety`.

Reference spec: "Layer 2: decomposeIntoSystems()" (line 322-578)

- [ ] **Step 2: Run test — verify it fails**

Run: `cd web && npx vitest run src/lib/game-creation/__tests__/decomposer.test.ts`

- [ ] **Step 3: Implement decomposer.ts**

Copy implementation from spec (lines 326-578). Key elements:
- Zod schemas for all GDD sub-types
- DECOMPOSITION_SYSTEM_PROMPT template
- `decomposeIntoSystems()` with retry loop, JSON parsing, Zod validation, multi-field sanitization

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd web && npx vitest run src/lib/game-creation/__tests__/decomposer.test.ts`

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/game-creation/decomposer.ts web/src/lib/game-creation/__tests__/decomposer.test.ts
git commit -m "feat: add game decomposer — LLM prompt to OrchestratorGDD with Zod validation"
```

---

## Task 3: Plan Builder — 1 file + tests

**Files:**
- Create: `web/src/lib/game-creation/planBuilder.ts`
- Test: `web/src/lib/game-creation/__tests__/planBuilder.test.ts`

Converts an OrchestratorGDD into a topologically-sorted OrchestratorPlan with tier caps and approval gates.

- [ ] **Step 1: Write planBuilder.test.ts**

Test that (15+ tests):
1. Basic GDD produces steps in correct order: scenes -> entities -> systems -> assets -> verify -> polish
2. dependsOn chains are correct (entity steps depend on scene steps, etc.)
3. Tier cap limits asset steps (starter=5, hobbyist=15, etc.)
4. Required assets are prioritized over nice-to-have when capping
5. Approval gates are created at correct positions (gate_plan after first scene, gate_assets before assets)
6. gate_assets is skipped when there are no entities (V4-6)
7. Token estimate is calculated with correct variance aggregation (D1)
8. Insufficient balance sets `sufficientBalance: false` with warning message
9. stepCounter starts at -1 so first ID is step_0 (V4-1)
10. Unknown system categories generate custom_script_generate steps
11. FALLBACK_SCHEMA validates asset fallback strings (S5)
12. Invalid fallback falls back to 'primitive:cube'
13. Plan status starts as 'awaiting_approval'
14. Multiple scenes create independent scene_create steps
15. System dependsOn resolves to correct step IDs

Reference spec: "Layer 3: Plan Builder" (line 580-964)

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement planBuilder.ts**

Copy from spec (lines 584-964). Key elements:
- `ASSET_TIER_CAPS` and `TOKEN_COSTS` constants
- `buildPlan()` with 6 phases: scenes, entities, systems, assets, verify, polish
- `makeStep()` helper with type-safe ExecutorName
- Approval gates: `gate_plan` (after first scene) and `gate_assets` (before assets, skipped if no entities)
- Token estimation with variance aggregation

- [ ] **Step 4: Run tests**

Run: `cd web && npx vitest run src/lib/game-creation/__tests__/planBuilder.test.ts`

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/game-creation/planBuilder.ts web/src/lib/game-creation/__tests__/planBuilder.test.ts
git commit -m "feat: add plan builder — GDD to topologically-sorted execution plan"
```

---

## Task 4: Pipeline Runner — 1 file + tests

**Files:**
- Create: `web/src/lib/game-creation/pipelineRunner.ts`
- Test: `web/src/lib/game-creation/__tests__/pipelineRunner.test.ts`

Generic step executor with retry, abort, resume, and approval gate support. Zero external imports beyond types.

- [ ] **Step 1: Write pipelineRunner.test.ts**

Test that (15+ tests):
1. Steps execute in order respecting dependsOn
2. Failed step retries up to maxRetries
3. Failed non-optional step marks plan as 'failed'
4. Failed optional step marks step as 'skipped', continues
5. Abort via signal.abort() completes current step then skips remaining
6. Approval gates pause execution, resume on callback
7. Rejected gate marks plan as 'cancelled'
8. Step output is stored and accessible via resolveStepOutput
9. resolveStepOutput accepts step ID or executor name (V4-7)
10. onStepComplete callback fires after each step (NB2)
11. Steps with unmet dependencies are skipped
12. Status transitions: pending -> running -> completed/failed/skipped
13. Plan status updates correctly through lifecycle
14. Empty plan (no steps) completes immediately
15. userFacingErrorMessage is populated on failure

Reference spec: "Layer 4: Pipeline Runner" (line 965-1267)

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement pipelineRunner.ts**

Copy from spec (lines 965-1267). Key elements:
- `runPipeline()` — main entry, iterates steps in order
- `executeStep()` — runs executor with retry loop
- `resolveStepOutput()` — looks up by step ID or executor name (V4-7)
- `checkGate()` — pauses for approval gates
- AbortSignal integration for cancellation
- Zero external imports (only types from ./types)

- [ ] **Step 4: Run tests**

Run: `cd web && npx vitest run src/lib/game-creation/__tests__/pipelineRunner.test.ts`

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/game-creation/pipelineRunner.ts web/src/lib/game-creation/__tests__/pipelineRunner.test.ts
git commit -m "feat: add pipeline runner — generic step executor with retry, abort, gates"
```

---

## Task 5: Executor Shared + Registry — 2 files

**Files:**
- Create: `web/src/lib/game-creation/executors/shared.ts`
- Create: `web/src/lib/game-creation/executors/index.ts`

- [ ] **Step 1: Implement shared.ts**

Error helpers used by all executors:
```typescript
import type { OrchestratorStepError, ExecutorResult } from '../types';

export function makeStepError(
  code: string,
  message: string,
  userFacingMessage: string,
  retryable = false,
  details?: unknown,
): OrchestratorStepError {
  return { code, message, userFacingMessage, retryable, details };
}

export function failResult(error: OrchestratorStepError): ExecutorResult {
  return { success: false, error };
}

export function successResult(output: Record<string, unknown> = {}): ExecutorResult {
  return { success: true, output };
}
```

- [ ] **Step 2: Implement executors/index.ts**

Executor registry that maps ExecutorName to ExecutorDefinition. Imports all 8 executors.

```typescript
import type { ExecutorName, ExecutorDefinition } from '../types';

export const EXECUTOR_REGISTRY = new Map<ExecutorName, ExecutorDefinition>();

export function registerExecutor(def: ExecutorDefinition): void {
  EXECUTOR_REGISTRY.set(def.name, def);
}
```

Then import all 8 executor files (they self-register).

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/game-creation/executors/shared.ts web/src/lib/game-creation/executors/index.ts
git commit -m "feat: add executor shared helpers and registry"
```

---

## Task 6: Step Executors — 8 files + tests

**Files:**
- Create: `web/src/lib/game-creation/executors/sceneCreateExecutor.ts`
- Create: `web/src/lib/game-creation/executors/physicsProfileExecutor.ts`
- Create: `web/src/lib/game-creation/executors/characterSetupExecutor.ts`
- Create: `web/src/lib/game-creation/executors/entitySetupExecutor.ts`
- Create: `web/src/lib/game-creation/executors/assetGenerateExecutor.ts`
- Create: `web/src/lib/game-creation/executors/customScriptExecutor.ts`
- Create: `web/src/lib/game-creation/executors/verifyExecutor.ts`
- Create: `web/src/lib/game-creation/executors/autoPolishExecutor.ts`
- Test: `web/src/lib/game-creation/__tests__/executors.test.ts`
- Test: `web/src/lib/game-creation/__tests__/verifyExecutor.test.ts`

Each executor dispatches engine commands via `ctx.dispatchCommand()`. Reference spec: "Layer 5: Step Executors" (lines 1268-1945).

- [ ] **Step 1: Write executors.test.ts**

Test all 8 executors with mocked ExecutorContext:
- scene_create: dispatches `new_scene` + `rename_scene` commands
- physics_profile: selects preset from feelDirective, dispatches `update_physics_config`
- character_setup: dispatches `spawn_entity` + physics components; routes 2D vs 3D (B5)
- entity_setup: dispatches `spawn_entity` with correct type/components per role
- asset_generate: calls generation API, falls back on failure (S5)
- custom_script_generate: calls LLM for script, dispatches `set_script`, calculates confidence (NU1)
- auto_polish: uses structural heuristics (not telemetry), dispatches `update_ambient_light` (NB4)

- [ ] **Step 2: Write verifyExecutor.test.ts**

Test verify_all_scenes executor (10+ tests):
- Queries scene graph for structural issues
- Returns warnings list in output
- Passes when all scenes have at least one entity
- Flags empty scenes, missing cameras, physics without colliders

- [ ] **Step 3: Run tests — verify they fail**

- [ ] **Step 4: Implement all 8 executor files**

Each file:
1. Imports `registerExecutor` from `./index`
2. Imports helpers from `./shared`
3. Defines `ExecutorDefinition` with `name`, `inputSchema` (Zod), `execute`, `userFacingErrorMessage`
4. Calls `registerExecutor()` at module load

Key implementation notes:
- **physicsProfileExecutor**: Maps feelDirective pacing+weight to PHYSICS_PRESETS keys (B3)
- **characterSetupExecutor**: Routes 2D→`set_skeleton_2d` / 3D→`add_game_component(CharacterController)` (B5)
- **customScriptExecutor**: Sanitizes system.type and system.config before LLM prompt (NS1, V4-3, V4-4). Dynamic confidence based on line count and namespace usage (NU1)
- **autoPolishExecutor**: Uses structural heuristics from verify output, NOT diagnoseIssues() (B4). Dispatches `update_ambient_light` (NB4)
- **assetGenerateExecutor**: Validates fallback with FALLBACK_SCHEMA (S5)

- [ ] **Step 5: Run tests**

Run: `cd web && npx vitest run src/lib/game-creation/__tests__/executors.test.ts src/lib/game-creation/__tests__/verifyExecutor.test.ts`

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/game-creation/executors/
git add web/src/lib/game-creation/__tests__/executors.test.ts
git add web/src/lib/game-creation/__tests__/verifyExecutor.test.ts
git commit -m "feat: add 8 step executors — scene, physics, character, entity, asset, script, verify, polish"
```

---

## Task 7: Public API + Index — 1 file

**Files:**
- Create: `web/src/lib/game-creation/index.ts`

- [ ] **Step 1: Implement index.ts**

Public API re-exports:
```typescript
export { decomposeIntoSystems } from './decomposer';
export { buildPlan } from './planBuilder';
export { runPipeline } from './pipelineRunner';
export { SYSTEM_REGISTRY } from './systems';
export { EXECUTOR_REGISTRY } from './executors';
export type {
  OrchestratorGDD, OrchestratorPlan, PlanStep, ExecutorName,
  ExecutorContext, ExecutorResult, UserTier, SystemCategory,
  TokenEstimate, ApprovalGate,
} from './types';
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/game-creation/index.ts
git commit -m "feat: add game-creation public API index"
```

---

## Task 8: Fixtures — 12 JSON files

**Files:**
- Create: `web/src/lib/game-creation/__fixtures__/rhythm-platformer.json`
- Create: `web/src/lib/game-creation/__fixtures__/exploration-puzzle.json`
- Create: `web/src/lib/game-creation/__fixtures__/narrative-adventure.json`
- Create: `web/src/lib/game-creation/__fixtures__/arena-combat.json`
- Create: `web/src/lib/game-creation/__fixtures__/sandbox-creative.json`
- Create: `web/src/lib/game-creation/__fixtures__/zero-movement.json`
- Create: `web/src/lib/game-creation/__fixtures__/single-system.json`
- Create: `web/src/lib/game-creation/__fixtures__/twenty-systems.json`
- Create: `web/src/lib/game-creation/__fixtures__/vague-prompt.json`
- Create: `web/src/lib/game-creation/__fixtures__/adversarial-prompt.json`
- Create: `web/src/lib/game-creation/__fixtures__/2d-sprite-game.json`
- Create: `web/src/lib/game-creation/__fixtures__/cozy-farming.json`

Each fixture is a valid `OrchestratorGDD` JSON object used by planBuilder and integration tests.

- [ ] **Step 1: Create all 12 fixture files**

Each must be a valid OrchestratorGDD with all required fields. Key edge cases:
- `zero-movement.json`: No movement system (puzzle/card game) — tests that movement is not mandatory
- `single-system.json`: Only one system — minimal plan
- `twenty-systems.json`: 20+ systems — stress test for plan builder
- `vague-prompt.json`: Ambiguous user input — minimal but valid GDD
- `adversarial-prompt.json`: Injection attempts in title/constraints — all sanitized
- `2d-sprite-game.json`: projectType = '2d' — tests 2D routing
- `cozy-farming.json`: Heavy feelDirective (cozy, slow, light) — tests feel-based executor logic

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/game-creation/__fixtures__/
git commit -m "feat: add 12 GDD fixtures for orchestrator testing"
```

---

## Task 9: Integration Tests — 3 remaining test files

**Files:**
- Test: `web/src/lib/game-creation/__tests__/genreAgnosticism.test.ts`
- Test: `web/src/lib/game-creation/__tests__/tokenEstimate.test.ts`

- [ ] **Step 1: Write genreAgnosticism.test.ts (B10)**

Scans all non-test, non-fixture files in `game-creation/` for genre terminology. Uses word-boundary regex to avoid false positives. Must fail if any file contains genre strings.

Reference spec: "genreAgnosticism Test" (line 2206)

- [ ] **Step 2: Write tokenEstimate.test.ts (U5)**

Tests token cost estimation accuracy:
1. Empty plan has zero cost
2. Single scene_create step has zero cost (free operation)
3. Asset steps contribute 15 tokens each with 0.4 variance
4. Variance aggregation uses sqrt(sum of variances^2)
5. Insufficient balance produces warning message

- [ ] **Step 3: Run ALL tests**

Run: `cd web && npx vitest run src/lib/game-creation/`
Expected: All PASS (50+ tests across 8 test files)

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/game-creation/__tests__/
git commit -m "feat: add genre agnosticism and token estimate tests"
```

---

## Task 10: Quality Gate + Final Validation

- [ ] **Step 1: Run full quality gate**

```bash
cd web && npx eslint --max-warnings 0 src/lib/game-creation/ && npx tsc --noEmit
```

- [ ] **Step 2: Run full test suite (game-creation only)**

```bash
cd web && npx vitest run src/lib/game-creation/
```

Expected: 50+ tests, all PASS

- [ ] **Step 3: Verify acceptance criteria**

Check each of the 14 acceptance criteria from the spec (line 2283-2312) against the implementation.

- [ ] **Step 4: Final commit + push**

```bash
git push -u origin $(git branch --show-current)
```

---

## Implementation Notes

### Dependencies Between Tasks
- Task 0 (prerequisite) must complete first
- Task 1 (systems) must complete before Task 3 (planBuilder uses SYSTEM_REGISTRY)
- Task 5 (executor shared/registry) must complete before Task 6 (executors)
- Task 8 (fixtures) should complete before Task 9 (integration tests use fixtures)
- Tasks 2, 3, 4 can be parallelized (independent modules)

### Parallelization Strategy
These task groups are independent and can be dispatched to parallel agents:
- **Group A:** Task 0 + Task 1 (prerequisite + system registry)
- **Group B:** Task 2 (decomposer — only needs types.ts)
- **Group C:** Task 5 + Task 6 (executor framework + executors)

After Group A completes: Task 3 (planBuilder)
After Task 3 + Task 4: Task 7 (index)
After all lib code: Task 8 + Task 9 (fixtures + integration tests)
Final: Task 10 (quality gate)

### Key Gotchas from CLAUDE.md
- Use `@/lib/...` alias in vi.mock(), never relative paths
- `sanitizePrompt()` maxLength defaults to 500 — override to 1000 for decomposer
- `fetchAI` is the existing AI client — do NOT import provider SDKs directly
- Test files go in `__tests__/` directories (vitest workspace config)
- No `db.transaction()` — not relevant here (pure in-memory orchestration)
