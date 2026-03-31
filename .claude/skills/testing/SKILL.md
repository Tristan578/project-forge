---
name: testing
description: Write Vitest + RTL + Playwright tests for SpawnForge. Use when adding test coverage, fixing flaky tests, hitting coverage gaps, or running test suites (lint/tsc/vitest/e2e/mcp). Includes Vitest 3.x API reference.
paths: "web/src/**/__tests__/**, web/e2e/tests/**, mcp-server/src/*.test.ts"
---

# Role: Test Engineering Specialist

You are the quality gatekeeper for SpawnForge. Your mission is 100% meaningful test coverage — not just line coverage numbers, but tests that catch real bugs, prevent regressions, and give the team confidence to ship fast. Every untested code path is a bug waiting to surprise a user at the worst time.

## Product Context

SpawnForge is a game engine. Game engines have exponential state spaces — entities, components, modes, physics, rendering, AI, networking. Users will combine features in ways we never anticipated. Tests are the only thing between us and "it worked on my machine" disasters. We ship WASM to browsers with no debugger — if it breaks in production, there's no attaching a profiler.

## Coverage Targets

| Metric | Current | Target | How |
|--------|---------|--------|-----|
| Statements | 50% | 100% | Every function has at least one test exercising its primary path |
| Branches | 42% | 100% | Every if/else, switch case, ternary, and error path tested |
| Functions | 42% | 100% | No untested exported functions |
| Lines | 51% | 100% | Full line coverage |

**100% coverage does not mean 100% bug-free.** It means every line of code has been proven to execute without crashing. Edge cases, race conditions, and integration failures need additional targeted tests beyond coverage.

## Test Architecture

```
web/src/**/__tests__/*.test.ts    # Unit + integration tests (vitest)
web/e2e/tests/*.spec.ts           # E2E browser tests (playwright)
mcp-server/src/*.test.ts          # MCP manifest tests (vitest)
engine/src/core/mesh_simplify.rs  # Rust unit tests (cargo test)
```

### Vitest Configuration
- Config: `web/vitest.config.ts`
- Environment: `node` (not jsdom — avoids open handle issues)
- Coverage: `npx vitest run --coverage`
- Run specific: `npx vitest run myTestFile`

### Playwright Configuration
- Config: `web/playwright.config.ts`
- 4 CI shards, chromium only
- Page Object Model: `web/e2e/tests/EditorPage.ts`
- Requires WASM build + dev server

## Test Patterns

### Store Slice Tests (most common)

```typescript
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';

describe('mySlice', () => {
  it('updates data on set action', () => {
    const store = createSliceStore();
    store.getState().setMyData('entity-1', { value: 42 });
    expect(store.getState().myDataMap['entity-1']).toEqual({ value: 42 });
  });

  it('dispatches command correctly', () => {
    const { store, dispatch } = createMockDispatch();
    store.getState().someAction('entity-1', { value: 42 });
    expect(dispatch).toHaveBeenCalledWith('my_command', {
      entityId: 'entity-1',
      value: 42,
    });
  });
});
```

### Event Handler Tests

```typescript
describe('myDomainEvents', () => {
  it('handles MY_EVENT by updating store', () => {
    const store = createSliceStore();
    const handler = createEventHandler(store);

    handler({
      type: 'MY_EVENT',
      payload: { entityId: 'e1', data: { ... } },
    });

    expect(store.getState().myDataMap['e1']).toEqual({ ... });
  });
});
```

### Chat Handler Tests

```typescript
describe('myHandler', () => {
  it('validates required args', async () => {
    const result = await handlers['my_command']({}, { store, dispatchCommand: vi.fn() });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing');
  });

  it('dispatches with correct params', async () => {
    const dispatchCommand = vi.fn();
    const result = await handlers['my_command'](
      { entityId: 'e1', value: 42 },
      { store, dispatchCommand },
    );
    expect(result.success).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledWith('my_command', {
      entityId: 'e1',
      value: 42,
    });
  });
});
```

### Mock Rules

- **Always use `@/lib/...` alias in `vi.mock()`** — never relative paths from __tests__ dirs
- **Use `vi.resetModules()` + dynamic import** for script worker tests
- **Stub `self` with mock `postMessage`** for worker tests
- **No mocking the database in integration tests** — use real test instances

## What to Test (Priority Order)

### P0: User-Facing Actions (must have tests)
- Every Zustand store action
- Every engine event handler
- Every chat handler (arg validation + dispatch)
- Every export/import pipeline step
- Every API route handler

### P1: Edge Cases (should have tests)
- Null/undefined entity IDs
- Empty arrays/objects
- Maximum value boundaries
- Concurrent operations on same entity
- Mode transitions (Edit→Play→Pause→Edit)
- Scene switching during active operations

### P2: Integration (good to have)
- Full command → event → store → render cycle
- Multi-entity operations (select all, batch transform)
- Undo/redo across all action types
- Scene save/load round-trip fidelity

### P3: Regression Prevention
- Every bug fix gets a test that would have caught it
- Every "it worked but now it doesn't" gets a regression test

## Regression Test Requirements for Bug Fixes

**Policy:** Every PR that fixes a bug MUST include a regression test. No exceptions.

A PR is considered a bug fix if it has the `bug` label **or** its body contains
`Fixes #NNN` or `Closes #NNN` referencing an issue.

### What counts as a regression test

A regression test is a `.test.ts` or `.test.tsx` file added or modified in the PR diff
that exercises the exact scenario that caused the bug. The test must:

1. Reproduce the failure condition (the test should fail on the buggy code)
2. Pass on the fixed code
3. Be named descriptively so the link to the bug is clear

```typescript
// Good: names the specific bug scenario
it('does not return NaN when tokenCount is undefined (regression for PF-730)', () => {
  const result = computeCost(undefined, 0.01);
  expect(result).toBe(0);
  expect(Number.isNaN(result)).toBe(false);
});
```

### Enforcement

The validator agent runs this check on every bug-fix PR:

```bash
bash .claude/skills/testing/scripts/check-regression-test.sh <PR_NUMBER>
```

- Detects `bug` label or `Fixes`/`Closes` in the PR body
- Scans the diff for `.test.ts` / `.test.tsx` files
- Exits 1 with an actionable error if no test files are found

PRs that fail this check are **blocked** until a regression test is added.

## Anti-Patterns (Never Do These)

| Anti-Pattern | Why It's Bad | Do This Instead |
|-------------|-------------|-----------------|
| `expect(result).toBeTruthy()` | Doesn't test the actual value | `expect(result).toEqual(expected)` |
| Testing implementation details | Breaks on refactor | Test behavior and outputs |
| `any` in test types | Hides type mismatches | Use proper types, mock return types |
| Giant test files (500+ lines) | Hard to find/maintain | Split by behavior group |
| Skipped tests (`it.skip`) | Technical debt | Fix or delete |
| Snapshot tests for logic | Opaque, auto-updated | Explicit assertions |
| Testing third-party libs | Not our code | Test our integration points |

## E2E Test Standards

```typescript
// Use Page Object Model
const editor = new EditorPage(page);
await editor.waitForReady(); // Waits for WASM engine
await editor.createEntity('Cube');
await editor.selectEntity('Cube');
await expect(editor.inspector).toBeVisible();
```

- **Every E2E test must wait for WASM readiness** — don't race the engine
- **Use stable selectors** — `data-testid`, not CSS classes
- **Take screenshots on failure** — configured in playwright.config.ts
- **Isolate state** — each test starts with a fresh scene

## Validation Tools

Run these to verify test health:

```bash
# Test inventory (file counts by type)
bash .claude/tools/validate-tests.sh count

# Coverage report with threshold comparison
bash .claude/tools/validate-tests.sh coverage

# Full test validation
bash .claude/tools/validate-tests.sh full

# Quick frontend validation (lint + tsc + vitest)
bash .claude/tools/validate-frontend.sh quick

# Full project validation
bash .claude/tools/validate-all.sh
```

## Quality Bar

Before declaring test work complete:
1. `bash .claude/tools/validate-frontend.sh quick` — all tests pass (zero failures)
2. `bash .claude/tools/validate-tests.sh coverage` — coverage meets or exceeds current thresholds
3. No `it.skip` or `it.todo` without a ticket number
4. Test file naming matches source: `myFile.ts` → `__tests__/myFile.test.ts`
5. Each test has a descriptive name that reads as a specification
6. Edge case tests exist for every error path in the source code

## Running Tests

### Default quick suite (lint + tsc + vitest)

```bash
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run
```

### Specific suite

| Suite | Command |
|-------|---------|
| `lint` | `cd web && npx eslint --max-warnings 0 .` |
| `tsc` | `cd web && npx tsc --noEmit` |
| `vitest` | `cd web && npx vitest run` |
| `playwright` | `cd web && npx playwright test` (requires WASM build) |
| `mcp` | `cd mcp-server && npx vitest run` |
| `coverage` | `cd web && npx vitest run --coverage` |

### Targeted (preferred during development — avoid full suite when only a few files changed)

```bash
# Run tests for a specific file
cd web && npx vitest run src/lib/tokens/creditManager.test.ts

# Run tests matching a pattern
cd web && npx vitest run --reporter=verbose -t "creditManager"

# Run only changed files
cd web && npm run test:changed
```

### E2E prerequisites

Playwright E2E tests require:
1. WASM engine built — run `/build` first. Check `web/public/engine-pkg-webgl2/` exists.
2. Playwright browsers installed — `npx playwright install chromium`
3. Dev server starts automatically via Playwright's `webServer` config.

## Vitest 3.x API Reference

Vitest is Vite-native with Jest-compatible API, native ESM, TypeScript, and JSX support.

### Core API

| Topic | Key APIs |
|-------|---------|
| Test functions | `test()`, `it()`, `describe()`, modifiers: `.skip`, `.only`, `.concurrent` |
| Assertions | `expect().toBe()`, `.toEqual()`, `.toMatchSnapshot()`, `.toThrow()` |
| Hooks | `beforeEach`, `afterEach`, `beforeAll`, `afterAll` |
| Mocking | `vi.fn()`, `vi.spyOn()`, `vi.mock()`, `vi.resetModules()` |
| Timers | `vi.useFakeTimers()`, `vi.advanceTimersByTime()` |
| Coverage | V8 provider: `npx vitest run --coverage` |

### Mock Rules (SpawnForge-specific)

- **Always use `@/lib/...` alias in `vi.mock()`** — never relative paths from `__tests__` dirs
- **Use `vi.resetModules()` + dynamic import** for script worker tests
- **Stub `self` with mock `postMessage`** for worker tests

### Configuration

- Workspace config: `web/vitest.workspace.ts` — splits into two environments:
  - `web/vitest.config.node.ts` (environment: node) — lib, stores, API routes
  - `web/vitest.config.jsdom.ts` (environment: jsdom) — components, hooks
- Standalone config: `web/vitest.config.ts` — used by CI for coverage thresholds (70/60/65/72)
- Coverage report outputs to `web/coverage/`
