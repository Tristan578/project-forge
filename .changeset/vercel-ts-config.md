---
"web": patch
---

Migrated `web/vercel.json` to a typed `web/vercel.ts` (via `@vercel/config`), carrying over the same install/build commands, output directory, region, disabled git-triggered deploys, and health-monitor cron — so a future bad edit to this config now fails `tsc --noEmit` instead of silently misconfiguring the deploy.

**Deploy is blocked until the root lockfile is relocked.** This PR adds `@vercel/config` to `web/package.json` but the root `package-lock.json` has not been regenerated for it yet (out of scope for this change — the author's sandbox is forbidden from running `npm install`/`npm ci`). Until someone runs `npm install --package-lock-only` from the repo root and commits the result, `npm ci` — including this file's own `installCommand` — fails with a missing-from-lock-file error, so the next deploy's install step will not succeed. Do not merge before that relock lands and Lockfile Sync is green.
