---
name: review-protocol
description: "Use when dispatching code reviews, spec reviews, or PR reviews. Defines the 5 mandatory specialized reviewers, their domains, dispatch rules, and the PASS/FAIL cycle. Also lists all 12 agents and their configurations."
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
| **Test** | `test-writer` | Coverage gaps, CI gates, parameterization, visual regression |

## Rules

- NEVER substitute a generic `code-reviewer` for the 5 specialized agents
- If M2 limits concurrency, dispatch in batches of 3 then 2 — all 5 MUST review
- Each reviewer dispatched as a separate background agent
- For CI/CD/infra changes: **6 reviewers** — add `infra-devops`
- For documentation changes: add `docs-guardian` (PASS/FAIL only)

## Agent Inventory (`.claude/agents/` — 12 agents)

All agents have: `memory`, `effort`, `model`, `tools`, `skills`, and agent-scoped `hooks` in frontmatter.

| Agent | Key Config | Trigger |
|-------|-----------|---------|
| `builder` | `isolation: worktree`, `memory: user` | Implementation tasks |
| `validator` | `mcpServers: playwright` | QA gate, validation suite |
| `planner` | `model: opus`, `memory: user` | Architecture, specs |
| `docs-guardian` | `background: true`, read-only | Doc review (PASS/FAIL) |
| `dx-guardian` | `background: true`, `model: haiku` | DX audits |
| `security-reviewer` | `background: true`, read-only | Security audits |
| `test-writer` | `memory: project` | Vitest + RTL tests |
| `infra-devops` | `mcpServers: github` | Deploy, CI/CD |
| `ux-reviewer` | `background: true`, `mcpServers: playwright` | UX/a11y |
| `code-reviewer` | `background: true`, read-only | PR review |
| `docs-maintainer` | `memory: project` | Documentation |
| `rust-engine` | `mcpServers: context7` | Bevy ECS, WASM |

**All 5 reviewers** have: `background: true`, read-only tools, Stop hook validates PASS/FAIL, PreToolUse blocks writes.
**Agent teams:** Enabled via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings.json.
