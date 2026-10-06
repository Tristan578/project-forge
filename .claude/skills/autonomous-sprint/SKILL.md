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
gh issue list --repo Tristan578/project-forge --state closed --search "closed:>=$(date -u -d '7 days ago' +%F)" --json number,title --jq '.[].number' | head -20

# 3. Read context
cat .claude/rules/gotchas.md
cat .claude/rules/lessons-learned.md
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

Run the board with `.claude/workflows/review-board.js`, following `.claude/skills/review-protocol/SKILL.md`. Check the PR's CI first (review-protocol rule 6).

- Round 1 runs all 5 seats — architect (`feature-dev:code-architect`), security, DX, UX and test (`test-reviewer`; `test-writer` never sits on the board). No seat is skipped because its domain looks untouched. If concurrency is limited, dispatch in batches of 3 then 2.
- Re-reviews follow review-protocol rule 4: only the seats that failed plus any seat whose domain the fix touches, against the fix diff, passing `{round, since, seats, carried}` to the workflow.
- The verdict is published to the PR as the `review-board` status (`scripts/post-board-verdict.sh`; the workflow does this in its Publish phase).
- PASS/FAIL only, under the scope, severity and round-cap rules in `.claude/skills/review-protocol/SKILL.md`: blockers and majors in the diff fail; minors are fixed in the same push or filed; re-reviews cover only the fix diff; stop and ask the user if a blocker or major is still open after round 3.
- Never use a single generic reviewer in place of the 5 specialists.

### Phase 3: Quality Gate (BEFORE push)

```bash
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run
```

All three MUST pass. If `tsc --noEmit` OOMs, use targeted `npx vitest run <files>` + eslint as fallback.

### Phase 4: Push

```bash
git push origin <branch>
```

### Phase 5: Wait + Resolve (AFTER every push)

Bot comments (Sentry, Copilot) appear 2-5 minutes after push. You MUST wait and check.

Wait about 3 minutes for bot analysis (a background wait or Monitor — the Bash tool blocks a foreground `sleep`), then resolve ALL open PRs — not just the one you pushed to — with `/resolve-all-pr-comments`. This sweep is the last step before reporting, re-run after every push or update-branch, and quotes the head SHA it checked (lessons-learned #12).

This invokes the full protocol: checkout each PR branch, read current code (not stale diffs), fix real bugs before replying, post threaded replies with commit SHAs, verify 0 unreplied remaining.

**If `/resolve-all-pr-comments` finds real bugs:** fix them → re-review only the fix diff → push → wait → resolve again. Stop and ask the user if a blocker or major is still open after round 3 (`.claude/skills/review-protocol/SKILL.md` → Scope, severity and the round cap).

### Phase 6: Verify Green

```bash
gh pr checks <N>  # Poll until all CI checks complete
```

If CI fails: read the actual error (`gh run view <RUN_ID> --log-failed`), fix root cause, go back to Phase 1.

### Phase 7: Next

Move to the next item in the priority queue. Repeat the loop.

## Hard Rules

1. **PASS or FAIL only.** No "pass with issues." What blocks, and when the loop stops, is set by the scope, severity and round-cap rules in `.claude/skills/review-protocol/SKILL.md`.
2. **Boy Scout Rule.** See a bug, fix a bug — in the code you are changing. A pre-existing bug elsewhere is filed as an issue, not folded into this PR and not raised as a board finding.
3. **NEVER merge PRs.** User reviews and merges. You ship to merge-ready.
4. **NEVER weaken tests.** Fix the violations, not the assertions.
5. **Every PR:** `Closes #NNNN` (GitHub issue number, not PF-XXX), changeset, quality gate.
6. **Review board BEFORE push.** Code that hasn't passed specialized review doesn't ship.
7. **Resolve comments AFTER every push.** Wait ~3 min (background wait, not foreground `sleep`), then `/resolve-all-pr-comments`.
8. **No attribution.** No Co-Authored-By, no robot emoji, no "Generated with Claude Code" — anywhere.
9. **Limited concurrency:** dispatch reviewers in batches of 3 then 2 — all 5 still review (review-protocol → Rules).
10. **Commit after every logical chunk.** Rate limits and crashes kill agents — uncommitted work is lost.
11. **Read before writing.** Understand existing code before suggesting modifications.
12. **Validate route params.** If POST validates name characters, PATCH/DELETE on `[name]` must too.

13. **Subagents self-enforce Boy Scout Rule.** `block-deferred-fixes.sh` only fires for the main agent. Every dispatched agent must self-check replies against the banned-phrase list in `/resolve-pr-comments` SKILL.md before posting.

## Context Files

- `.claude/rules/gotchas.md` — 40+ anti-patterns with real examples
- `.claude/rules/lessons-learned.md` — anti-patterns from real bugs (injected by `inject-lessons-learned.sh`)
- `.claude/rules/agent-operations.md` — SOPs for testing, committing, PR creation
- `.claude/rules/web-quality.md` — ESLint rules, React patterns, Next.js constraints

## Session Log

Lessons from prior runs. **Boot sequence validates these against live state and deletes stale entries.**

_(empty — lessons that outlive a session go into `.claude/rules/lessons-learned.md` in its format)_

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
