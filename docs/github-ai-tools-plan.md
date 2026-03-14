# GitHub AI Tools Integration Plan for SpawnForge

> **Status**: Draft — awaiting review before implementation  
> **Date**: 2026-03-04  
> **Scope**: Copilot Coding Agent (custom agents, hooks) + GitHub Agentic Workflows (gh-aw)

---

## Current State Audit

### What we already have
| Asset | Location | Notes |
|-------|----------|-------|
| Copilot custom instructions | `.github/copilot-instructions.md` | Root-level project overview, build commands, architecture rules |
| Copilot file-scoped instructions | `.github/instructions/copilot.instructions.md` | Detailed coding standards, security, testing patterns (applies to `**`) |
| PR review instructions | `.github/instructions/review.instructions.md` | Architecture boundaries, security, perf review checklist |
| CI pipeline | `.github/workflows/ci.yml` | 7 jobs: lint, typecheck, web tests, MCP tests, WASM build, Next.js build, E2E, security audit |
| CD pipeline | `.github/workflows/cd.yml` | Deploy to Vercel on main |
| Dependabot | `.github/dependabot.yml` | Weekly updates for web/, mcp-server/, engine/, GitHub Actions |

### What's missing
- **No `.github/agents/`** — no custom Copilot coding agents defined
- **No `.github/hooks/`** — no hooks for Copilot coding agent sessions
- **No `.github/workflows/*.md`** — no GitHub Agentic Workflows (gh-aw)
- **No MCP server config** for Copilot coding agent (our MCP server could be leveraged)
- **Copilot instructions are stale** — references Bevy 0.16 (now 0.18), stale MCP command counts (now 322)

---

## Proposed Additions

### Phase 1: Copilot Coding Agent — Custom Agents

Custom agents are `.github/agents/<name>.md` Markdown files with YAML frontmatter. When someone assigns an issue to `@copilot` or invokes a specific agent, the coding agent uses these specialized prompts. Each agent gets its own ephemeral GitHub Actions environment with access to the repo.

#### Agent 1: `test-writer` — Test Coverage Specialist
**Purpose**: Assigned to issues like "Add tests for X component". Knows our Vitest/RTL patterns, mock conventions, coverage thresholds.

```
Location: .github/agents/test-writer.md
Triggers: Assign issue labeled `test` to @copilot, or @copilot /test-writer in PR
```

**What it knows**:
- Vitest + React Testing Library patterns from `web/src/test/utils/`
- Zustand store mocking via `vi.mock()` selector pattern
- Coverage thresholds in `web/vitest.config.ts` (currently 44/36/39/45)
- No snapshot tests, no `as any`, no flaky assertions
- Test file naming convention (`foo.test.ts` alongside source)

**Value**: We just finished Sprint 5 test coverage. Future test tasks (new components, regressions) can be assigned directly to Copilot with this agent providing strong guardrails.

#### Agent 2: `rust-engine` — Engine Development Specialist
**Purpose**: Assigned to Rust/WASM engine issues. Knows bridge isolation, Bevy ECS patterns, wasm-bindgen constraints.

```
Location: .github/agents/rust-engine.md
Triggers: Assign issue labeled `engine` or `rust` to @copilot
```

**What it knows**:
- Bridge isolation rule (only `engine/src/bridge/` imports web_sys/js_sys)
- Bevy 0.18 ECS patterns (Query, ResMut, EventReader)
- wasm32-unknown-unknown target constraints (no std::fs, std::net)
- `// SAFETY:` comment requirement for unsafe blocks
- Feature flags: webgl2/webgpu conditional compilation
- WASM binary size threshold (35MB per variant)

**Value**: The engine has zero tests and several known gaps (safety comments, bridge serialization). This agent can tackle those systematically.

#### Agent 3: `docs-maintainer` — Documentation Agent
**Purpose**: Keeps docs, README, and copilot instructions in sync with the codebase.

```
Location: .github/agents/docs-maintainer.md
Triggers: Assign issue labeled `docs` to @copilot
```

**What it knows**:
- `docs/` directory structure (architecture, coverage-plan, etc.)
- Copilot instructions locations and their purpose
- README structure and badge conventions
- ADR format for `docs/architecture/`

**Value**: Known gap — we need ADRs for Bevy selection, CRDT strategy, feature flag design. This agent can draft them from codebase context.

#### Agent 4: `security-reviewer` — Security & Compliance Agent
**Purpose**: Assigned to security-related issues or audits. Deep knowledge of our security posture.

```
Location: .github/agents/security-reviewer.md
Triggers: Assign issue labeled `security` to @copilot, or security campaign alerts
```

**What it knows**:
- `sanitizeChatInput()` prompt injection defense
- AES-256-GCM encryption for API keys
- Clerk auth requirements for API routes
- Zod validation requirements for chat handlers
- `cargo audit` / `npm audit` patterns

**Value**: Copilot coding agent has built-in CodeQL + secret scanning + dependency checking. Combined with our domain-specific security rules, it can fix security alerts from campaigns automatically.

---

### Phase 2: Copilot Coding Agent — Hooks

Hooks are `.github/hooks/*.json` files that run shell commands at key points during agent sessions (sessionStart, preToolUse, postToolUse, sessionEnd).

#### Hook 1: `validation.json` — Architecture Validator
**Purpose**: Runs our architecture validation checks after the agent makes changes.

```json
{
  "version": 1,
  "hooks": {
    "postToolUse": [
      {
        "type": "command",
        "bash": "./scripts/copilot-arch-check.sh",
        "cwd": ".",
        "timeoutSec": 30
      }
    ]
  }
}
```

The `copilot-arch-check.sh` script would:
- Verify no `web_sys`/`js_sys` imports outside `engine/src/bridge/`
- Verify no direct WASM calls outside `web/src/hooks/useEngine.ts`
- Run `npx eslint --max-warnings 0` on changed files
- Run `npx tsc --noEmit` to catch type errors before the agent commits

**Value**: Prevents the coding agent from violating our architecture boundaries, catching issues during the session rather than in CI after PR creation.

#### Hook 2: `session-setup.json` — Environment Bootstrap
**Purpose**: Ensures the agent's ephemeral environment is properly configured on session start.

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "bash": "cd web && npm ci --prefer-offline && cd ../mcp-server && npm ci --prefer-offline",
        "timeoutSec": 120
      }
    ]
  }
}
```

**Value**: Ensures `node_modules` is installed so the agent can run tests and linters during its session.

---

### Phase 3: GitHub Agentic Workflows (gh-aw)

Agentic Workflows are `.github/workflows/<name>.md` Markdown files that compile to Actions YAML via `gh aw compile`. They run AI agents (Copilot, Claude, Codex) on schedules or events with read-only permissions and safe outputs.

#### Workflow 1: `issue-triage.md` — Auto-Triage New Issues
**Purpose**: When a new issue is opened, analyze it and apply labels + priority.

```markdown
---
on:
  issues:
    types: [opened]
permissions:
  contents: read
  issues: read
safe-outputs:
  add-labels:
    allowed-labels: [bug, feature, engine, web, mcp, docs, test, security, P0, P1, P2]
  add-comment:
    max-length: 500
---

## Issue Triage

Analyze the new issue and classify it.

## Steps
1. Read the issue title and body
2. Determine which area of the codebase it relates to (engine/, web/, mcp-server/, docs/)
3. Classify as bug, feature, docs, test, or security
4. Assign a priority label (P0 = critical/blocking, P1 = important, P2 = nice-to-have)
5. Add relevant area labels
6. Add a brief comment summarizing the triage decision
```

**Value**: Automates first-response on new issues. Saves time on manual labeling.

#### Workflow 2: `ci-failure-diagnosis.md` — Diagnose CI Failures
**Purpose**: When CI fails on a PR, analyze the failure and post a diagnostic comment.

```markdown
---
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    conclusions: [failure]
permissions:
  contents: read
  actions: read
  pull-requests: read
safe-outputs:
  add-pr-comment:
    max-length: 2000
---

## CI Failure Diagnosis

Analyze the failing CI run and provide a helpful diagnosis.

## What to include
- Which job(s) failed
- Root cause analysis from the logs
- Suggested fix with specific file/line references
- Whether this is a flaky test or a real regression
```

**Value**: Monorepo CI has 7+ jobs across 3 ecosystems (Rust, TypeScript, Playwright). Diagnosing failures across these is time-consuming. This workflow reads logs and provides actionable guidance immediately.

#### Workflow 3: `weekly-health-report.md` — Repository Health Report
**Purpose**: Weekly summary of repo health as a GitHub issue.

```markdown
---
on:
  schedule:
    cron: "0 9 * * 1"  # Monday 9am UTC
permissions:
  contents: read
  issues: read
  pull-requests: read
  actions: read
safe-outputs:
  create-issue:
    title-prefix: "[health] "
    labels: [report]
    close-older-issues: true
---

## Weekly Repository Health Report

Create a concise health report for the SpawnForge team.

## What to include
- Open PRs and their age (flag stale PRs > 7 days)
- Open issues by label/priority breakdown
- CI pass rate over the past week
- Test coverage trend (reference web/vitest.config.ts thresholds)
- Dependabot PR backlog
- Recent releases and notable merges
- Action items for the coming week
```

**Value**: Provides a consistent Monday morning pulse check. Highlights stale PRs, dependency debt, and coverage trends without manual effort.

#### Workflow 4: `stale-pr-nudge.md` — Nudge Stale PRs
**Purpose**: Daily check for PRs that have been idle > 3 days without review.

```markdown
---
on:
  schedule:
    cron: "0 14 * * *"  # 2pm UTC daily
permissions:
  contents: read
  pull-requests: read
safe-outputs:
  add-pr-comment:
    max-length: 300
---

## Stale PR Nudge

Find open PRs that haven't had activity in 3+ days and leave a gentle reminder.

## Rules
- Only comment on PRs with no activity (comments, reviews, commits) in the last 3 days
- Do not comment on draft PRs
- Do not comment on PRs labeled "on-hold"
- Keep the message brief and constructive
- Do not nudge the same PR more than once per week
```

**Value**: Prevents PRs from going stale in a small team where context-switching is common.

#### Workflow 5: `doc-sync-check.md` — Documentation Drift Detection
**Purpose**: Weekly scan for documentation that's out of sync with code.

```markdown
---
on:
  schedule:
    cron: "0 10 * * 3"  # Wednesday 10am UTC
permissions:
  contents: read
  issues: read
safe-outputs:
  create-issue:
    title-prefix: "[doc-drift] "
    labels: [docs]
    close-older-issues: true
---

## Documentation Drift Detection

Scan for documentation that may be out of date.

## What to check
- .github/copilot-instructions.md vs actual Bevy version in engine/Cargo.toml
- .github/instructions/copilot.instructions.md MCP command count vs actual
- docs/coverage-plan.md thresholds vs web/vitest.config.ts actual thresholds
- README.md feature claims vs implemented features
- Any TODO/FIXME/HACK comments added in the last week
```

**Value**: We already have stale data in copilot instructions (now fixed: Bevy 0.18, 322 commands). This catches drift before it compounds.

---

## Phase 4: Enhance Existing Configuration

### 4a. Fix stale copilot instructions
- Update `.github/copilot-instructions.md`: verify Bevy 0.18 and 322 MCP commands
- Update `.github/instructions/copilot.instructions.md`: verify 322 MCP commands, Bevy 0.18
- Add coverage thresholds reference

### 4b. Consolidate copilot instructions
- `.github/copilot-instructions.md` (root) and `.github/instructions/copilot.instructions.md` overlap significantly. Consider merging into a single source of truth at `.github/copilot-instructions.md` (the root file that both Copilot Chat and coding agent read).

### 4c. Connect our MCP server to Copilot coding agent
- Configure the SpawnForge MCP server as an MCP integration for the coding agent, giving it access to engine commands during sessions. This is optional and advanced but could let the coding agent actually test engine commands.

---

## Implementation Priority

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| **P0** | Fix stale copilot instructions (4a) | 30 min | Immediate accuracy improvement |
| **P0** | `test-writer` agent | 1 hr | Enables delegating test issues to Copilot |
| **P1** | `rust-engine` agent | 1 hr | Addresses known engine test/safety gaps |
| **P1** | Architecture validator hook | 1 hr | Prevents agent boundary violations |
| **P1** | `issue-triage.md` agentic workflow | 1 hr | Automates issue labeling |
| **P1** | `ci-failure-diagnosis.md` agentic workflow | 1 hr | Saves debugging time on CI failures |
| **P2** | `docs-maintainer` agent | 45 min | Addresses ADR gap |
| **P2** | `security-reviewer` agent | 45 min | Leverages built-in CodeQL integration |
| **P2** | `weekly-health-report.md` workflow | 45 min | Team visibility |
| **P2** | `stale-pr-nudge.md` workflow | 30 min | Prevents PR rot |
| **P2** | `doc-sync-check.md` workflow | 45 min | Catches documentation drift |
| **P3** | Session setup hook | 30 min | QoL for agent environments |
| **P3** | Consolidate copilot instructions (4b) | 1 hr | Reduces maintenance burden |
| **P3** | MCP server integration for coding agent (4c) | 2-3 hrs | Advanced — agent can invoke engine commands |

---

## Prerequisites

1. **Copilot plan**: Ensure the repo/org has Copilot Pro, Pro+, Business, or Enterprise
2. **Copilot coding agent enabled**: Admin must enable the policy for the org/repo
3. **gh-aw CLI**: `gh extension install github/gh-aw` for compiling agentic workflows
4. **API keys for gh-aw engines**: Set repo secrets for whichever AI engine(s) we choose (Copilot uses built-in auth; Claude/Codex need API keys in secrets)

---

## Risk & Mitigation

| Risk | Mitigation |
|------|------------|
| Agent violates architecture boundaries | Architecture validator hook (Phase 2) catches during session; CI catches in PR |
| Agent produces low-quality code | Review instructions already in place; required human review before merge |
| Agentic workflow over-comments on issues/PRs | Safe outputs enforce limits; `max-length` and `close-older-issues` prevent noise |
| gh-aw is early/unstable | Start with read-only workflows (triage, reports) that only add labels/comments — no code changes |
| Action minutes consumption | Monitor usage; schedule workflows at off-peak times; use `concurrency` groups |

---

## File Tree (after implementation)

```
.github/
├── agents/
│   ├── test-writer.md          # Phase 1
│   ├── rust-engine.md          # Phase 1
│   ├── docs-maintainer.md      # Phase 1
│   └── security-reviewer.md    # Phase 1
├── hooks/
│   ├── validation.json         # Phase 2
│   └── session-setup.json      # Phase 2
├── workflows/
│   ├── ci.yml                  # Existing
│   ├── cd.yml                  # Existing
│   ├── issue-triage.md         # Phase 3 (+ .lock.yml)
│   ├── ci-failure-diagnosis.md # Phase 3 (+ .lock.yml)
│   ├── weekly-health-report.md # Phase 3 (+ .lock.yml)
│   ├── stale-pr-nudge.md       # Phase 3 (+ .lock.yml)
│   └── doc-sync-check.md       # Phase 3 (+ .lock.yml)
├── instructions/
│   ├── copilot.instructions.md # Existing (updated)
│   └── review.instructions.md  # Existing
├── copilot-instructions.md     # Existing (updated)
└── dependabot.yml              # Existing
```
