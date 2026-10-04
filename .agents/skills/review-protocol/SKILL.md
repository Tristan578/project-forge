---
name: review-protocol
description: "Use when dispatching code reviews, spec reviews, or PR reviews. Defines the 5 mandatory specialized reviewers, their domains, dispatch rules, and the PASS/FAIL cycle. Also lists all 13 agents and their configurations."
---

# Review Protocol — 5 Specialized Reviewers (Mandatory)

All specs, plans, and PRs go through **5 antagonistic specialized reviewers**. Each verdict is PASS or FAIL, never "pass with issues". The rules below decide what a seat may raise, what blocks, and when the loop stops.

## Scope, severity and the round cap

These rules exist because an unscoped "any finding fails" board does not converge. Five adversarial seats always find one more nit or one more hypothetical, so every round produces a fix and the fix produces another round. That cost #10130 sixteen rounds, and on 2026-10-03 it cost #10298 sixteen rounds, #10294 twelve and #10307 nine, for one user's weekly budget. In the same period CI on all 16 open PRs stayed red on a one-line shared fix that nobody ported (lessons-learned #23).

1. **Scope is the diff and the code it touches.** A seat reviews the changed lines and the code they directly interact with: the changed files, plus the callers and callees of changed functions. These are not findings:
   - a pre-existing defect outside that scope;
   - a hypothetical the seat has not tied to a changed line;
   - a "while you're here" improvement.

   A seat that notices a real pre-existing bug reports it under `followups` in its verdict, and the orchestrator files ONE GitHub issue per PR for all of them.
2. **No open-ended hunting.** A seat does not build scratch apps or harnesses, or run production builds, to search for new attack shapes. It may run one to CONFIRM a specific defect it has already tied to a changed line, and must say which line.
3. **Severity decides what blocks.**
   - `blocker` and `major` fail the board: a correctness or security defect in the diff, a broken or vacuous test of the changed code, or a claim in the PR that is false.
   - `minor` does not fail the board: wording, comment style, a missing nice-to-have test, docs drift. The builder fixes minors in the SAME push when they are cheap, or files them in the follow-up issue. A minor alone never triggers another round.
   - Seats that grade on their own scale map onto this one. A security finding rated CRITICAL, HIGH or MEDIUM is a `blocker` or `major`; a security defect is never `minor`, which is for wording, style and docs only. A UX finding rated CRITICAL or HIGH is a `blocker` or `major`; UX MEDIUM and LOW are `minor`.
   - An orchestrator `focus` narrows where a seat looks first. It never excuses a blocker or major elsewhere in the diff.
4. **A re-review covers the fix, not the PR again.** After round 1, the board reviews `git diff <last-reviewed-sha>..HEAD` and checks that the previous blocking findings are closed. Seats re-run as follows:
   - only the seats that failed, plus any seat whose domain the fix touches;
   - a comment-, docs- or test-only fix diff gets ONE seat on a cheaper model;
   - the security seat ALWAYS re-runs when the fix diff touches `web/src/lib/security/`, `web/src/app/api/`, auth, `web/src/lib/scripting/`, CSP, `.github/workflows/`, or a test that pins a security property. When a test-only fix diff touches such a test, the one cheap seat is the security seat.
5. **Three rounds, then stop.** A round is one board run against one head: all five seats in round 1, the re-run seats after that. `.claude/workflows/review-board.js` enforces this: pass `{round, since, seats, carried}` for a re-review (`since` = the sha the last round reviewed, `seats` = the seats to re-run, `carried` = the seats whose earlier PASS stands), and at `round: 4` it does not run at all and returns `STOP`. A re-review must account for every seat exactly once, re-run or carried. `carried` is the orchestrator's assertion and the workflow cannot verify it, so carry only a seat whose latest verdict on this PR was a PASS and whose domain the fix does not touch; the published line names the fix range, the re-run seats and the carried seats so a reader can check. If a PR still has a blocker or major after round 3, the orchestrator stops and brings it to the user with the open findings and a recommendation: fix, split, accept with a documented limit, or close. It does not start round 4 on its own.
6. **Ready means the user's definition, checked first.** CI green on the head, review threads answered and resolved, and a board PASS. Read the PR's CI before spending anything on review. A failure shared across PRs (one red job on every PR) gets its fix ported into each PR, or merged once to main, before any board runs.

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
bash scripts/post-board-verdict.sh <pr> <PASS|FAIL> <the sha the board reviewed> <reported>/<total seats> "<one-line summary>"
```

The seat count is part of the verdict (#10141). The board is five seats and a
PASS means all five looked, so the script refuses a PASS unless `5/5` seats
reported, and `scripts/board-verdict.sh` renders a PASS that carries a partial
count, or no count at all, as `pending` — never `success`. A reduced board can
post `FAIL 3/5`; it cannot post a pass.

After a reduced re-review round, the published count is the five seats' LATEST
verdicts: a seat that passed an earlier round on this PR and was not re-run
carries its PASS forward, and every re-run seat must pass the fix diff. So
`PASS 5/5` after round 2 means each seat's most recent review passed, not that
all five re-read the final head. Say which seats re-ran in the summary.

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
