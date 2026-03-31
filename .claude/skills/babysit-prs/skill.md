---
name: babysit-prs
description: Monitor open PRs for CI failures and review comments, then fix issues automatically. Use when PRs need to be driven to green — checks CI status, Sentry comments, merge conflicts, and applies fixes.
user-invocable: true
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, Agent
argument-hint: "[pr_number | 'all']"
---

# PR Babysitter

Monitor open pull requests for CI failures and review comments (Sentry, Copilot, human reviewers), then automatically address them.

## When to Run

- After pushing to any PR branch
- Periodically to check all open PRs
- When the user asks to clean up PRs

## Process

### Step 1: Discover PRs

If `$ARGUMENTS` is a PR number, check just that PR. If `$ARGUMENTS` is 'all' or empty, check all open PRs:

```bash
gh pr list --state open --json number,title,headRefName,statusCheckRollup --limit 20
```

### Step 2: For Each PR, Check CI Status

```bash
gh pr checks <number>
```

Look for:
- **FAILED** checks → need investigation and fix
- **IN_PROGRESS** checks → skip, check later
- **SUCCESS** on all → CI is clean

### Step 3: For Each PR, Check Review Comments

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments --jq '.[] | {id: .id, body: .body, path: .path, line: .line, user: .user.login, created_at: .created_at}'
```

Also check PR review threads:
```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews --jq '.[] | {id: .id, state: .state, body: .body, user: .user.login}'
```

**Save the comment ID and review ID** — you need these to post replies.

### Step 4: Categorize Comments

For each comment, determine:

| Source | Pattern | Action |
|--------|---------|--------|
| Sentry (Seer) | `BUG_PREDICTION`, `Severity:` | Evaluate validity. Fix if real, dismiss if false positive |
| Copilot | `suggestion` blocks, code diffs | Apply if correct, skip if stylistic-only |
| Human reviewer | Approval/changes requested | Address all requested changes |

### Step 5: Fix Issues

For each real issue found:

1. **Checkout the PR branch**: `git checkout <branch>`
2. **Read the affected file** to understand context
3. **Apply the fix** (Edit tool preferred)
4. **Run quick validation**: `cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run`
5. **Commit with descriptive message**: Reference the review comment
6. **Push**: `git push origin <branch>`

### Step 6: Reply to Review Comments

**This step is MANDATORY after fixing or triaging each comment.**

For each comment you acted on, post a reply explaining what you did:

#### Reply to a PR review comment (inline comment):
```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments/{comment_id}/replies \
  -f body="Fixed in <commit_sha>. <brief explanation of the fix>"
```

#### Reply to a top-level PR review (as an issue comment):
```bash
gh pr comment {number} --body "Addressed — <brief explanation>"
```

#### For false positives, reply explaining why:
```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments/{comment_id}/replies \
  -f body="This is a false positive — <explanation of why the code is intentional>"
```

Every reply MUST fall into exactly one of these four outcomes. There is no fifth option.

| Outcome | When | Reply Template | Requires |
|---------|------|----------------|----------|
| **Fixed** | Bug is valid and fixed in this PR | "Fixed in `abc1234`. [description]" | Commit SHA |
| **Deferred** | Bug is valid but out of scope | "Valid bug. Tracked as **PF-XXX** — [title]." | PF-ticket (create FIRST) |
| **False positive** | Bug report is incorrect | "False positive — [specific technical reason]" | Evidence |
| **Already addressed** | Fixed in a prior commit | "Already addressed in `abc1234`." | Commit SHA |

**There is no "out of scope" without a ticket. There is no "follow-up" without a PF-number.**

### Banned Phrases (require a PF-ticket before use)

Before writing ANY reply, scan your draft for these patterns. If present, you MUST create a ticket first:

- "will fix in follow-up"
- "tracked for future"
- "known issue"
- "will address later"
- "out of scope"
- "if this becomes an issue"
- "if this becomes a real problem"
- "we can add"
- "could add in future"
- "acceptable tradeoff" (without a ticket for monitoring)
- "when needed" / "if needed"
- any conditional future work ("if X happens, we'll Y")

**The rule:** If your reply acknowledges valid work that won't happen in this PR — no matter how you phrase it — a ticket is required. Conditional language ("if this becomes...") is just a softer way of saying "will fix later" and requires the same ticket.

### Step 7: Report

After processing all PRs, output a summary table:

```
| PR | Title | CI | Comments | Action Taken | Replies |
|----|-------|----|----------|-------------|---------|
| #1234 | feat: ... | PASS | 2 Sentry (1 fixed, 1 false positive) | Pushed fix commit | 2 replies posted |
| #1235 | test: ... | FAIL (lint) | 0 | Fixed lint error, pushed | 0 |
```

## Triage Rules

### When to Fix

- Sentry bug predictions rated MEDIUM or higher that are technically valid
- Copilot suggestions that fix actual bugs or improve safety
- Any comment requesting specific code changes with a clear rationale
- CI failures (lint, TypeScript, test failures)

### When to Skip

- Sentry LOW severity predictions about style/naming
- Copilot suggestions that are purely cosmetic (rename, reformat)
- Comments already addressed in a previous commit (check git log)
- Comments on code that was intentionally written that way (add a reply explaining why)

### False Positive Detection

Common false positives from automated reviewers:
- "Module-scope stubs not cleaned up" → Intentional when tests need persistent stubs
- "Not integrated into production code" → May be intentional (e.g., new protocol not yet wired)
- "Reserved browser shortcut" → Valid concern but may be acceptable with Shift modifier
- "resetModules clears mocks" → `vi.doMock()` survives `vi.resetModules()` in vitest

## Important Notes

- Never force-push or rewrite history on shared branches
- Always run the quick validation suite before pushing
- If multiple PRs need the same fix, fix on the earliest branch and note in others
- **ALWAYS reply to comments** — even false positives need a reply so reviewers know they were seen
- **EVERY reply must contain one of:** a commit SHA, a PF-ticket number, or a technical false-positive explanation
- **Self-check before posting:** Re-read your reply. Does it promise, imply, or conditionally suggest future work? If yes, where's the ticket? No ticket = rewrite the reply.
