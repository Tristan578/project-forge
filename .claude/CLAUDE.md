# SpawnForge Constitution

## Product Vision

AI-powered "Canva for games" — web-based platform for creating 2D/3D games via natural language (Claude API) or manual editing. Games compile and run in browser. Subscription SaaS (Stripe).

## Core Architecture ("The Sandwich")

```
React Shell (Next.js 16, Zustand, Tailwind)  <- Editor UI + AI chat
    |  JSON events via wasm-bindgen
Bevy Editor Engine (Rust -> WASM)             <- Scene editing, rendering
    |
Game Runtime + TypeScript Scripting           <- Playing user-created games
```

## Rendering Strategy

- **Primary: WebGPU** (Bevy 0.18, wgpu 27) — auto-detected via `navigator.gpu`
- **Fallback: WebGL2** — for browsers without WebGPU
- **Two editor binaries** + **two runtime binaries** (via `runtime` feature) in `web/public/`
- **JS auto-selects** at runtime (`useEngine.ts`)
- **MUST include `tonemapping_luts` Bevy feature** — without it, materials render pink/magenta

## Key Libraries

| Library | Version | Notes |
|---------|---------|-------|
| Bevy | 0.18 | wgpu 27, WebGPU primary |
| bevy_rapier3d | 0.33 | `default-features=false`, features: `dim3`, `async-collider`, `debug-render-3d` |
| bevy_rapier2d | 0.33 | `default-features=false`, features: `dim2`, `debug-render-2d` |
| bevy_hanabi | 0.18 | GPU particles, WebGPU only (`webgpu` feature) |
| transform-gizmo-bevy | 0.9 (local fork) | Path dep at `.transform-gizmo-fork/`, patched for Bevy 0.18 |
| bevy_panorbit_camera | 0.34 | `yaw`/`pitch`/`radius` |
| csgrs | 0.20 | CSG booleans via BSP |
| noise | 0.9 | Procedural noise for terrain |
| Zustand | 5.x | React state |
| Next.js | 16.x | React framework |
| Clerk | — | Authentication |

## Build Commands

```powershell
# Full dual WASM build (WebGL2 + WebGPU):
powershell.exe -File ".\build_wasm.ps1"
```

```bash
cd web && npm run dev                    # Dev server (--webpack, NOT Turbopack)
cd web && npm run build                  # Production build
cd web && npx eslint --max-warnings 0    # Lint (ZERO warnings enforced)
```

### Verification Suite (run after every phase)
```bash
powershell.exe -File ".\build_wasm.ps1"             # WASM build
cd web && npx eslint --max-warnings 0                # Lint
cd web && npx tsc --noEmit                           # TypeScript
cd web && npx vitest run                             # Web tests
cd mcp-server && npx vitest run                      # MCP tests
python .claude/skills/arch-validator/check_arch.py   # Arch validator
```

- Do NOT use native `cargo check`/`cargo build` without `--target wasm32-unknown-unknown`
- Local testing without DB: use `http://spawnforge.localhost:1355/dev` (bypasses auth). Fallback: `http://localhost:3000/dev`

## Cargo Features

```toml
default = []
webgl2 = ["bevy/webgl2"]                    # WebGL2 backend
webgpu = ["bevy/webgpu", "dep:bevy_hanabi"] # WebGPU backend + GPU particles
runtime = []                                 # Strips editor-only systems for export
```

- `runtime`: gates via `#[cfg(not(feature = "runtime"))]` on system *registrations* in `bridge/mod.rs`, NOT function definitions
- `webgpu`: gates `bevy_hanabi` GPU rendering. Data types always compiled

## Workflow Rules

1. **Spec-First:** Never write implementation code without an approved spec in `specs/`
2. **Test-First:** Never write logic without a failing test case
3. **No Direct DOM:** Rust sends events to React via the bridge — never touches DOM
4. **Bridge Isolation:** Only `bridge/` may import `web_sys`/`js_sys`/`wasm_bindgen`. `core/` is platform-agnostic
5. **AI-Friendly Commands:** All capabilities expressible as JSON via `handle_command()`
6. **Update TESTING.md:** Add test cases for new user-facing features
7. **Update README.md:** When completing phases, adding MCP commands, changing build process, adding libraries
8. **Keep Context Current:** Update `.claude/rules/` and `MEMORY.md` as part of every iteration:
   - **New pitfall discovered?** Add to the relevant `rules/*.md` file immediately — don't wait
   - **Phase completed?** Update the Phase Roadmap table in this file
   - **MCP commands changed?** Update count in `MEMORY.md` "Current Stats"
   - **New library or API pattern?** Add to `rules/library-apis.md` or `rules/bevy-api.md`
   - **New EntitySnapshot field or EntityType variant?** Update `rules/entity-snapshot.md`
   - **New file or structural change?** Update `rules/file-map.md`
   - **Unsure if a pattern is stable?** Log in `MEMORY.md` "Session Learnings" first, promote to rules after confirmation
9. **Taskboard-Driven:** ALL work MUST be tracked on the taskboard (MCP server: `taskboard`). See Taskboard Rules below.
10. **Worktree Commit Safety:** When working in a git worktree (subagents, feature branches), **commit after every logical chunk of work** (each test file, each feature, each bug fix). Rate limits and crashes can kill agents at any time — uncommitted work is permanently lost. Never accumulate large uncommitted changesets.

## Taskboard Rules

The taskboard is the **single source of truth** for all project work. It is an MCP server connected to Claude Code.

### Mandatory Process
1. **No work without a ticket.** Before writing ANY code, a ticket MUST exist on the taskboard.
2. **Tickets move through columns:** `todo` → `in_progress` → `done`. Move tickets as work progresses.
3. **Every ticket MUST have:**
   - A **user story** in standard format: `As a [persona], I want [goal] so that [benefit]`
   - A **description** with technical context, spec references, and scope
   - **Acceptance Criteria** in Given/When/Then (GWT) format for testability
   - **Priority** (urgent, high, medium, low)
   - **Labels** for categorization (e.g., `bug`, `feature`, `refactor`, `test`, `docs`)
4. **Subtasks** for complex tickets — break into verifiable implementation steps.
5. **Projects** group related tickets (use for epics/initiatives, NOT individual tickets).

### Ticket Template

```
Title: [concise imperative action, e.g., "Fix detectPromptInjection return type mismatch"]

User Story:
As a [developer/user/admin], I want [specific goal] so that [measurable benefit].

Description:
[Technical context, affected files, root cause analysis, spec reference if applicable]

Acceptance Criteria:
- Given [precondition], When [action], Then [expected result]
- Given [precondition], When [action], Then [expected result]
- ...

Priority: [urgent/high/medium/low]
Labels: [bug/feature/refactor/test/docs]
```

### MCP Tools Available
| Tool | Usage |
|------|-------|
| `create_project` | Create epic/initiative |
| `create_ticket` | Create work item with title, description, priority, labels |
| `move_ticket` | Transition: todo → in_progress → done |
| `update_ticket` | Edit title, description, priority, labels, due date |
| `create_subtask` / `batch_create_subtasks` | Break ticket into steps |
| `toggle_subtask` | Mark subtask complete |
| `get_board` | View full Kanban board |
| `list_tickets` | Filter tickets by status/project |

### Web UI
Taskboard web UI: `http://taskboard.localhost:1355` (fallback: `http://localhost:3010`). Start with: `taskboard start --port 3010`

**Do NOT pass `--db .claude/taskboard.db`** — let the taskboard use its default OS path.

### Rules for Claude

#### Orchestrator vs. Subagent Permissions

**The orchestrator (main Claude session) owns ALL ticket lifecycle transitions.** Subagents MUST NOT call `move_ticket` or the REST `/move` endpoint.

| Actor | create_ticket | add subtasks | update description | move_ticket | edit metadata |
|-------|:---:|:---:|:---:|:---:|:---:|
| Orchestrator | yes | yes | yes | yes | yes |
| Builder agents | yes (bugs found) | yes (own ticket) | no | **NO** | **NO** |
| Review agents | yes (findings) | yes | yes (add findings) | **NO** | **NO** |

#### Before Dispatching Any Agent (Orchestrator Checklist)

1. Ensure taskboard is running: `curl -s http://taskboard.localhost:1355/api/board > /dev/null || taskboard start --port 3010 &`
2. Move the ticket to `in_progress` (orchestrator does this, not the agent)
3. Run sync-push: `python3 .claude/hooks/github_project_sync.py push`
4. Find the GitHub issue number: `gh issue list --search "PF-XXX in:title" --limit 1`
5. Include the ticket ID, GH issue number, and a `Closes #NNNN` template in the dispatch prompt

#### General Rules
- **Before starting work:** Check the board (`get_board`), pick a ticket, move to `in_progress`
- **Before creating ANY PR:** Run `python3 .claude/hooks/github_project_sync.py push` to sync tickets to GitHub. Find the GitHub issue number with `gh issue list --search "PF-XXX in:title" --limit 1`. Include `Closes #NNNN` (GitHub issue number) in the PR body. **CI will fail without this.**
- **After completing work:** Move ticket to `done`, verify acceptance criteria met
- **Discovering new work:** Create a ticket FIRST, then do the work
- **Bug found during development:** Create a bug ticket with reproduction steps in GWT format

## Code Quality (Brief)

**Zero tolerance for lint errors AND warnings.** See `.claude/rules/web-quality.md` for full ESLint rules and React patterns.

Key rules:
- `_` prefix for intentionally unused params
- No `useRef.current` during render (use `useState` prev-value pattern)
- No `Date.now()`/`Math.random()` during render
- Never blanket `eslint-disable` — use `eslint-disable-next-line` only
- Next.js cannot import outside `web/`. Keep `mcp-server/manifest/commands.json` synced to `web/src/data/commands.json`

## Phase Roadmap

53 core phases shipped, 2 removed (Collaboration PF-142, Multiplayer PF-141). Key capabilities:

- **Engine**: 3D + 2D rendering (WebGPU/WebGL2), physics (Rapier 3D+2D), skeletal animation, particles (Hanabi GPU), LOD, post-processing, CSG booleans, procedural terrain/mesh
- **Editor**: Material library (56 presets), visual scripting (73 node types), dialogue system, keyframe animation, in-game UI builder, tilemap editor, prefabs, multi-scene, starter system bundles (11 prepackaged system configurations with friendly genre labels)
- **AI**: 350 MCP commands (41 categories), compound AI actions, 5 asset generation providers, AI chat with streaming/approval/undo
- **Platform**: Stripe payments (4 tiers), cloud publishing, mobile PWA, 53 E2E spec files, 13,600+ unit tests
- **Removed**: Editor Collaboration (PF-142) and Multiplayer Networking (PF-141) — stubs removed, will rebuild when networking backend is ready

## New Component / Command Checklist

When adding a **new ECS component**, update these domain-scoped files:

### Rust Engine (4 files)
1. `engine/src/core/<component>.rs` — Component struct + marker (add `pub mod` in `core/mod.rs`)
2. `engine/src/core/pending/<domain>.rs` — Request structs + queue methods + bridge fns
3. `engine/src/core/commands/<domain>.rs` — Dispatch entry + handler function
4. `engine/src/bridge/<domain>.rs` — Apply system + selection emit (register in `bridge/mod.rs` SelectionPlugin::build())

### Rust Engine (supporting, if needed)
5. `engine/src/core/history.rs` — `UndoableAction` variant + `EntitySnapshot` field
6. `engine/src/core/entity_factory.rs` — delete/duplicate/undo/redo + `spawn_from_snapshot`
7. `engine/src/core/engine_mode.rs` — `snapshot_scene` (separate query param)
8. `engine/src/bridge/events.rs` — Emit function(s)
9. `engine/src/bridge/query.rs` — Query handler (if component has query support)

### Web Layer (4 files)
9. `web/src/stores/slices/<domain>Slice.ts` — State + actions (+ re-export from `slices/index.ts`)
10. `web/src/hooks/events/<domain>Events.ts` — Event handler(s)
11. `web/src/lib/chat/handlers/<domain>Handlers.ts` — Tool call handler(s) (registered in `executor.ts` handler registry)
12. `web/src/components/editor/<Inspector>.tsx` — Inspector panel

### Integration (5 files)
13. `web/src/components/editor/InspectorPanel.tsx` — Import + render
14. `web/src/components/chat/ToolCallCard.tsx` — Display labels
15. `mcp-server/manifest/commands.json` — MCP commands
16. `web/src/data/commands.json` — **COPY of #15** (keep in sync)
17. `TESTING.md` — Manual test cases

## Detailed Reference (in `.claude/rules/`)

| File | Contents |
|------|----------|
| `rules/bevy-api.md` | Bevy 0.18 API patterns, 0.16→0.18 migration notes, ECS limits, library APIs (rapier, hanabi, panorbit) |
| `rules/entity-snapshot.md` | EntityType, EntitySnapshot exhaustiveness, history, selection events |
| `rules/web-quality.md` | ESLint rules, React patterns, Next.js constraints, README update guide |
| `rules/library-apis.md` | csgrs, noise, serde-wasm-bindgen, terrain, texture pipeline, particles |
| `rules/file-map.md` | Engine structure, web structure, communication pattern |

## Agent Skills

### Review Protocol
All specs and PRs go through 4 antagonistic reviewers: Architect, Security, UX, DX.
Verdict is PASS or FAIL only — any issue at any severity is a FAIL.
Loop continues until all 4 pass clean. No shortcuts.

### Orchestration
- `/planner` — Architect flow, creates specs in `specs/`
- `/builder` — Implements specs into code, dispatches to domain skills
- `/cycle` — Plan -> Build -> Verify -> Update Context loop
- `/developer-experience` — DX audits, DoQ/DoD enforcement, cross-IDE consistency

### Agents (`.claude/agents/`)
| Agent | Trigger |
|-------|---------|
| `builder` | Implementation tasks, coding |
| `validator` | QA gate, full validation suite |
| `planner` | Architecture, spec creation |
| `dx-guardian` | DX audits, cross-IDE consistency |
| `security-reviewer` | Auth, injection, encryption, dependency audits |
| `test-writer` | Vitest + RTL tests, coverage gaps |
| `infra-devops` | Deploy, CI/CD, monitoring, Vercel, Cloudflare, Neon, Upstash, Sentry |
| `code-reviewer` | PR review, code audits, regression checks |
| `docs-maintainer` | Documentation updates, README, CLAUDE.md |
| `rust-engine` | Bevy ECS, bridge, WASM, engine/ code |

### Skills (33 total in `.claude/skills/`)

**Orchestration:** `/planner`, `/builder`, `/cycle`, `/developer-experience`
**Engine:** `/rust-engine`, `/build`, `/arch-validator`
**Web:** `/frontend`, `/mcp-commands`, `/next-best-practices`, `/vercel-react-best-practices`, `/web-accessibility`, `/web-design-guidelines`, `/game-ui-design`
**Testing:** `/testing` (knowledge), `/test` (action), `/vitest`, `/playwright-best-practices`
**Infrastructure:** `/infra-services`, `/troubleshoot`, `/kanban`, `/babysit-prs`, `/pr-code-review`, `/pr-green-machine`
**Features:** `/game-engine`, `/multiplayer-readiness`, `/db-migrate`, `/viewport`
**Workflow:** `/design`, `/architect-flow`, `/docs`, `/sync-push`, `/sync-pull`

### MCP Servers (`.mcp.json`)
- `context7` — live library documentation for all dependencies
- `neon` — direct Neon Postgres queries (needs `NEON_API_KEY`)

### Hooks (`.claude/hooks/`)
| Hook | Event | Purpose |
|------|-------|---------|
| `inject-lessons-learned.sh` | PreToolUse (Edit/Write/Bash) | Shows relevant anti-patterns before action |
| `inject-lessons-learned.sh` | PreToolUse (Edit/Write/Bash) | Shows relevant anti-patterns before action |
| `pre-push-quality-gate.sh` | PreToolUse (Bash: git push) | Runs lint+tsc on changed files before push |
| `verify-branch.sh` | PreToolUse (Edit/Write) | Prevents edits on wrong branch |
| `post-edit-lint.sh` | PostToolUse (Edit/Write) | Auto-lint after file changes |
| `check-arch.sh` | PostToolUse (Edit/Write) | Architecture boundary check |
| `post-commit-clean.sh` | PostToolUse (Bash) | Cleanup after git commits |
| `post-merge-doc-check.sh` | PostToolUse (Bash) | Doc freshness check after merges |
| `on-session-start.sh` | SessionStart | Taskboard state + sync |
| `on-prompt-submit.sh` | UserPromptSubmit | Taskboard context injection |
| `on-stop.sh` | Stop | Worktree safety commit + GitHub sync |
| `lessons-learned-reminder.sh` | Stop | Prompts agent to log lessons every 15 responses |
| `worktree-safety-commit.sh` | (called by on-stop.sh) | Auto-commit uncommitted worktree work |
| `sync-to-github.sh` | (called by on-stop.sh) | Background sync to GitHub |
| `sync-from-github.sh` | (not registered) | Manual GitHub → local sync |
| `taskboard-state.sh` | (not registered) | Manual taskboard state dump |

### Approved Specs (in progress)
- `specs/2026-03-25-game-creation-orchestrator-phase2a-v4.md` — Game Creation Orchestrator (systems-not-genres, 4x reviewer PASS)

### Validation Tools (`.claude/tools/`)
- `validate-rust.sh` — Architecture boundaries, bridge isolation, unsafe audit
- `validate-frontend.sh` — ESLint, TypeScript, vitest
- `validate-mcp.sh` — Manifest sync, MCP tests, AI parity audit
- `validate-tests.sh` — Test inventory, coverage report
- `validate-docs.sh` — Documentation integrity, version refs
- `dx-audit.sh` — Cross-IDE consistency, tool health, onboarding check
- `validate-all.sh` — Run all validators
