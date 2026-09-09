---
name: review-protocol
description: "Use when dispatching code reviews, spec reviews, or PR reviews. Defines the 5 mandatory specialized reviewers, their domains, dispatch rules, and the PASS/FAIL cycle. Also lists all 13 agents and their configurations."
---

# Review Protocol — 5 Specialized Reviewers (Mandatory)

All specs, plans, and PRs go through **5 antagonistic specialized reviewers**. Reviews are PASS or FAIL only — any issue at any severity is a FAIL. Loop until all 5 pass clean.

## The 5 Reviewers

| Role | Agent Type | Focus |
|------|-----------|-------|
| **Architect** | `feature-dev:code-architect` | Structure, dependencies, scaling, monorepo, build pipeline |
| **Security** | `security-reviewer` | Injection, auth, data exposure, validation, XSS, CSRF |
| **DX** | `dx-guardian` | Developer workflow, onboarding, migration burden, documentation |
| **UX/Frontend** | `ux-reviewer` | Accessibility (WCAG AA), component UX, Tailwind, responsive |
| **Test** | `test-reviewer` | Coverage gaps, test weakening, CI gates, parameterization, visual regression (read-only — `test-writer` is the builder that WRITES tests and must never sit on the board) |

## Publishing the verdict

A verdict that lives only in a conversation is a verdict a PR does not show.
#9725 merged with two majors open for exactly that reason: CI was green, no
threads were unresolved, and nothing on the PR contradicted "ready". Both
blockers reached `main`.

So the board's result goes onto the PR, where it becomes the `review-board`
commit status next to CI:

```bash
bash scripts/post-board-verdict.sh <pr> <PASS|FAIL> <the sha the board reviewed> "<one-line summary>"
```

`.claude/workflows/review-board.js` runs this itself in its Publish phase; run
it by hand when the board was run by hand. Pass the sha the board **actually
reviewed**, not the current head — if a push landed mid-review they differ, and
`scripts/board-verdict.sh` then reports the verdict as stale rather than letting
it grade code no reviewer saw.

Until a verdict exists for the current head the status is `pending`, on purpose:
"nobody looked" and "someone looked and it was clean" must not render the same.

## Rules

- NEVER substitute a generic `code-reviewer` for the 5 specialized agents
- If M2 limits concurrency, dispatch in batches of 3 then 2 — all 5 MUST review
- Each reviewer dispatched as a separate background agent
- For CI/CD/infra changes: **6 reviewers** — add `infra-devops`
- For documentation changes: add `docs-guardian` (PASS/FAIL only)

## Agent Inventory (`.claude/agents/` — 13 agents)

All agents have: `memory`, `effort`, `model`, `tools`, `skills`, and agent-scoped `hooks` in frontmatter.

| Agent | Key Config | Trigger |
|-------|-----------|---------|
| `builder` | `isolation: worktree`, `memory: user` | Implementation tasks |
| `validator` | `mcpServers: playwright` | QA gate, validation suite |
| `planner` | `model: opus`, `memory: user` | Architecture, specs |
| `docs-guardian` | `background: true`, read-only | Doc review (PASS/FAIL) |
| `dx-guardian` | `background: true`, `model: haiku` | DX audits |
| `security-reviewer` | `background: true`, read-only | Security audits |
| `test-writer` | `memory: project`, writes + commits | Vitest + RTL tests (builder, NOT a reviewer) |
| `test-reviewer` | read-only, `block-writes.sh` | Test seat on the review board (PASS/FAIL) |
| `infra-devops` | `mcpServers: github` | Deploy, CI/CD |
| `ux-reviewer` | `background: true`, `mcpServers: playwright` | UX/a11y |
| `code-reviewer` | `background: true`, read-only | PR review |
| `docs-maintainer` | `memory: project` | Documentation |
| `rust-engine` | `mcpServers: context7` | Bevy ECS, WASM |

**All 5 reviewers** have: `background: true`, read-only tools, Stop hook validates PASS/FAIL, PreToolUse blocks writes.
**Agent teams:** Enabled via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings.json.
