---
name: claude-platform-reference
description: "Use when you need details about SpawnForge's Claude Code platform setup — hooks, skills inventory, MCP servers, validation tools, or plugin config. Reference for the automation infrastructure."
---

# Claude Code Platform Reference

## Skills (~28 custom + 19 marketplace)

**Orchestration:** `/planner`, `/builder`, `/cycle`
**Engine:** `/rust-engine`, `/build`, `/arch-validator`, `/rust-best-practices`
**Web:** `/frontend`, `/mcp-commands`, `/web-accessibility`, `/shadcn`, `/vercel-react-best-practices`, `/vercel-composition-patterns`, `/vercel-react-view-transitions`
**Next.js:** `/next-best-practices`, `/next-cache-components`, `/next-upgrade`
**Testing:** `/testing`, `/playwright-best-practices`, `/tdd`
**Infrastructure:** `/infra-services`, `/troubleshoot`, `/kanban`, `/babysit-prs`, `/pr-code-review`, `/pr-green-machine`, `/env-health-check`, `/changelog-review`, `/deploy-to-vercel`, `/resolve-pr-comments`, `/api-middleware-migrate`
**Database:** `/db-migrate`, `/neon-postgres`, `/claimable-postgres`
**Deployment:** `/deploy-engine` (user-only)
**Billing:** `stripe-webhooks` (background, auto-loads on billing edits)
**Features:** `/game-engine`, `/multiplayer-readiness`, `/viewport`
**Workflow:** `/design`, `/architect-flow`, `/docs`, `/developer-experience`
**Review:** `/review-protocol`, `/component-checklist`

Marketplace skills live in `.agents/skills/` with symlinks in `.claude/skills/`. Managed via `npx skills add/ls/update`.

## MCP Servers (`.mcp.json` — 4 servers)
- `context7` — live library documentation for all 30+ dependencies
- `neon` — direct Neon Postgres queries (needs `NEON_API_KEY`)
- `playwright` — browser automation for E2E verification
- `github` — GitHub API access for PR/issue/Actions operations

## Hooks (`.claude/hooks/` — 40+ scripts, 18 event types)

**Event types:** PreToolUse, PostToolUse, SessionStart, SessionEnd, UserPromptSubmit, Stop, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, TeammateIdle, PreCompact, PostCompact, StopFailure, ConfigChange, InstructionsLoaded, WorktreeCreate, CwdChanged, PostToolUseFailure

| Hook | Event | Purpose |
|------|-------|---------|
| `inject-lessons-learned.sh` | PreToolUse (Edit/Write/Bash) | Anti-patterns before action |
| `pre-push-quality-gate.sh` | PreToolUse (git push) | Lint+tsc before push |
| `block-main-commits.sh` | PreToolUse (git commit) | Prevents commits on main |
| `verify-branch.sh` | PreToolUse (Edit/Write) | Prevents edits on wrong branch |
| `check-db-transaction.sh` | PreToolUse (Edit/Write) | Warns on db.transaction() |
| `review-quality-gate.sh` | Stop (reviewers) | Validates PASS/FAIL verdict |
| `block-writes.sh` | PreToolUse (reviewers) | Reviewers are read-only |
| `builder-quality-gate.sh` | Stop (builder) | Verifies lint+tests ran |
| `cargo-check-wasm.sh` | PostToolUse (rust-engine) | Cargo check after .rs edits |
| `validate-agent-output.sh` | SubagentStop | Verify reviewer output |
| `reject-incomplete-review.sh` | TeammateIdle | Exit 2 if no verdict |
| `save-critical-context.sh` | PreCompact | Dump decisions before compaction |
| `restore-context-hints.sh` | PostCompact | Inject context after compaction |
| `on-session-start.sh` | SessionStart | Taskboard state + sync |
| `on-stop.sh` | Stop / SessionEnd | Worktree safety commit + GitHub sync |

## Validation Tools (`.claude/tools/`)
- `validate-rust.sh` — Architecture boundaries, bridge isolation, unsafe audit
- `validate-frontend.sh` — ESLint, TypeScript, vitest
- `validate-mcp.sh` — Manifest sync, MCP tests, AI parity audit
- `validate-tests.sh` — Test inventory, coverage report
- `validate-docs.sh` — Documentation integrity, version refs
- `dx-audit.sh` — Cross-IDE consistency, tool health, onboarding check
- `validate-all.sh` — Run all validators

## Plugin (`.claude-plugin/plugin.json`)
Internal plugin manifest. Test with `claude --plugin-dir .`

## Approved Specs
- `specs/2026-03-25-game-creation-orchestrator-phase2a-v4.md` — Game Creation Orchestrator (systems-not-genres)
