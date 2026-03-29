---
name: ci-status
description: Monitor CI checks on a PR until all complete. Reports pass/fail summary with failure logs for red checks. Usage - /ci-status <PR number>
---

# CI Status Monitor

Monitor all CI checks on a PR and report results.

## Arguments

`<PR number>` — the PR to monitor (e.g., `7979`)

## Workflow

### Step 1: Get Current Check Status

```bash
gh pr checks <PR_NUMBER> 2>&1
```

### Step 2: If All Complete — Report Summary

Count passing, failing, and pending checks. For each failure:

```bash
# Get the run ID from the check URL
gh run view <RUN_ID> --log-failed 2>&1 | tail -30
```

### Step 3: If Checks Still Pending — Report and Wait

Report which checks are done and which are pending. Offer to check again.

### Output Format

```
PR #NNNN CI Status
━━━━━━━━━━━━━━━━━
✓ 15/18 passing
✗ 1 failing: Lighthouse Effects Delta Gate
⏳ 2 pending: WASM Build, E2E UI Tests

FAILURE: Lighthouse Effects Delta Gate
  Error: ENOENT: no such file or directory, scandir '.lhci-baseline'
  Root cause: lhci collect flags incorrect (--output-path vs --outputDir)
```

## Tips

- WASM Build takes ~12 min, E2E depends on it — these are always last to finish
- Seer Code Review is external (Sentry) — may take 3-5 min
- If `npm ci` fails in multiple jobs simultaneously, it's a lockfile issue — run `/lockfile-check`
