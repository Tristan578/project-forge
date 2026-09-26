# Visual CI gate

> **Last updated:** 2026-09-26

## Paused since 2026-09-26 (#10279)

**The gate described below is currently paused.** The Chromatic account hit its billed monthly snapshot limit, and the owner chose not to upgrade the plan. While paused:

- The `Chromatic Visual Regression` job in `quality-gates.yml` is **skipped**. It is not reported as passing.
- On every change that touches `apps/design/` or `packages/ui/`, a separate job named `Chromatic Visual Regression (PAUSED - not checked)` emits a `::warning::` annotation and a run-summary note saying that visual regression was **not** checked. That job checks nothing. A green `CI Success` on such a PR says nothing about rendered output.
- `chromatic-baseline.yml` does not write baselines on `main`. Its `Chromatic pause switch` job warns that no baseline was written.
- The Chromatic GitHub App's own `UI Tests` status may still appear as pending or failed. It is not a required check.

PRs merged while the gate is paused had **no** visual-regression check.

**Switches.** There is one switch in each workflow, and they must agree:

- the `default:` of the `chromatic-paused` input at the top of `.github/workflows/quality-gates.yml`
- `CHROMATIC_PAUSED` in the `env:` block of `.github/workflows/chromatic-baseline.yml`

`scripts/__tests__/visual-ci-contract.test.mjs` fails in any of these cases:

- the two switches disagree
- a caller overrides the switch
- the visual job is skipped by anything other than the switch
- the notice job stops warning

The assertions on the un-paused job body stay in force the whole time.

**To lift the pause**, after the allowance resets or the plan changes:

1. In one PR, set `default: false` on `chromatic-paused` and set `CHROMATIC_PAUSED: 'false'`. In that same PR, update the quality-gates preamble pin in `scripts/__tests__/check-npm-audit.test.sh`, which pins that input's lines byte for byte.
2. After merge, dispatch `Chromatic Baseline` on `main` so the baseline includes everything merged while paused. Review that build in Chromatic, because those changes were never visually reviewed.
3. Close #10279.

## How the gate works when enabled

Design system and Storybook changes run Chromatic as part of the required CI result. Uploading a build is not a passing test: CI waits for completed rendering and accepted snapshots, then checks the fresh diagnostics report for enabled visual tests, an unlimited passing build, completed tests, and no errors or unaccepted changes. Publish-only success is rejected. Changes outside those paths retain the normal visual-job skip.

A missing `CHROMATIC_PROJECT_TOKEN` fails the design-change job with a safe diagnostic. The action and mandatory results verifier reject quota, payment, rendering, cancellation, and unaccepted-difference failures through CI Success; do not bypass the gate or print project tokens.

If a build is paused for account quota, restore the account snapshot allowance through its administrator. Confirm visual tests are enabled for the project, then rerun the failed Chromatic job. Inspect and accept intended visual differences in Chromatic before rerunning; reject unintended changes and fix their source. Previously passing Windows and other jobs do not need to be repeated just to retry the failed visual job.

The Chromatic action is pinned to v18.8.1 by SHA, and TurboSnap remains enabled. These inputs explicitly enforce completed results and reviewed changes:

```yaml
exitOnceUploaded: false
exitZeroOnChanges: false
autoAcceptChanges: false
```

The required production CI contract suite covers completed-result options, credential failure behavior, normal path gating, publish-only/limited reports, safe diagnostics handling, and mutations that would ignore or disable the check.

See [Chromatic configuration](https://www.chromatic.com/docs/configure/), [CLI exit codes](https://www.chromatic.com/docs/cli/), and [rerunning after snapshot review](https://www.chromatic.com/docs/semaphore/#re-run-failed-builds-after-verifying-ui-test-results).
