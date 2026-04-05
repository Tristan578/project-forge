---
name: autonomous-sprint
description: Long-running autonomous session — ship fixes, run review board, push, resolve bot comments, repeat. No human intervention until PRs are merge-ready.
---

# Autonomous Sprint — Ship, Review, Resolve, Repeat

Long-running autonomous session. You ship fixes, run the review board, push, wait for bot comments, resolve everything, then move to the next batch. No human intervention required until PRs are ready for merge approval.

## Boot Sequence

```bash
# 1. Live state — the ONLY source of truth
gh pr list --repo Tristan578/project-forge --state open --json number,title,headRefName,mergeable,statusCheckRollup
gh issue list --repo Tristan578/project-forge --state open --milestone "P0: Production Blockers" --json number,title
gh issue list --repo Tristan578/project-forge --state open --milestone "P1: User Workflow Blockers" --json number,title

# 2. Recently closed — detect stale session log entries
gh issue list --repo Tristan578/project-forge --state closed --since "$(date -v-7d +%Y-%m-%dT00:00:00Z)" --json number,title --jq '.[].number' | head -20

# 3. Read context
cat .claude/rules/gotchas.md
cat memory/project_lessons_learned.md
```

**If live state contradicts the session log below: trust GitHub, rewrite the log.**

## Priority Queue

1. **Sick PRs** — red CI, unreplied bot comments, merge conflicts. Heal these first.
2. **Open P0s** — production blockers affecting paying customers.
3. **High-impact P1s** — workflow blockers with no workaround.
4. **Boy Scout fixes** — bugs discovered while working on the above.

You decide grouping, batch size, branch strategy. Optimize for throughput — batch related fixes into single PRs where sensible, but never let a PR grow so large it's unreviewable.

## The Loop (repeat for every unit of work)

### Phase 1: Build

- Read the relevant code BEFORE editing. Understand context.
- Fix the issue. Write tests if missing (boy scout rule).
- Run targeted validation after each edit: `cd web && npx vitest run <file>`
- Commit after every logical chunk. Small, atomic commits.

### Phase 2: Review Board (BEFORE push)

Run the 5 specialized reviewers against your changes. Use `/review-protocol` dispatch rules.

```
Reviewers (dispatch in parallel, max 3 concurrent on M2):
  1. feature-dev:code-architect — structure, dependencies, patterns
  2. security-reviewer — injection, auth, validation, data exposure
  3. dx-guardian — developer workflow, documentation, conventions
  4. ux-reviewer — WCAG AA, component UX, responsive (if UI touched)
  5. test-writer — coverage gaps, test quality, CI gates (if tests touched)
```

- Skip reviewers whose domain wasn't touched (e.g. skip ux-reviewer for pure API fixes).
- PASS/FAIL only. Any issue at any severity = FAIL. Fix and re-review.
- NEVER use a generic `code-reviewer` in place of the 5 specialists.

### Phase 3: Quality Gate (BEFORE push)

```bash
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run
```

All three MUST pass. If `tsc --noEmit` OOMs on Node 25.x, use targeted `npx vitest run <files>` + eslint as fallback.

### Phase 4: Push

```bash
git push origin <branch>
```

### Phase 5: Wait + Resolve (AFTER every push)

Bot comments (Sentry, Copilot) appear 2-5 minutes after push. You MUST wait and check.

```bash
# Wait for bot analysis to complete
sleep 180

# Then resolve ALL open PRs — not just the one you pushed to
/resolve-all-pr-comments
```

This invokes the full protocol: checkout each PR branch, read current code (not stale diffs), fix real bugs before replying, post threaded replies with commit SHAs, verify 0 unreplied remaining.

**If `/resolve-all-pr-comments` finds real bugs:** fix them → re-run review board → push → wait → resolve again. Loop until clean.

### Phase 6: Verify Green

```bash
gh pr checks <N>  # Poll until all CI checks complete
```

If CI fails: read the actual error (`gh run view <RUN_ID> --log-failed`), fix root cause, go back to Phase 1.

### Phase 7: Next

Move to the next item in the priority queue. Repeat the loop.

## Hard Rules

1. **PASS or FAIL only.** Any issue = FAIL. No "pass with issues."
2. **Boy Scout Rule.** See a bug, fix a bug. "Pre-existing" is never an excuse.
3. **NEVER merge PRs.** User reviews and merges. You ship to merge-ready.
4. **NEVER weaken tests.** Fix the violations, not the assertions.
5. **Every PR:** `Closes #NNNN` (GitHub issue number, not PF-XXX), changeset, quality gate.
6. **Review board BEFORE push.** Code that hasn't passed specialized review doesn't ship.
7. **Resolve comments AFTER every push.** Wait 3 min, then `/resolve-all-pr-comments`.
8. **No attribution.** No Co-Authored-By, no robot emoji, no "Generated with Claude Code" — anywhere.
9. **Max 3 concurrent agents on M2.** Dispatch reviewers in batches of 3 then 2.
10. **Commit after every logical chunk.** Rate limits and crashes kill agents — uncommitted work is lost.
11. **Read before writing.** Understand existing code before suggesting modifications.
12. **Validate route params.** If POST validates name characters, PATCH/DELETE on `[name]` must too.

## Context Files

- `.claude/rules/gotchas.md` — 40+ anti-patterns with real examples
- `memory/project_lessons_learned.md` — 60+ recurring mistakes
- `.claude/rules/agent-operations.md` — SOPs for testing, committing, PR creation
- `.claude/rules/web-quality.md` — ESLint rules, React patterns, Next.js constraints

## Session Log

Lessons from prior runs. **Boot sequence validates these against live state and deletes stale entries.**

### Session 2026-04-05
- **Shipped**: PR #8231 (model names, token costs, leaderboard API, Replicate model fix, boardName validation). Closes #8174, #8200, #8173, #8172, #7512, #8175.
- **Shipped**: PR #8166 (design system phase B) — merged after changeset fix + comment resolution.
- **Automation added**: Sentry + Stripe MCP in `.mcp.json`, route test enforcement hook, `/resolve-all-pr-comments` skill.
- **Lessons**:
  - Replicate API: use `model` field (not `version`) with `owner/name` format.
  - Route `[name]` params need validation matching POST — malformed `%` encoding reaches DB without it.
  - Bot comments appear 2-5 min after push. Must wait before `/resolve-all-pr-comments`.
  - Copilot comments are often valid — don't dismiss without reading the actual code.
  - `tsc --noEmit` may OOM on Node 25.x. Fallback: targeted vitest + eslint.

## Session End Protocol

Before ending:
1. ALL open PRs: green CI, 0 unreplied bot comments, no merge conflicts
2. `/resolve-all-pr-comments` one final time
3. Rewrite the Session Log:
   - Delete entries older than 3 sessions
   - Delete any lesson that is no longer true
   - Add this session: what shipped, what lessons learned
   - Keep under 20 lines total
4. Print summary table for the user:
   ```
   | PR | Title | CI | Comments | Conflicts | Status |
   |----|-------|----|----------|-----------|--------|
   ```
5. "All PRs merge-ready. Awaiting your approval."
