# Test Infrastructure Optimization

**Date:** 2026-03-20
**Status:** Draft
**Author:** Claude + Tristan
**Epic:** Test Infrastructure Optimization (3 phases)

---

## User Workflow

**Persona:** SpawnForge engineer adding a new game feature.

1. The engineer adds a new Zustand store slice and its test file.
2. They run `npm run test:changed` locally — only the changed files execute, completing in under 10 seconds instead of 5 minutes.
3. They push a PR. The CI pipeline runs the vitest workspace: pure-logic files execute in the fast `threads` pool, React component tests run in jsdom. The full suite completes in under 3 minutes.
4. The PR lands on `main`. A CI step reads `coverage-summary.json` and finds statement coverage is 2 points above the threshold. It automatically bumps the threshold and commits `chore: ratchet coverage thresholds`. Coverage now only goes up.
5. The next engineer who drops coverage below the new threshold sees a CI failure before merge — not after.
6. An engineer fixes a production bug (PF-NNN). The validator agent detects the `bug` label on the PR and checks for a new `.test.ts` file. No test found — the PR is blocked with a clear message: "Bug fix PRs require a regression test."
7. A week later, a script cross-references Vercel Analytics (top dispatched commands) with integration test coverage. It creates a ticket: "Integration test for `spawn_entity` missing — dispatched 2,400 times/week."

**Expected outcome:** Local feedback loops are fast. Regressions are caught before merge. Coverage is enforced automatically and ratchets upward over time.

---

## Problem Statement

SpawnForge has 584 test files and 12,300+ tests, but the infrastructure is slow and structurally wasteful:

- **98% of test files boot jsdom unnecessarily.** Only 12 files import React/testing-library, yet all 584 run in jsdom environment. Environment setup accounts for 8,000+ seconds of cumulative overhead.
- **Every file forks its own process.** `pool: 'forks'` gives maximum isolation but maximum cost. Pure-logic tests don't need process isolation.
- **Rust engine has 37 tests across 4 files** out of 98 source files. The entire command dispatch chain, entity factory, history system, and scene serialization are untested at the engine level.
- **No command-level integration tests.** User actions (UI), AI actions (MCP), and E2E tests (Playwright) all converge at `dispatchCommand()`, but nothing tests this convergence point directly.
- **Coverage thresholds are stuck at 55/45/50/55** with no automated mechanism to ratchet them upward.
- **No telemetry-informed testing.** Tests are written based on what developers think matters, not what users actually do.

## Success Criteria

- Local vitest runs complete in under 2 minutes (currently ~5 minutes)
- CI vitest completes in under 3 minutes (currently ~5.5 minutes)
- Web test coverage reaches 90/90/90/90 via auto-ratchet
- Rust engine test coverage reaches 90% (from ~5%)
- Every MCP command in `commands.json` has a corresponding integration test
- Bug-fix PRs must include a regression test (enforced by validator agent)
- Coverage only goes up — never backwards

## Architecture Decision: Phased Approach

Three independent phases, each shippable on its own. No phase blocks the others. Each phase produces its own tickets, PRs, and enforcement mechanisms.

---

## Phase 1: Speed

**Goal:** Cut local vitest run time by 3-4x. Zero new test logic — optimize what exists.

### 1a. Environment Consolidation (Gradual Per-Directory)

Replace single `vitest.config.ts` with a vitest workspace:

```
web/
  vitest.workspace.ts              ← Defines 2 projects
  vitest.config.node.ts            ← environment: 'node', pool: 'threads'
  vitest.config.jsdom.ts           ← environment: 'jsdom', pool: 'forks'
```

**Workspace routing:**

| Directory | Environment | Pool | Rationale |
|-----------|-------------|------|-----------|
| `src/lib/**` | node | threads | Pure logic, no DOM. 243 files. |
| `src/stores/**` | node | threads | Zustand store slices. 50 files. |
| `src/app/api/**` | node | threads | Route handlers. 99 files. |
| `src/components/**` | jsdom | forks | React components. 162 files. |
| `src/hooks/**` | jsdom | forks | React hooks. 24 files. |

Files in node directories that genuinely need jsdom get `// @vitest-environment jsdom` override.

**Rollout order:**
1. PR 1: `src/lib/` → node (243 files, lowest risk)
2. PR 2: `src/stores/` + `src/app/api/` → node (149 files)
3. PR 3: Wire workspace config, remove single vitest.config.ts
4. Each PR: run full suite, fix any failures before merging

**Expected impact:** ~392 files move to node environment (243 + 50 + 99). Environment overhead drops from ~8,000s to ~3,000s cumulative.

### 1b. Local Dev Default: `--changed`

Add scripts to `package.json`:

```json
{
  "test": "vitest run",
  "test:changed": "vitest run --changed",
  "test:watch": "vitest --changed"
}
```

**Agent enforcement:** Pre-dispatch checklist item #2 updated: agents use `npm run test:changed` during development loops, full `npm run test` only in the quality gate before PR creation.

### 1c. Auto-Ratchet Coverage

New CI step that runs **only on main after merge** (not on PR branches):

1. Read `coverage/coverage-summary.json` after test run
2. Parse current statement/branch/function/line percentages
3. Compare against thresholds in vitest workspace configs
4. If current exceeds threshold by >1%, floor to whole integer, update the config
5. Commit directly to main with message `chore: ratchet coverage thresholds`

**Ratchet algorithm details:**
- Runs only on `main` branch post-merge (avoids conflicts with PR authors)
- Floors bumps to whole integers (no fractional thresholds — avoids oscillation)
- 1% buffer: only bumps when current exceeds threshold by more than 1 full point
- Detects manual decreases via `git diff HEAD~1 -- vitest.config.*.ts` — if thresholds decreased, fail the CI step with a clear error message
- No race condition: runs sequentially on main (GitHub's merge queue serializes)

### 1d. Enforcement — Executable Tools

```
.claude/skills/testing/
  SKILL.md                                ← References all scripts below
  scripts/
    audit-test-environments.sh            ← Scans test files for environment mismatches
    enforce-changed-default.sh            ← Validates agents use --changed during dev
    ratchet-coverage.sh                   ← Reads coverage JSON, bumps thresholds

.claude/skills/vitest/
  SKILL.md                                ← Workspace routing rules, pool strategy
  scripts/
    validate-workspace-routing.sh         ← Verifies test files are in correct project
```

**SKILL.md cross-references:**
```markdown
## Tools
- @scripts/audit-test-environments.sh — scan for jsdom in node-only directories
- @scripts/ratchet-coverage.sh — auto-bump coverage thresholds after merge

## References
- @.claude/rules/web-quality.md — ESLint and test conventions
- @.claude/skills/vitest/SKILL.md — workspace config and pool strategy
- @.claude/agents/validator.md — runs these scripts as part of QA gate
```

**Hook integration:**
- `pre-push-quality-gate.sh` calls `audit-test-environments.sh` on changed test files
- Validator agent runs `validate-workspace-routing.sh` during PR review

---

## Phase 2: Parity

**Goal:** Build the command-level integration test layer and Rust engine test foundation. Achieve user/AI/playwright convergence and 90/90 coverage across the full stack.

### 2a. Command Test Harness

New directory: `web/src/__integration__/`

A lightweight harness that:
- Creates a real Zustand store (no mocks)
- Wires up a mock engine dispatch returning realistic responses (from recorded fixtures)
- Executes command sequences and asserts store state

```typescript
const harness = createTestHarness();
await harness.dispatch('spawn_entity', { entityType: 'Cube', name: 'MyCube' });
expect(harness.store.sceneGraph.nodes).toHaveProperty('entity-1');
```

**Directory structure:**
```
web/src/__integration__/
  harness.ts                        ← createTestHarness(), dispatch wrapper
  mockEngine.ts                     ← Maps command → response from fixtures
  fixtures/
    spawn_entity.json               ← Recorded real engine responses
    update_transform.json
    set_material.json
    ...
  commands/
    scene-crud.test.ts              ← Spawn, delete, duplicate, rename
    material-pipeline.test.ts       ← Set material, apply texture
    physics-setup.test.ts           ← Add physics, collider, joint
    ai-chat-flow.test.ts            ← MCP command → handler → dispatch → store
    export-pipeline.test.ts         ← Export flow end-to-end
```

### 2b. WASM Smoke Tier (CI Only)

Separate vitest workspace project (experimental — requires feasibility spike):
- Loads real WASM engine in node (`--experimental-wasm-modules`)
- Runs ~20 critical-path integration tests against the real engine
- Catches mock/real divergence
- Tagged `@smoke` for selective execution

Added to `vitest.workspace.ts` as a third project. Only included when `CI=true`.

**Feasibility constraint:** The WASM engine's init function may require browser APIs (`canvas`, `navigator.gpu`). If the feasibility spike shows node WASM loading isn't viable, fall back to Playwright-based smoke tests that load the real engine in a headless browser and exercise the same command sequences. Slower (~30s vs ~5s per test) but guaranteed to work.

### 2c. Rust Engine Test Foundation

**Three testing layers for the engine:**

| Layer | What | Tool | Speed |
|-------|------|------|-------|
| Pure logic | Commands, factory, history, serialization, payload builders | `cargo test` (native) | ms |
| Bridge behavior | Event emission, ECS reads, system orchestration | `cargo test` + mock emit harness | ms |
| WASM boundary | JsValue serialization, `handle_command()` round-trips | `wasm-bindgen-test` (headless Chrome) | seconds |

**Pure logic testing:**

Tests live in `#[cfg(test)] mod tests {}` blocks within each source file. For systems needing ECS, use `World::new()` with manual component insertion (headless, no renderer).

**Bridge testing — extract-and-test pattern:**

```rust
// Extract pure logic from bridge systems
fn build_material_payload(id: &EntityId, mat: &MaterialData) -> HashMap<String, Value> {
    // Pure logic — testable without wasm_bindgen
}

// Bridge system is thin glue
fn apply_material_changes(query: Query<(&EntityId, &MaterialData)>) {
    for (id, mat) in query.iter() {
        emit_event("material_changed", build_material_payload(id, mat));
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn material_payload_includes_all_fields() {
        let payload = build_material_payload(&test_id(), &test_mat());
        assert!(payload.contains_key("baseColor"));
    }
}
```

**Bridge testing — mock emit harness:**

```rust
#[cfg(test)]
thread_local! {
    static CAPTURED_EVENTS: RefCell<Vec<(String, serde_json::Value)>> = RefCell::new(vec![]);
}

#[cfg(test)]
fn test_emit_event(name: &str, payload: serde_json::Value) {
    CAPTURED_EVENTS.with(|events| events.borrow_mut().push((name.to_string(), payload)));
}
```

Swap `emit_event` for `test_emit_event` in test builds via feature flag or conditional compilation.

**WASM boundary testing:**

```rust
use wasm_bindgen_test::*;

#[wasm_bindgen_test]
fn handle_command_spawn_entity_returns_success() {
    let cmd = JsValue::from_str(r#"{"type":"spawn_entity","entityType":"Cube"}"#);
    let result = handle_command(cmd);
    // Assert result contains expected response
}
```

**Priority test targets** (by blast radius):

| Module | Files | Current Tests | Priority |
|--------|-------|---------------|----------|
| `core/commands/` | 11 | 0 | P0 — every action flows through here |
| `core/entity_factory.rs` | 1 | 0 | P0 — spawn/delete/undo/redo |
| `core/history.rs` | 1 | 0 | P0 — 29 undo variants |
| `core/scene_file.rs` | 1 | 0 | P0 — save/load data loss |
| `core/pending/` | 12 | 0 | P1 — command queue correctness |
| `bridge/events.rs` | 1 | 0 | P1 — event emission fidelity |
| `bridge/core_systems.rs` | 1 | 0 | P1 — selection, picking, transforms |

**Prerequisite: Gate bridge module behind wasm32 target**

The `bridge/` module imports `web_sys`, `js_sys`, and `wasm_bindgen`, which don't compile on native targets. Before `cargo test` can work, the bridge module must be conditionally compiled:

```rust
// engine/src/lib.rs
#[cfg(target_arch = "wasm32")]
pub mod bridge;

pub mod core; // Always compiles — pure Rust, no browser deps
```

This is a prerequisite ticket that must land before any Rust unit tests can run natively. The `core/` module is already platform-agnostic by design (per CLAUDE.md bridge isolation rule), so this gate formalizes what's already architecturally true.

**CI integration:**

```yaml
# quality-gates.yml
rust-unit-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
    - run: cargo test --manifest-path engine/Cargo.toml --lib

rust-wasm-bridge-tests:
  needs: [build-wasm]
  runs-on: ubuntu-latest
  steps:
    - run: wasm-pack test --headless --chrome engine/
```

The `--lib` flag runs only library unit tests (not integration tests or doc tests), keeping the native test scope to `core/` code.

### 2d. Command Surface Test Matrix

```
.claude/skills/testing/scripts/
  audit-command-coverage.sh         ← Reads commands.json, checks which have integration tests
  generate-test-stubs.sh            ← Creates stub test files for uncovered commands
  record-engine-fixtures.sh         ← Runs WASM, captures command responses to JSON
```

Output shows the ratio dynamically from `commands.json`, e.g.: `Command Coverage: 187/327 (57%). Missing: set_skeleton2d_skin, add_reverb_zone...`

New commands must ship with integration tests — `audit-command-coverage.sh` fails CI if coverage drops.

### 2e. Enforcement

| Strategy | Mechanism | Script |
|----------|-----------|--------|
| New commands need tests | CI step, fails if command coverage drops | `audit-command-coverage.sh` |
| Mock fidelity | WASM smoke tier catches divergence | vitest workspace `smoke` project |
| Fixture freshness | Compare fixture timestamps vs engine binary | `record-engine-fixtures.sh --check` |
| Rust coverage ratchet | `cargo-llvm-cov` in CI, auto-bump thresholds | `audit-rust-coverage.sh` |
| New command handlers need Rust tests | Validator agent checks | `validate-new-commands-have-tests.sh` |

**Updated skill/agent files:**
```
.claude/skills/testing/SKILL.md         ← Integration harness API, fixture recording
.claude/skills/rust-engine/SKILL.md     ← Test requirements per module, extract-and-test pattern
.claude/agents/validator.md             ← Rust coverage check, command matrix audit
```

---

## Phase 3: Intelligence

**Goal:** Tests evolve with the product. Usage data and production errors drive test priorities.

### 3a. Vercel Custom Events → Coverage Gap Analysis

Track feature usage via `@vercel/analytics` `track()`:

```typescript
import { track } from '@vercel/analytics';

// In panel open handlers
track('panel_open', { panel: 'gdd_generator' });

// In command dispatch
track('command_dispatch', { command: 'spawn_entity' });

// In AI generation
track('ai_generation', { type: 'sprite', provider: 'replicate' });
```

Script that cross-references usage with test coverage:

```
.claude/skills/testing/scripts/
  analyze-usage-coverage-gaps.sh    ← Queries Vercel Analytics API for top events,
                                       cross-references with integration test files
```

Output: "Users dispatch `spawn_entity` 2,400 times/week. Integration test exists: YES. Users dispatch `set_skeleton2d_skin` 89 times/week. Integration test exists: NO. → Create ticket."

### 3b. Sentry Error → Regression Test Pipeline

Every bug fix should produce a regression test. Automated scaffolding:

```
.claude/skills/testing/scripts/
  sentry-to-test-stub.sh            ← Takes Sentry issue ID, extracts stack trace
                                       and error context, generates test stub with
                                       reproduction setup
```

**Validator enforcement:** If a PR has a `bug` label or `Fixes` keyword, the validator checks for a new or modified test file. No test → flag.

### 3c. Coverage Dashboard

Generated in CI, committed to `docs/coverage/`:

```
.claude/skills/testing/scripts/
  generate-coverage-dashboard.sh    ← Markdown report:
                                       - Web coverage by directory (vitest)
                                       - Engine coverage by module (cargo)
                                       - Command coverage (integration matrix)
                                       - Trend over last 10 merges
                                       - Uncovered critical paths flagged
```

The `/testing` skill references this dashboard so agents see weakness before writing tests.

### 3d. Enforcement

| Strategy | Mechanism | Script |
|----------|-----------|--------|
| Bug fix → regression test | Validator checks PR labels + test files | Validator agent rule |
| Usage-informed testing | Weekly cron, creates tickets for top gaps | `analyze-usage-coverage-gaps.sh` |
| Coverage trend | Dashboard committed, ratchet prevents regression | `generate-coverage-dashboard.sh` |
| Sentry → test stub | Referenced in `/testing` skill | `sentry-to-test-stub.sh` |

---

## File Manifest

All new and modified files across the three phases:

### New Files

```
# Phase 1 — Speed
web/vitest.workspace.ts
web/vitest.config.node.ts
web/vitest.config.jsdom.ts
.claude/skills/testing/scripts/audit-test-environments.sh
.claude/skills/testing/scripts/enforce-changed-default.sh
.claude/skills/testing/scripts/ratchet-coverage.sh
.claude/skills/vitest/scripts/validate-workspace-routing.sh

# Phase 2 — Parity
web/src/__integration__/harness.ts
web/src/__integration__/mockEngine.ts
web/src/__integration__/fixtures/*.json
web/src/__integration__/commands/*.test.ts
.claude/skills/testing/scripts/audit-command-coverage.sh
.claude/skills/testing/scripts/generate-test-stubs.sh
.claude/skills/testing/scripts/record-engine-fixtures.sh
.claude/skills/testing/scripts/audit-rust-coverage.sh
.claude/skills/testing/scripts/validate-new-commands-have-tests.sh

# Phase 3 — Intelligence
.claude/skills/testing/scripts/analyze-usage-coverage-gaps.sh
.claude/skills/testing/scripts/sentry-to-test-stub.sh
.claude/skills/testing/scripts/generate-coverage-dashboard.sh
```

### Modified Files

```
# Phase 1
web/package.json                              ← Add test:changed, test:watch scripts
.claude/skills/testing/SKILL.md               ← Environment rules, --changed guidance, script refs
.claude/agents/validator.md                   ← Coverage ratchet check, environment audit
.claude/hooks/pre-push-quality-gate.sh        ← Call audit-test-environments.sh
project_lessons_learned.md                    ← Update checklist items #2, #26

# Phase 2
.github/workflows/quality-gates.yml           ← Add rust-unit-tests, rust-wasm-bridge-tests jobs
.claude/skills/rust-engine/SKILL.md           ← Test requirements, extract-and-test pattern
.claude/skills/testing/SKILL.md               ← Integration harness API, fixture recording
.claude/agents/validator.md                   ← Rust coverage, command matrix audit

# Phase 3
.claude/skills/testing/SKILL.md               ← Telemetry-driven testing guidance
.claude/agents/validator.md                   ← Bug PR regression test enforcement
web/src/components/editor/*.tsx               ← Add track() calls for panel usage
web/src/stores/slices/*.ts                    ← Add track() calls for command dispatch
```

---

## Ticket Breakdown

### Phase 1 Tickets

| ID | Title | Priority | Scope |
|----|-------|----------|-------|
| TBD | Switch `src/lib/` tests to node environment | high | 243 files |
| TBD | Switch `src/stores/` + `src/app/api/` tests to node environment | high | 149 files |
| TBD | Create vitest workspace config with node/jsdom projects | high | Config |
| TBD | Add `test:changed` and `test:watch` to package.json | medium | Config |
| TBD | Build auto-ratchet coverage CI step | high | CI |
| TBD | Create audit-test-environments.sh enforcement script | medium | Tooling |
| TBD | Create validate-workspace-routing.sh | medium | Tooling |
| TBD | Update testing/vitest skills with new conventions | medium | DX |

### Phase 2 Tickets

| ID | Title | Priority | Scope |
|----|-------|----------|-------|
| TBD | Build command integration test harness | high | Test infra |
| TBD | Record engine fixtures for top 50 commands | high | Fixtures |
| TBD | Write integration tests for scene CRUD commands | high | Tests |
| TBD | Write integration tests for material pipeline | high | Tests |
| TBD | Write integration tests for AI chat → command flow | high | Tests |
| TBD | Gate bridge module behind `#[cfg(target_arch = "wasm32")]` for native cargo test | high | Engine (prerequisite) |
| TBD | Add Rust unit tests for core/commands/ (11 files) | high | Engine |
| TBD | Add Rust unit tests for entity_factory + history | high | Engine |
| TBD | Add Rust unit tests for scene_file serialization | high | Engine |
| TBD | Build mock emit harness for bridge testing | medium | Engine |
| TBD | Add wasm-bindgen-test for handle_command boundary | medium | Engine |
| TBD | Build command coverage audit script | medium | Tooling |
| TBD | Add rust-unit-tests job to CI | high | CI |
| TBD | Build WASM smoke tier in vitest workspace | medium | Test infra |

### Phase 3 Tickets

| ID | Title | Priority | Scope |
|----|-------|----------|-------|
| TBD | Add Vercel custom event tracking to panels and commands | medium | Analytics |
| TBD | Build usage → coverage gap analysis script | medium | Tooling |
| TBD | Build sentry-to-test-stub script | medium | Tooling |
| TBD | Build coverage dashboard generator | low | Tooling |
| TBD | Add bug-fix regression test enforcement to validator | high | DX |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Environment switch breaks tests | Gradual per-directory rollout, full suite run between each PR |
| Threads pool causes shared-state bugs | Only used for node env tests (pure logic). jsdom keeps forks. |
| Mock engine drifts from real engine | WASM smoke tier catches divergence in CI |
| Rust tests slow down CI | Native `cargo test` is fast (~10s). wasm-bindgen-test runs in parallel job. |
| Auto-ratchet blocks legitimate PRs | 1% buffer before bump. Manual override available. |
| Coverage gaming (tests that assert nothing) | Validator agent reviews test quality, not just coverage numbers |

## Performance Targets

The test infrastructure itself must meet these speed targets:

| Metric | Target | Baseline (2026-03-20) |
|--------|--------|----------------------|
| Local vitest run (all tests) | < 2 minutes | ~5 minutes |
| CI vitest run | < 3 minutes | ~5.5 minutes |
| `cargo test` (native) | < 30 seconds | ~10 seconds |
| WASM smoke test tier (headless) | < 60 seconds per CI job | not yet measured |

The editor application must also meet these Core Web Vitals targets.
Any infrastructure change that adds build-time overhead must not regress these:

| Metric | Target | Notes |
|--------|--------|-------|
| LCP (Largest Contentful Paint) | < 2.5s | Editor initial load |
| CLS (Cumulative Layout Shift) | < 0.1 | Layout must not shift on WASM load |
| INP (Interaction to Next Paint) | < 200ms | Panel and inspector interactions |
| WASM engine load time | < 3s | Navigation to first engine command |
| Initial JS bundle (gzipped) | < 500KB | Measured with `next experimental-analyze` |

Measure application targets via Vercel Speed Insights on staging after Phase 3.

## Non-Goals

- Migrating to a different test framework (vitest stays)
- Removing existing tests (only adding/optimizing)
- 100% coverage (90/90 is the target — diminishing returns beyond that)
- Real-time telemetry dashboards (the coverage dashboard is a static markdown report)
