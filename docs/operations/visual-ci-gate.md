# Visual CI gate

> **Last updated:** 2026-09-16

Design system and Storybook changes run Chromatic as part of the required CI result. Uploading a build is not a passing test: CI waits for completed rendering and accepted snapshots. Changes outside those paths retain the normal visual-job skip.

A missing `CHROMATIC_PROJECT_TOKEN` fails the design-change job with a safe diagnostic. Quota, payment, rendering, cancellation, and unaccepted-difference failures propagate through the action to CI Success; do not bypass the gate or print project tokens.

If a build is paused for account quota, restore the account snapshot allowance through its administrator. Then rerun the failed Chromatic job. Inspect and accept intended visual differences in Chromatic before rerunning; reject unintended changes and fix their source. Previously passing Windows and other jobs do not need to be repeated just to retry the failed visual job.

The Chromatic action is pinned to v18.8.1 by SHA, and TurboSnap remains enabled. These inputs explicitly enforce completed results and reviewed changes:

```yaml
exitOnceUploaded: false
exitZeroOnChanges: false
autoAcceptChanges: false
```

The required production CI contract suite covers completed-result options, credential failure behavior, normal path gating, and mutations that would ignore or disable the check.

See [Chromatic configuration](https://www.chromatic.com/docs/configure/), [CLI exit codes](https://www.chromatic.com/docs/cli/), and [rerunning after snapshot review](https://www.chromatic.com/docs/semaphore/#re-run-failed-builds-after-verifying-ui-test-results).
