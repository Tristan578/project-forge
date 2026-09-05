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
request is answered 401. Production has no `CRON_SECRET`, so every scheduled
invocation since the route shipped has been rejected before a single check ran
— "monitoring" has been a 401 every fifteen minutes.

Two consequences that this runbook exists to prevent:

1. Nobody is told about an outage by the monitor; users tell us.
2. Once the secret IS set, the monitor inherits whatever the probes say. Until
   #9719 lands the AI Providers and Stripe probes report `up` on key presence
   alone (lesson 1 in `.claude/rules/lessons-learned.md`), so the monitor would
   have certified a production with zero generation keys as healthy. **Do the
   activation after #9719 is on `main`**, or accept that the first runs are
   evidence of authentication only, not of service health.

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

3. Redeploy production — env vars are injected at build/boot, the live
   deployment will not pick the value up:

   ```bash
   vercel deploy --prod --scope tnolan
   ```

## Evidence: one successful run

Fire the cron on demand rather than waiting for the schedule, then read the
result from three independent places. Attach all three to #9118 with the
deployment SHA.

1. **Registration and trigger**

   ```bash
   vercel crons ls --scope tnolan
   vercel crons run /api/cron/health-monitor --scope tnolan
   ```

2. **The HTTP status of the invocation** — it must be `200`. The route returns
   200 even when a service is unhealthy (Vercel backs off a cron that returns
   non-200; service failures go to Sentry instead), so `200` proves
   *authentication*, and only the body/Sentry speak to health.

   ```bash
   vercel logs https://www.spawnforge.ai --scope tnolan --json \
     | grep '"/api/cron/health-monitor"' | tail -n 3
   ```

   Or in the Vercel dashboard: project `spawnforge` → Logs → filter path
   `/api/cron/health-monitor`. Before activation every line reads `401`; after,
   the new lines must read `200`. Quote one 200 line verbatim on the issue.

3. **The Sentry check-in** — Sentry (org `tristan-nolan`, project
   `spawnforge-ai`) → Crons → `spawnforge-health-monitor` shows a check-in for
   the run. The wrapper no-ops without `SENTRY_DSN`; if no check-in appears,
   confirm `SENTRY_DSN` is set in production before concluding the cron failed.

## Evidence: the alert path

A monitor that runs but alerts nobody is still not monitoring. Prove the path
once, in **preview**, without touching production:

1. On a preview deployment, set `CRON_SECRET` and unset one probed variable
   (for example `UPSTASH_REDIS_REST_URL`) so a probe reports `degraded`.
2. Invoke the route with the header Vercel would send:

   ```bash
   curl -s -H "Authorization: Bearer <the preview CRON_SECRET>" \
     https://<preview-url>/api/cron/health-monitor | jq .
   ```

3. Confirm a Sentry issue is created for the degraded service and that the
   alert rule for project `spawnforge-ai` delivers it (email/Slack) to the
   owner. Screenshot the notification and attach it to #9118.
4. Restore the preview variable.

If step 3 produces no notification, the gap is the Sentry alert rule, not the
cron — fix that before calling the monitor live.

## Rotation

Rotate by generating a new value, `vercel env rm CRON_SECRET production` then
`vercel env add` again, and redeploying. Between the redeploy and the next
scheduled run the old value is simply refused (401), which is the safe
direction.

## Related

- #9118 — the owner action this runbook supports
- #9719 — probes must stop reporting green on key presence before the monitor is trusted
- #8818 — Sentry Cron check-ins for Vercel-scheduled routes
- `docs/production-support.md` — service inventory and runbooks
