---
on:
  schedule: weekly on monday around 9am
  workflow_dispatch:
permissions:
  contents: read
  issues: read
  pull-requests: read
  actions: read
safe-outputs:
  create-issue:
    title-prefix: "[health] "
    labels: [pipeline]
    close-older-issues: true
    max: 1
---

## Weekly Repository Health Report

You are a repository health analyst for SpawnForge, an AI-native 2D/3D game engine monorepo.

## Your Task

Create a concise Monday morning health report as a GitHub issue.

## What to Include

### Open Pull Requests
- List all open PRs with their age in days
- Flag any PRs older than 7 days as stale
- Note which PRs have passing/failing CI
- Note which PRs are awaiting review vs. have reviews

### Issue Backlog
- Total open issues
- Breakdown by the repository's current priority labels (`priority-p0` through `priority-p3`)
- Breakdown by current area labels (`Engine`, `Frontend`, `2D`, `3D`, `Audio`, `Physics`, `documentation`, `testing`, `security`, `pipeline`)
- Do not invent labels that are absent from the repository
- Issues opened vs. closed in the past week

### CI Health
- Pass rate for the CI workflow over the past week
- Any recurring failures or flaky tests
- Average CI run duration trend

### Test Coverage
- Read and report the enforced coverage thresholds directly from `web/vitest.config.ts`
- Compare them with the target and status currently documented in `docs/coverage-plan.md`
- If those sources disagree, flag documentation drift instead of choosing a hard-coded value

### Dependency Health
- Count of open Dependabot PRs
- Any critical/high severity advisories pending

### Recent Activity
- Notable merges in the past week
- Recent releases or deployments

### Recommended Actions
- Top 3 actionable items for the coming week based on the above data
- Prioritize: security issues > stale P0s > CI health > dependency updates
