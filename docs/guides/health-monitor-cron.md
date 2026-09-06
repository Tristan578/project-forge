# Synthetic health monitor — activation and evidence runbook (#9118)

`GET /api/cron/health-monitor` is SpawnForge's only automated detector of a
production outage between deploys. Vercel Cron fires it on the schedule in
`web/vercel.json` (`*/15 * * * *`, ~96 runs a day) against the **production**
deployment only. Each run executes every check in
`web/src/lib/monitoring/healthChecks.ts` (`runAllHealthChecks()`), prunes
expired webhook-idempotency rows, reports any non-healthy service to Sentry as
a structured exception, and registers a Sentry Cron check-in on the monitor
slug `spawnforge-health-monitor` (`web/src/lib/monitoring/cronMonitors.ts`).

## Why it has never run

`isAuthorizedCron()` in `web/src/app/api/cron/health-monitor/route.ts` compares
the request's `Authorization: Bearer …` header against `CRON_SECRET` using
fixed-length HMAC digests. When the variable is **unset it fails closed**: every
request is answered 401.

**Evidence (2026-09-05).** `vercel env ls production --scope tnolan` on the
`spawnforge` project lists no `CRON_SECRET`, and
`vercel logs --environment production --no-branch --json` on deployment
`dpl_AMntAxUDLaQvzKvZHg2gj7XrXAM2` answers `401` for every scheduled
invocation of the path. Re-check both before acting on this document: the
claim is dated, not permanent.

Note that 401s predating #8703 have a *different* cause — the Clerk proxy
rejected `/api/cron/*` before the route's own check ran
(`docs/audits/2026-05-30-*`) — so do not read the whole history as one fault.

Two consequences that this runbook exists to prevent:

1. Nobody is told about an outage by the monitor; users tell us.
2. Once the secret IS set, the monitor inherits whatever the probes say, and
   on `main` today two of them do not grade what their names claim
   (lesson 1 in `.claude/rules/lessons-learned.md`):
   - **AI Providers** is `healthy` whenever a chat backend resolves.
     `checkAiProviders` sets `status: backend ? 'healthy' : 'down'`, and its
     own docblock states that platform generation keys "are reported as an
     informational facet only and never move the status".
   - **Payments (Stripe)** is `healthy` on the mere presence of
     `STRIPE_SECRET_KEY`, with `latencyMs: 0` — no request is made.

   Confirmed in production on 2026-09-05: `curl https://www.spawnforge.ai/api/health`
   returned `overall: healthy` with `AI Providers: up` and
   `Payments (Stripe): up`, both `latencyMs: 0`, while no `PLATFORM_*`
   generation key was set. (The public body renames the internal `healthy` to
   `up`; the internal vocabulary is `'healthy' | 'degraded' | 'down'`.)

   **Do the activation after #9719 is on `main`**, or accept that the first
   runs are evidence of authentication only, not of service health.

## Activation (owner-only)

`CRON_SECRET` is a value you invent; Vercel only replays it in the header.

1. Generate a secret locally and put it straight into the password manager:

   ```bash
   openssl rand -hex 32
   ```

   Never paste it into a chat, an issue, a commit, or any file in this repo.
   `web/.env.example` carries only the commented placeholder name.

2. Set it on the `spawnforge` project, **Production only** (Preview
   deployments never run crons), from `web/` on a linked checkout
   (`vercel link --yes --scope tnolan --project spawnforge` once per checkout):

   ```bash
   vercel env add CRON_SECRET production --scope tnolan
   ```

   Paste the value at the prompt; passing it as an argument leaves it in shell
   history.

3. Rebuild production so the new variable is present — Vercel injects
   environment variables at build time, so the running deployment will not pick
   it up. **Re-run the CD workflow; do not deploy from a local checkout:**

   ```bash
   gh workflow run cd.yml --ref main
   ```

   A bare `vercel deploy --prod` from your machine is the wrong mechanism here
   and is hard to undo. CD's production deploy is not a plain deploy: it pulls
   the production environment, populates `web/public/engine-pkg-*` from the
   WASM build artifacts, asserts the upload actually contains the engine
   (`scripts/assert-vercel-engine-manifest.sh`), passes
   `--build-env NEXT_PUBLIC_ENGINE_VERSION=<sha>`, and then drives a rolling
   release with post-deploy health checks and rollback. A local deploy ships
   your working tree with no engine assets and no engine version — the
   CDN/engine-404 failure class of #9581, #9593 and #9599 — and `cd.yml` calls
   an out-of-band `vercel deploy --prod` out by name as the thing that leaves
   an unverified canary auto-ramping with every rollback step skipped.

   If you must rebuild without a CD run, use the dashboard's **Redeploy** on
   the current production deployment (or `vercel redeploy <production-url>
   --scope tnolan` from the **repo root** — `rootDirectory=web` handles the
   subdirectory, and running it from `web/` doubles the path) and then verify
   `NEXT_PUBLIC_ENGINE_VERSION` survived before trusting the result.

## Evidence: one successful run

The property that matters is that the **scheduled** invocation authenticates.
`vercel crons run` is a useful smoke test, but it proves only that the manual
trigger authenticates, so it cannot stand in for the real thing.

1. **Registration and smoke test**

   ```bash
   vercel crons ls --scope tnolan
   vercel crons run /api/cron/health-monitor --scope tnolan
   ```

2. **A scheduled 200.** Wait for the next quarter-hour boundary, then read the
   log. The route returns 200 even when a service is unhealthy (Vercel backs
   off a cron that returns non-200; service failures go to Sentry instead), so
   `200` proves *authentication* and only the body/Sentry speak to health.

   ```bash
   vercel logs --environment production --no-branch --since 2h --limit 200 --json \
     --scope tnolan | grep '/api/cron/health-monitor'
   ```

   `--environment production --no-branch` is load-bearing: `vercel logs`
   defaults to filtering by the current git branch on a linked project, so
   without them a run from any non-`main` checkout returns nothing and reads
   like "the cron never fired". The `--json` field shape is not a documented
   contract, so treat the dashboard as authoritative: project `spawnforge` →
   Logs → filter path `/api/cron/health-monitor`. Before activation every line
   reads `401`; after, the new lines must read `200`. Quote one 200 line
   verbatim on #9118, and say whether it came from the schedule or from
   `vercel crons run`.

3. **The Sentry check-in** — Sentry (org `tristan-nolan`, project
   `spawnforge-ai`) → Crons → `spawnforge-health-monitor` shows a check-in for
   the run. `withCronMonitor` no-ops when **neither** `SENTRY_DSN` nor
   `NEXT_PUBLIC_SENTRY_DSN` is set (`cronMonitors.ts` reads
   `SENTRY_DSN || NEXT_PUBLIC_SENTRY_DSN`); confirm one of them is set in
   production before concluding the cron failed.

Attach all three to #9118 with the deployment SHA.

## Evidence: the alert path

A monitor that runs but alerts nobody is still not monitoring. Rehearse it on
**one preview branch**, and read the limits below before starting — this
section proves less than it looks like it proves.

1. Make a probe fail on that preview **without removing a shared variable**.
   Preview environment variables are project-wide unless you scope them to a
   branch, and `vercel env rm` destroys the value with nothing to restore
   from. Add a branch-scoped override instead, which is additive and reversible:

   ```bash
   vercel env add UPSTASH_REDIS_REST_URL preview --git-branch <branch> --scope tnolan
   # paste an unreachable value, e.g. https://invalid.invalid
   vercel env add CRON_SECRET preview --git-branch <branch> --scope tnolan
   ```

2. **Redeploy that preview.** Environment variables are injected at build time
   (same reason as activation step 3), so a preview built before step 1 still
   sees the old environment and the probe will report healthy — the rehearsal
   would then fail to produce the condition it is testing.

3. Invoke the route. Preview deployments sit behind Vercel Deployment
   Protection, which answers **401 — the same status `isAuthorizedCron`
   returns** — so send the project's automation bypass header or you cannot
   tell the two apart. Keep the secret out of `argv` and shell history:

   ```bash
   read -rs CRON_SECRET_PREVIEW      # paste; nothing echoes
   read -rs VERCEL_AUTOMATION_BYPASS
   curl -s \
     -H "Authorization: Bearer ${CRON_SECRET_PREVIEW}" \
     -H "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS}" \
     "https://<preview-url>/api/cron/health-monitor" | jq .
   unset CRON_SECRET_PREVIEW VERCEL_AUTOMATION_BYPASS
   ```

   Assert on the JSON body — the degraded service must appear in it — not on
   the status code alone.

4. Confirm a Sentry **issue** is created for the degraded service.

5. Remove the branch-scoped overrides:

   ```bash
   vercel env rm UPSTASH_REDIS_REST_URL preview --git-branch <branch> --scope tnolan
   vercel env rm CRON_SECRET preview --git-branch <branch> --scope tnolan
   ```

**What this rehearsal proves:** the route detects a degraded service and raises
a Sentry issue for it.

**What it does not prove:** that the production alert rule *delivers*. Preview
issues are tagged `environment: preview`, and `docs/sentry-alert-rules.md`
requires Environment = `production` on all P1/P2 rules, so a preview issue is
filtered out by construction and silence here is expected rather than a fault.
Do not "fix" the production rule to accommodate it. To prove delivery, either
add `preview` to that rule's environment filter for the duration of the
rehearsal and remove it afterwards, or accept the first production fire as the
proof. Note too that `captureException` no-ops without a DSN
(`web/src/lib/monitoring/sentry-server.ts`), so confirm the preview has one
before reading silence as a broken alert rule.

## Rotation

Rotate by generating a new value, `vercel env rm CRON_SECRET production` then
`vercel env add` again, and rebuilding production the same way as activation
step 3. Between the rebuild and the next scheduled run the old value is simply
refused (401), which is the safe direction.

## Related

- #9118 — the owner action this runbook supports
- #9719 — probes must stop reporting green on key presence before the monitor is trusted
- #8818 — Sentry Cron check-ins for Vercel-scheduled routes
- `docs/production-support.md` — service inventory and runbooks
- `docs/sentry-alert-rules.md` — the alert rules this monitor feeds
