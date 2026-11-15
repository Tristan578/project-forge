---
---

Test infrastructure only, so no package version changes. 62 Playwright `waitForFunction` calls in `web/e2e` passed `{ timeout }` in the page-function argument slot, so every one of them waited for the 10s action timeout instead of the time it asked for. The options now go in the third slot, and a new lint rule, `spawnforge/no-wait-for-function-options-as-arg`, rejects the two-argument form.
