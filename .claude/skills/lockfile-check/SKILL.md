---
name: lockfile-check
description: Detect lockfile drift after cherry-picks or package.json edits. Runs npm install if drift found. Triggered automatically by Claude after cherry-pick operations.
user-invocable: false
---

# Lockfile Consistency Check

Verify `package-lock.json` is consistent with all `package.json` files in the monorepo. Run after cherry-picks, rebases, or manual `package.json` edits.

## When to Run

- After `git cherry-pick` that touches any `package.json`
- After `git rebase` across commits that modified dependencies
- After manually editing any `package.json`

## Check

```bash
# Dry-run npm install to detect drift without modifying node_modules
cd "$(git rev-parse --show-toplevel)"
npm install --dry-run 2>&1 | grep -E "added|removed|changed"
```

If the dry-run shows changes, the lockfile is stale.

## Fix

```bash
cd "$(git rev-parse --show-toplevel)"
npm install
git add package-lock.json
git commit -m "fix: regenerate lockfile after dependency changes"
```

## Why This Matters

`npm ci` (used in CI) requires an exact lockfile match. A stale lockfile fails **every** CI job — lint, tsc, build, tests, E2E — all at once. This is the single highest-blast-radius CI failure mode in this repo (see lesson #79 and CLAUDE.md "Cherry-pick + lockfile" gotcha).
