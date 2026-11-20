---
name: review-protocol
description: "Use when dispatching code reviews, spec reviews, or PR reviews. Defines the 5 mandatory specialized reviewers, their domains, dispatch rules, and the PASS/FAIL cycle. Also lists the agents and their configurations."
---

# Review Protocol — 5 Specialized Reviewers (Mandatory)

All specs, plans, and PRs go through **5 antagonistic specialized reviewers**. Each verdict is PASS or FAIL, never "pass with issues". The rules below decide what a seat may raise, what blocks, and when the loop stops.

## Start the review

```bash
python .claude/tools/review_board.py --base <verified-full-merge-base-sha> \
  --context <tracked-caller> --context <tracked-test>
```

An authorized operator selects the current base, commits the reviewed tree, and
supplies tracked callers, tests and dependencies needed to understand the fix.
Include the governing lessons and checklists when they apply. The launcher
pins HEAD, packages the Git diff and selected files, and opens each seat in a
fresh Claude Code process with every action tool disabled. It requires the
verified Claude Code release and an authorized Anthropic API credential.
Only the approved model endpoint receives the packet. The package is the seat's
read surface. Missing packet evidence blocks that seat.

Invoke this launcher from Claude Code or Codex. The old `/review-board` workflow
returns BLOCKED because its children inherit ambient capabilities. Standalone
role definitions provide checklists and do not authorize delivery verdicts.
The Bash denylist remains supplementary. A separate authorized operator may
collect scoped runtime evidence or publish a verdict after reviewing the result.

## Scope, severity and the round cap

These rules exist because an unscoped "any finding fails" board does not converge. Five adversarial seats always find one more nit or one more hypothetical, so every round produces a fix and the fix produces another round. That cost #10130 sixteen rounds, and on 2026-10-03 it cost #10298 sixteen rounds, #10294 twelve and #10307 nine, for one user's weekly budget. In the same period CI on all 16 open PRs stayed red on a one-line shared fix that nobody ported (lessons-learned #23).

1. **Scope is the diff and the code it touches.** A seat reviews the changed lines and the code they directly interact with: the changed files, plus the callers and callees of changed functions. These are not findings:
   - a pre-existing defect outside that scope;
   - a hypothetical the seat has not tied to a changed line;
   - a "while you're here" improvement.

   A seat that notices a real pre-existing bug records it in its findings. Verify the fix before completing the work. If the fix is blocked, keep the work incomplete.
2. **Use pinned evidence.** A seat requests missing verification from the authorized operator and identifies the affected line.
3. **Severity decides what blocks.**
   - `blocker` and `major` fail the board: a correctness or security defect in the diff, a broken or vacuous test of the changed code, or a claim in the PR that is false.
   - Describe minor findings precisely. Outstanding discovered issues keep the revision incomplete.
   - Seats that grade on their own scale map onto this one. A security finding rated CRITICAL, HIGH or MEDIUM is a `blocker` or `major`; a security defect is never `minor`, which is for wording, style and docs only. A UX finding rated CRITICAL or HIGH is a `blocker` or `major`; UX MEDIUM and LOW are `minor`.
   - An orchestrator `focus` narrows where a seat looks first. It never excuses a blocker or major elsewhere in the diff.
4. **Re-review prior findings.** Pass `--previous PATH` with the preceding local
   board result for the same batch. Clean verdicts can be reused within 24 hours
   while the packet, runtime and model match. A changed commit or packet
   requires fresh verdicts. Preserve all prior findings in the review input.
5. **Three rounds, then escalate.** Keep the local outputs outside the checkout
   and retain the previous result between rounds. After round 3, unresolved
   findings require root-cause work, a revised plan or an explicit blocker.
6. **Ready means the user's definition, checked first.** CI green on the head, review threads answered and resolved, and a board PASS. Read the PR's CI before spending anything on review. A failure shared across PRs (one red job on every PR) gets its fix ported into each PR, or merged once to main, before any board runs.

## The 5 Reviewers

| Role | Agent Type | Focus |
|------|-----------|-------|
| **Architect** | Snapshot architecture checklist | Structure, dependencies, scaling, monorepo, build pipeline |
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

An authorized operator runs this separately after inspecting the local board
result. Pass the sha the board **actually
reviewed**, not the current head — if a push landed mid-review they differ, and
`scripts/board-verdict.sh` then reports the verdict as stale rather than letting
it grade code no reviewer saw.

Until a verdict exists for the current head the status is `pending`, on purpose:
"nobody looked" and "someone looked and it was clean" must not render the same.

## Rules

- Never substitute a single generic reviewer for the 5 specialized agents
- If concurrency is limited, dispatch in batches of 3 then 2 — all 5 MUST review
- Run the board via `.claude/tools/review_board.py`.
- For CI/CD/infra changes: **6 reviewers** — add `infra-devops`
- For documentation changes: add `docs-guardian` (PASS/FAIL only)

## Agent Inventory (`.claude/agents/`)

All agents have: `model` (alias), `effort`, `memory`, `skills`, and agent-scoped `hooks` in frontmatter.

| Agent | Key Config | Trigger |
|-------|-----------|---------|
| `builder` | `isolation: worktree`, `memory: user` | Implementation tasks |
| `validator` | `mcpServers: playwright` | QA gate, validation suite |
| `planner` | `model: opus`, `memory: user` | Architecture, specs |
| `docs-guardian` | `model: haiku`, read-only | Doc review (PASS/FAIL) |
| `dx-guardian` | `model: haiku`, read-only | DX audits |
| `security-reviewer` | read-only | Security audits |
| `test-writer` | `memory: project`, writes + commits | Vitest + RTL tests (builder, NOT a reviewer) |
| `test-reviewer` | read-only, `block-writes.sh` | Test seat on the review board (PASS/FAIL) |
| `infra-devops` | `mcpServers: github` | Deploy, CI/CD |
| `ux-reviewer` | read-only | UX/a11y |
| `docs-maintainer` | `memory: project` | Documentation |
| `rust-engine` | `mcpServers: context7` | Bevy ECS, WASM |

The isolated review process exposes only structured output. Existing project
permission rules and shell hooks remain available on their separate paths.
