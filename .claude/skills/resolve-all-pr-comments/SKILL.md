---
name: resolve-all-pr-comments
description: Scan ALL open PRs for unreplied Sentry/Copilot comments and resolve them in batch
user-invocable: true
---

# Resolve All PR Comments

Batch-resolve unreplied bot comments across ALL open PRs in the repository.
Wraps the `/resolve-pr-comments` skill for each PR that has unreplied comments.

## Step 1: Find All Open PRs with Unreplied Bot Comments

```bash
REPO="Tristan578/project-forge"

# Get all open PRs
OPEN_PRS=$(gh pr list --repo "$REPO" --state open --json number --jq '.[].number')

# For each PR, check for unreplied bot comments
for PR in $OPEN_PRS; do
  UNREPLIED=$(gh api "repos/$REPO/pulls/$PR/comments" --paginate --jq '
    [.[] | {id, user: .user.login, in_reply_to_id}] |
    [.[].in_reply_to_id // empty] as $replied |
    [.[] | select(.user == "sentry[bot]" or .user == "Copilot") | select(.id | IN($replied[]) | not)] |
    length
  ' 2>/dev/null || echo "0")

  if [ "$UNREPLIED" -gt 0 ]; then
    echo "PR #$PR: $UNREPLIED unreplied bot comments"
  fi
done
```

## Step 2: Resolve Each PR

For each PR with unreplied comments, invoke `/resolve-pr-comments <PR_NUMBER>`.

Process PRs sequentially (not in parallel) to avoid branch conflicts:

1. Checkout the PR branch
2. Follow the full `/resolve-pr-comments` protocol (Step 0-5)
3. Return to the previous branch before moving to the next PR

## Step 3: Summary Report

After processing all PRs, output a summary table:

```markdown
## Cross-PR Comment Resolution Summary

| PR | Branch | Unreplied Before | Resolved | Remaining |
|----|--------|-----------------|----------|-----------|
| #1234 | feat/foo | 5 | 5 | 0 |
| #5678 | fix/bar | 3 | 3 | 0 |

Total: X comments resolved across Y PRs.
```

## Rules

- **Sequential processing**: One PR at a time to avoid merge conflicts
- **Full protocol per PR**: Every PR gets the complete `/resolve-pr-comments` treatment
- **Zero tolerance**: The skill is not done until ALL PRs show 0 unreplied comments
- **No attribution**: Do not add "Generated with Claude Code" or similar to any replies
- **Commit SHA required**: Every reply must reference a commit SHA, line number, or specific technical reason
- **Boy scout rule**: If a comment reveals a real bug, fix it before replying
