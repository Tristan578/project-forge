---
name: pr-green-machine
description: Drive all open PRs to merge-ready state — fixes CI failures, resolves Sentry comments, clears merge conflicts. Use when multiple PRs need to go green or when asked to "clean up PRs", "fix all PRs", or "make PRs mergeable".
context: fork
---

# PR Green Machine

Drive every open PR to GREEN — CI passing, Sentry resolved, conflicts gone — one at a time, oldest to newest.

## Core Principle

**Evidence before assertions.** Never claim a PR is green without running the checks. Never assume a cached CI result is current. Never skip a validation domain because "it probably passes." Every claim must have a command output backing it.

## Pipeline (per PR)

### Phase 1: Triage

1. `gh pr view <N> --json headRefName,baseRefName,mergeable,mergeStateStatus,statusCheckRollup`
2. Check base branch: `gh pr view <N> --json baseRefName --jq .baseRefName` — if wrong, fix with `gh pr edit <N> --base main`
3. Check merge conflicts: if CONFLICTING, rebase onto the correct base and force-push
4. Check unreplied Sentry comments — count them
5. Check CI status — list all failing checks with `gh pr checks <N>`

Output a triage summary table:
```
| Check          | Status  | Action Needed |
|----------------|---------|---------------|
| Base branch    | main    | OK / WRONG    |
| Merge conflicts| YES/NO  | Rebase needed |
| CI checks      | X pass, Y fail | Fix failures |
| Sentry comments| N unreplied | Review + fix/reply |
```

### Phase 2: Code Review

Dispatch a code-review agent (use `/pr-code-review <N>`) that:
- Reads the FULL diff and every changed file in context
- Checks for: logic errors, security, API contracts, performance, conventions
- Cross-references against `project_lessons_learned.md` (45+ anti-patterns)
- Verifies findings against actual code before reporting
- Posts findings as a GitHub PR comment (not APPROVE/REQUEST_CHANGES)

### Phase 3: Root-Cause Analysis

For every failing CI check:
1. `gh run view <RUN_ID> --log-failed` — read the actual error
2. Identify the root cause (not the symptom)
3. Check lessons learned for known patterns (e.g., #29 action versions, #15 maxDuration, #1 panelRegistry)

For every unreplied Sentry comment:
1. Read the full comment body
2. Read the file at the reported location
3. Classify: real bug, false positive, or already fixed
4. If real: plan the fix. If false positive: draft the reply with evidence.

### Phase 4: Multi-Domain Validation (Pre-Fix)

Before writing any fix, validate current state across all domains:

```bash
# Architecture
python3 .claude/skills/arch-validator/check_arch.py 2>/dev/null || echo "SKIP (no engine changes)"

# TypeScript
cd web && npx tsc --noEmit

# Lint
cd web && npx eslint --max-warnings 0 .

# Unit tests (targeted to changed files)
cd web && npx vitest run <changed-test-dirs>

# MCP tests
cd mcp-server && npx vitest run
```

Record which checks pass and which fail BEFORE making changes. This is the baseline.

### Phase 5: Fix

Apply fixes for:
1. All code review findings (bugs and nits)
2. All CI root causes
3. All valid Sentry findings
4. All pre-existing issues found in changed files

Rules:
- Commit after each logical fix (not batched)
- Run targeted lint + tsc after each edit
- Reply to every Sentry comment with: commit SHA (fixed), PF-ticket (deferred), or technical explanation (false positive)
- No banned phrases without a ticket: "will fix later", "known issue", "out of scope"

### Phase 6: Multi-Domain Validation (Post-Fix)

Re-run ALL checks from Phase 4. Every check that was green before must still be green. Every check that was red must now be green.

```bash
cd web && npx tsc --noEmit
cd web && npx eslint --max-warnings 0 .
cd web && npx vitest run
cd mcp-server && npx vitest run
```

If ANY check regresses, go back to Phase 5. Do not push until local validation is fully green.

### Phase 7: Push + CI Babysit

1. Push the fixes
2. Wait for CI to start: `gh pr checks <N>`
3. Monitor until ALL checks complete — do not move on while checks are pending
4. If any check fails:
   - `gh run view <RUN_ID> --log-failed`
   - Root-cause, fix, re-validate locally, push again
   - Repeat until ALL checks are green
5. Verify merge status: `gh pr view <N> --json mergeable --jq .mergeable` must be MERGEABLE
6. Verify zero unreplied Sentry comments
7. Final evidence output:

```
PR #NNNN — GREEN
  CI: All N checks passed (list each)
  Sentry: 0 unreplied comments
  Conflicts: MERGEABLE
  Evidence: gh pr checks NNNN output attached
```

Only after this output is produced, move to the next PR.

## Anti-Pattern Checklist (Check Before Every Fix)

Before editing ANY file, check if the file type has a known anti-pattern:
- `.github/workflows/` → #29: verify action versions exist, #30: no GNU-only patterns
- `api/generate/*/route.ts` → #15: maxDuration, #16: refundTokens in catch
- `components/**/*.tsx` → #1: panelRegistry, #4: useRef in render, #5: Date.now in render
- `chat/handlers/` → #28: forge API exists, #10: sceneGraph.nodes not sceneGraph
- `tokens/` → #16: refund in all paths, #20: webhook idempotent
- Callbacks → #45: audit all call sites that trigger the callback
- Stacked branches → #46: fix on the branch that introduced the code

## Execution Order

Process PRs oldest to newest by PR number. The sequence for this run:

1. PR #7357 (oldest)
2. PR #7376
3. PR #7389
4. PR #7391
5. PR #7415

Do NOT parallelize. Each PR must be fully GREEN before starting the next. If a fix on PR N breaks PR N+1 (shared branch), fix N+1 immediately before moving on.
