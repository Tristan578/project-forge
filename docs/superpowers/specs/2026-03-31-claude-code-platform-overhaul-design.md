# Claude Code Platform Overhaul — Design Spec

> **Status:** DRAFT — Awaiting approval
> **Date:** 2026-03-31
> **Author:** Claude + Tristan Nolan

## Summary

Full overhaul of SpawnForge's Claude Code automation infrastructure: 12 agents upgraded with memory/skills/hooks/MCP scoping, review board converted to antagonistic agent team with inter-reviewer debate, 9 priority skills enriched with scripts/references/templates, hook system expanded from 6 to 22 event types, Playwright + GitHub MCP servers added, context7 scoped per agent with enforced library lookups, and the entire suite packaged as an internal plugin for versioning and eventual marketplace distribution.

## Design Decisions (from brainstorming)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Review board model | Lead-synthesized (A) | Orchestrator remains lead, teammates debate directly |
| Plugin distribution | Internal first, marketplace later (C) | Product not stable enough for public plugin |
| Skill enrichment priority | Review board + builder (D) | Highest frequency — every PR cycle |
| Hook aggressiveness | Comprehensive (C) | AI-native product deserves AI-native tooling |
| MCP additions | Playwright + GitHub (A+B) | Skip self-hosted Sentry, skip Memory MCP |
| Agent memory | `memory: project` on reviewers, `memory: user` on builder/planner | Per-agent domain knowledge, not shared bucket |
| Doc verification | Instructions + references + context7 scoping (C) | Deterministic behavior on critical paths |

---

## 1. Agent Architecture Overhaul

### 1.1 All 12 Agents Get

- `memory: project` (reviewers, infra, docs) or `memory: user` (builder, planner)
- Explicit `tools` list (no more implicit inherit-all)
- `skills` preloading with enriched skills
- Agent-scoped hooks via frontmatter
- Scoped MCP + context7 library lists
- `effort` and `model` tuning

### 1.2 Agent Configuration Matrix

| Agent | Model | Effort | Memory | Tools | Scoped Hooks | MCP Scoped |
|-------|-------|--------|--------|-------|-------------|------------|
| security-reviewer | sonnet | high | project | Read, Grep, Glob, Bash, WebSearch, WebFetch | Stop: quality-gate, PreToolUse(Bash): block-writes | context7 (clerk, stripe, drizzle, upstash, zod) |
| architect-reviewer (code-reviewer) | sonnet | high | project | Read, Grep, Glob, Bash, WebSearch, WebFetch | Stop: quality-gate, PreToolUse(Bash): block-writes | context7 (next, ai, ai-sdk/react, zustand, tailwind) |
| ux-reviewer | sonnet | high | project | Read, Grep, Glob, Bash, WebSearch, WebFetch | Stop: quality-gate, PreToolUse(Bash): block-writes | context7 (radix-ui, tailwind, next/image, next/font), playwright |
| dx-guardian | haiku | medium | project | Read, Grep, Glob, Bash, WebSearch, WebFetch | Stop: quality-gate, PreToolUse(Bash): block-writes | context7 (vitest, playwright, eslint, typescript) |
| test-writer | sonnet | high | project | Read, Grep, Glob, Bash, WebSearch, WebFetch, Write, Edit | Stop: quality-gate | context7 (vitest, testing-library, playwright, msw) |
| docs-guardian | haiku | medium | project | Read, Grep, Glob, Bash, WebSearch, WebFetch | Stop: quality-gate, PreToolUse(Bash): block-writes | — |
| docs-maintainer | sonnet | medium | project | All | — | — |
| builder | sonnet | high | user | All | PostToolUse(Edit\|Write): post-edit-lint, Stop: builder-quality-gate | context7 (next, ai, zustand, drizzle, zod, tailwind), playwright, github |
| planner | opus | high | user | Read, Grep, Glob, Bash, WebSearch, WebFetch | Stop: spec-completeness-check | — |
| rust-engine | sonnet | high | project | All | PostToolUse(Edit\|Write): cargo-check | context7 (bevy, wasm-bindgen, serde) |
| infra-devops | sonnet | medium | project | All | — | github |
| validator | sonnet | high | project | All | — | playwright |

### 1.3 System Prompt Additions (all reviewers)

Every reviewer's SKILL.md gets this enforced directive:

```
MANDATORY: Before making claims about library APIs, method signatures,
or configuration options, verify against current documentation using
WebSearch or context7. Do not rely on training data. Your training data
is outdated — APIs change without warning.
```

---

## 2. Agent Team Review Board

### 2.1 Flow

1. Orchestrator spawns 5 reviewer teammates
2. Each reviews the diff independently (Phase 1)
3. Orchestrator broadcasts: "Share findings and challenge each other" (Phase 2)
4. Teammates debate directly via mailbox — architect questions security, DX questions UX, etc. (Phase 3)
5. Orchestrator synthesizes consensus: unanimous PASS or specific FAIL findings (Phase 4)
6. Report to user

### 2.2 Quality Enforcement (3 layers)

**Layer 1 — Agent frontmatter hooks:**
- `Stop` → `review-quality-gate.sh`: validates PASS/FAIL verdict, file references, actionable findings
- `PreToolUse(Bash)` → `block-writes.sh`: reviewers are read-only (cannot modify code)

**Layer 2 — settings.json hooks:**
- `SubagentStart` → `log-agent-start.sh`: observability
- `SubagentStop` → `validate-agent-output.sh`: output structure validation

**Layer 3 — Team hooks:**
- `TeammateIdle` → `reject-incomplete-review.sh`: exit code 2 if no verdict (sends reviewer back to work)
- `TaskCompleted` → `validate-task-completion.sh`: verify findings documented

### 2.3 Fallback

If agent teams are unstable, degrade to current sequential dispatch. Same agents, same skills, no inter-agent communication. The agent definitions work in both modes.

### 2.4 Settings Requirement

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

---

## 3. Skill Enrichment

### 3.1 Priority Skills (9 of 38)

Each gets scripts/, references/, and/or templates/ directories alongside SKILL.md.

**pr-code-review:**
- `scripts/diff-summary.sh` — extract changed files + line counts from git diff
- `scripts/check-test-coverage.sh` — verify changed files have corresponding test files
- `scripts/validate-pr-body.sh` — check `Closes #NNNN`, test plan section
- `references/review-checklist.md` — structured checklist (architecture, security, DX, UX, test)
- `references/common-antipatterns.md` — SpawnForge-specific patterns from lessons learned
- `references/docs-urls.md` — canonical doc URLs per domain (Vercel, Next.js, AI SDK, Clerk, etc.)
- `templates/review-report.md` — structured output template for PASS/FAIL reports

**arch-validator:**
- `scripts/check_arch.py` — existing, keep
- `scripts/boundary-check.sh` — verify bridge isolation (no web_sys in core/)
- `references/architecture-rules.md` — import boundaries, module responsibilities
- `references/import-boundaries.md` — allowed import paths per module

**testing:**
- `scripts/run-affected-tests.sh` — run only tests for changed files
- `scripts/coverage-diff.sh` — compare coverage before/after changes
- `references/test-conventions.md` — mock patterns, vitest workspace rules, anti-patterns
- `references/mock-patterns.md` — correct vi.mock paths, hoisted mocks, store mocking
- `templates/test-file-template.ts` — standard test file scaffold

**web-accessibility:**
- `scripts/axe-audit.sh` — run axe-core on a URL and report violations
- `references/wcag-checklist.md` — WCAG 2.1 AA checklist for game editors
- `references/aria-patterns.md` — correct ARIA for panels, dialogs, trees, toolbars

**frontend:**
- `scripts/component-scaffold.sh` — generate component + test + story file
- `references/react-patterns.md` — hooks rules, state patterns, memo guidelines
- `references/zustand-patterns.md` — slice template, store composition
- `references/nextjs-conventions.md` — App Router, Server Components, proxy.ts
- `templates/component-template.tsx` — standard component scaffold
- `templates/hook-template.ts` — standard hook scaffold

**rust-engine:**
- `scripts/cargo-check-wasm.sh` — cargo check with wasm32 target
- `references/bevy-api.md` — symlink to existing `.claude/rules/bevy-api.md`
- `references/bridge-isolation-rules.md` — what can/cannot import web_sys

**db-migrate:**
- `scripts/schema-diff.sh` — show diff between schema.ts and live DB
- `scripts/migration-validate.sh` — verify migration file exists for schema changes
- `references/neon-http-gotchas.md` — transaction rules, tagged template returns
- `references/transaction-patterns.md` — correct INSERT-before-UPDATE ordering
- `templates/migration-template.sql` — standard migration scaffold

**build:**
- `scripts/build-wasm.sh` — wraps existing build_wasm.ps1 for cross-platform
- `references/build-troubleshooting.md` — common build failures and fixes

**mcp-commands:**
- `scripts/manifest-sync-check.sh` — verify mcp-server/manifest matches web/src/data
- `references/command-schema.md` — required fields, visibility rules
- `references/handler-registry.md` — how handlers are registered in executor.ts
- `templates/command-template.json` — standard command manifest entry

### 3.2 context7 Library Scoping

Each agent's system prompt specifies which libraries to query via context7. Enforced by instruction, not by MCP server scoping (context7 doesn't support per-library filtering at the server level).

| Agent | Libraries |
|-------|-----------|
| security-reviewer | @clerk/nextjs, stripe, drizzle-orm, @upstash/redis, zod |
| architect-reviewer | next, ai, @ai-sdk/react, zustand, tailwindcss |
| ux-reviewer | @radix-ui/react, tailwindcss, next/image, next/font |
| dx-guardian | vitest, playwright, eslint, typescript |
| test-writer | vitest, @testing-library/react, playwright, msw |
| builder | next, ai, zustand, drizzle-orm, zod, tailwindcss |
| rust-engine | bevy, wasm-bindgen, serde |

---

## 4. Hook Modernization

### 4.1 Event Coverage: 6 → 22

**Keep (6):** PreToolUse, PostToolUse, SessionStart, UserPromptSubmit, Stop (upgraded)

**Add (16):** FileChanged, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, TeammateIdle, PreCompact, PostCompact, StopFailure, PermissionRequest, ConfigChange, InstructionsLoaded, Notification, Elicitation, WorktreeCreate

### 4.2 New Hook Scripts (16)

| Script | Event | Lines (est.) | Purpose |
|--------|-------|-------------|---------|
| `auto-lockfile-sync.sh` | FileChanged(package.json) | 15 | npm install on package.json change |
| `env-change-warning.sh` | FileChanged(.env*) | 10 | Warn on env file changes |
| `log-agent-start.sh` | SubagentStart | 10 | Timestamp + type logging |
| `validate-agent-output.sh` | SubagentStop | 40 | Verify PASS/FAIL structure |
| `validate-task-metadata.sh` | TaskCreated | 20 | Required task fields |
| `validate-task-completion.sh` | TaskCompleted | 30 | Verify deliverables |
| `reject-incomplete-review.sh` | TeammateIdle | 25 | Exit 2 if no verdict |
| `save-critical-context.sh` | PreCompact | 30 | Dump key decisions |
| `restore-context-hints.sh` | PostCompact | 20 | Inject decision reminders |
| `rate-limit-backoff.sh` | StopFailure(rate_limit) | 15 | Log + suggest retry |
| `auto-approve-safe-commands.sh` | PermissionRequest | 35 | Auto-approve npm/npx/git |
| `detect-settings-drift.sh` | ConfigChange | 20 | Alert on unexpected changes |
| `inject-dynamic-context.sh` | InstructionsLoaded | 25 | Branch/PR-aware context |
| `slack-notify-idle.sh` | Notification(idle_prompt) | 15 | Webhook on idle |
| `validate-mcp-input.sh` | Elicitation | 15 | MCP input validation |
| `worktree-setup.sh` | WorktreeCreate | 20 | Auto-configure worktree |

### 4.3 Upgraded Existing Hooks

| Hook | Change |
|------|--------|
| `post-edit-lint.sh` | Move from global PostToolUse to builder agent-scoped only |
| `auto-lockfile-sync.sh` | Replace PostToolUse trigger with FileChanged trigger |

### 4.4 Agent-Scoped Hooks (in frontmatter)

| Agent | Event | Script |
|-------|-------|--------|
| All reviewers (5) | Stop | `review-quality-gate.sh` |
| All reviewers (5) | PreToolUse(Bash) | `block-writes.sh` |
| builder | PostToolUse(Edit\|Write) | `post-edit-lint.sh` |
| builder | Stop | `builder-quality-gate.sh` |
| planner | Stop | `spec-completeness-check.sh` |
| rust-engine | PostToolUse(Edit\|Write) | `cargo-check-wasm.sh` |

---

## 5. MCP Server Additions

### 5.1 New Global Servers

```json
{
  "mcpServers": {
    "context7": { /* existing */ },
    "neon": { /* existing */ },
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    },
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic-ai/github-mcp@latest"]
    }
  }
}
```

---

## 6. Plugin Packaging

### 6.1 Structure

```
.claude-plugin/
└── plugin.json

agents/          # 12 agent definitions
skills/          # 38 skills (9 enriched)
hooks/
└── hooks.json   # 22 hook configurations
.mcp.json        # 4 MCP servers
settings.json    # Default settings (agent teams enabled)
```

### 6.2 Migration Path

1. Build everything in `.claude/` (current location)
2. Test over 2-3 sessions
3. Create plugin wrapper, restructure dirs
4. Test with `--plugin-dir`
5. When stable, submit to marketplace

---

## 7. Implementation Phases

### Phase 1: Foundation (agents + hooks + MCP)
- Upgrade 12 agent frontmatter (memory, tools, effort, model, skills)
- Add Playwright + GitHub MCP to `.mcp.json`
- Write 16 new hook scripts
- Configure 22 hooks in settings.json
- Add agent-scoped hooks to frontmatter
- Enable agent teams in settings

### Phase 2: Skill Enrichment
- Enrich 9 priority skills with scripts/references/templates
- Add context7 library instructions to each agent's system prompt
- Add doc verification directive to all reviewer prompts

### Phase 3: Agent Team Integration
- Build review board team orchestration
- Test antagonistic debate flow
- Implement TeammateIdle/TaskCompleted quality gates
- Test fallback to sequential dispatch

### Phase 4: Plugin Packaging
- Create `plugin.json` manifest
- Restructure dirs to plugin layout
- Test with `--plugin-dir`
- Document in README

---

## Acceptance Criteria

- [ ] All 12 agents have memory, explicit tools, effort, scoped hooks
- [ ] Review board runs as agent team with 5 debating reviewers
- [ ] TeammateIdle hook rejects incomplete reviews
- [ ] 9 priority skills have scripts/references/templates (not just markdown)
- [ ] 22 hook events configured and tested
- [ ] Playwright and GitHub MCP servers connected
- [ ] Each reviewer's system prompt enforces doc verification via WebSearch/context7
- [ ] Plugin packaged and testable via `--plugin-dir`
- [ ] Fallback to sequential review dispatch works when agent teams are disabled
- [ ] All hook scripts have exit code handling per Anthropic spec (0=success, 2=block)

## Test Plan

- [ ] Spawn review team on a real PR — verify debate occurs between teammates
- [ ] Trigger TeammateIdle with incomplete review — verify exit code 2 sends reviewer back
- [ ] Builder agent edits a file — verify PostToolUse lint hook fires
- [ ] Reviewer agent attempts `git push` — verify PreToolUse block-writes prevents it
- [ ] Change package.json — verify FileChanged triggers lockfile sync
- [ ] Compact a long session — verify PreCompact saves and PostCompact restores context
- [ ] Run `--plugin-dir` with the packaged plugin — verify all components load
- [ ] Disable agent teams env var — verify review board falls back to sequential
