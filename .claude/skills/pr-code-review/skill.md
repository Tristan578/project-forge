---
name: pr-code-review
description: Use when reviewing a pull request for bugs, security issues, and regressions. Analyzes the full diff with codebase context and posts inline GitHub comments with severity markers. Modeled after Claude Code Review's multi-agent approach. Invoke with /pr-code-review <PR number>.
---

# PR Code Review

Analyze a pull request for logic errors, security vulnerabilities, broken edge cases, and subtle regressions. Posts findings as inline GitHub PR review comments with severity markers.

Modeled after [Claude Code Review](https://code.claude.com/docs/en/code-review) — the managed service uses multi-agent analysis on Anthropic infrastructure. This skill replicates that workflow locally.

## Usage

```
/pr-code-review 6738
/pr-code-review 6738 --focus security
/pr-code-review all          # review all open PRs
```

## Severity Markers

| Marker | Level | Meaning |
|--------|-------|---------|
| 🔴 | **Bug** | Should be fixed before merging |
| 🟡 | **Nit** | Minor issue, worth fixing but not blocking |
| 🟣 | **Pre-existing** | Bug exists in codebase but not introduced by this PR |

## Process

### Step 1: Load Review Context

Read project-specific review rules:

```bash
# Project rules (applies to all Claude tasks)
cat CLAUDE.md

# Review-specific rules (if exists)
cat REVIEW.md 2>/dev/null
```

If `REVIEW.md` exists, treat its rules as additional review criteria beyond the defaults.

### Step 2: Get the PR Diff

```bash
# Get PR metadata
gh pr view <PR> --json title,body,headRefName,baseRefName,changedFiles,additions,deletions

# Get the full diff
gh pr diff <PR>

# Get list of changed files
gh pr diff <PR> --name-only
```

### Step 3: Analyze Each Changed File

For each changed file, read the FULL file (not just the diff) to understand context:

```bash
# Read the complete file on the PR branch
gh pr view <PR> --json headRefName --jq '.headRefName' | xargs -I{} git show origin/{}:<filepath>
```

### Step 4: Multi-Category Analysis

Review the diff for these categories (in parallel where possible using the Agent tool):

**Category 1: Logic Errors**
- Off-by-one errors
- Null/undefined access without guards
- Incorrect boolean logic
- Missing return statements
- Race conditions
- Stale closures in React hooks

**Category 2: Security Vulnerabilities**
- SQL injection (check for raw string interpolation in queries)
- XSS (check for unescaped user input in rendered HTML)
- Auth bypass (missing authentication checks on routes)
- Token/credential exposure
- ReDoS (polynomial regex on untrusted input)
- Path traversal

**Category 3: API Contract Violations**
- Changed function signatures without updating callers
- Missing error handling on async operations
- Inconsistent response shapes
- Breaking changes to exported types

**Category 4: Performance Regressions**
- O(N^2) patterns in loops
- Missing memoization on expensive React renders
- Unnecessary re-renders from unstable references
- Large synchronous operations blocking the main thread

**Category 5: Project Convention Violations**
- Rules from CLAUDE.md and REVIEW.md
- Import path conventions
- Test coverage for new modules
- Missing error boundaries

### Step 5: Verify Findings (Reduce False Positives)

For EACH potential finding, verify it by:
1. Reading the surrounding code to confirm the bug is real
2. Checking if the issue exists on the base branch (pre-existing = use 🟣)
3. Checking if there's a test that covers the edge case
4. Confirming the fix is not already handled elsewhere

**False positive filters:**
- Code that's intentionally written a certain way (check comments)
- Test files that use mocks (don't flag mock patterns as bugs)
- Generated code (skip files in /gen/, /generated/, etc.)
- Type-only changes (don't flag unless there's a runtime impact)

### Step 6: Post Inline Comments

Post findings as a GitHub PR review with inline comments:

```bash
# Create a review with inline comments (batch into single review)
# Use event="COMMENT" — NEVER "APPROVE" or "REQUEST_CHANGES"
gh api repos/{owner}/{repo}/pulls/{PR}/reviews \
  --method POST \
  -f event="COMMENT" \
  -f body="## Claude Code Review ..." \
  --jsonpath ...
```

Format each inline comment as:
```
<severity_marker> **<category>**: <description>

<details>
<summary>Reasoning</summary>
<explanation of why this is a bug and how it was verified>
</details>
```

**Important:** Use `event: "COMMENT"` — never "APPROVE" or "REQUEST_CHANGES". The review should not block the PR.

### Step 7: Handle No Issues Found

If no issues are found, post a confirmation:

```bash
gh pr comment <PR> --body "## Claude Code Review

No issues found. Reviewed N files, M lines changed.

Checked: logic errors, security, API contracts, performance, project conventions."
```

## Rules

1. **Never approve or block** — always use `event: "COMMENT"`
2. **Verify before posting** — every finding must be confirmed against actual code
3. **Include reasoning** — use collapsible details for extended analysis
4. **Respect REVIEW.md** — if it says skip generated files, skip them
5. **Tag severity honestly** — don't inflate severity to seem thorough
6. **Pre-existing vs introduced** — check the base branch to distinguish
7. **Batch comments** — use a single review submission, not individual comments
8. **No style nits** — unless REVIEW.md explicitly asks for style checks
9. **Deferred findings need PF tickets** — if you identify work that should be done but is not blocking, create a taskboard ticket and reference it
10. **Max 10 findings per review** — if more issues exist, prioritize by severity and note N additional lower-severity findings omitted

## Focus Modes

Use `--focus <category>` to narrow the review:

- `--focus security` — only security vulnerabilities
- `--focus performance` — only performance regressions
- `--focus logic` — only logic errors
- `--focus conventions` — only CLAUDE.md/REVIEW.md violations

## Integration with babysit-prs

This skill complements `/babysit-prs`:
- **babysit-prs**: monitors CI failures and existing review comments, fixes them
- **pr-code-review**: proactively finds NEW issues by analyzing code changes

Run `/pr-code-review` BEFORE merging. Run `/babysit-prs` AFTER pushing fixes.
