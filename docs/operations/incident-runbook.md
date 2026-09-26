# Incident Runbook

> **Last updated:** 2026-09-24

## Response Process

This file holds recovery and rollback procedures only. The severity model
(P0/P1/P2), the first-response steps and what "resolved" means are defined
once, in `docs/operations/incident-response.md`. There is no on-call rotation
or paging service — see `docs/decisions/2026-09-24-no-paging-or-on-call.md`.

## Recovery Procedures

### Database Down (Neon)

**Symptoms:** API routes returning 500, "DATABASE_URL" errors in Sentry, circuit breaker tripping.

**Steps:**
1. Check Neon dashboard (https://console.neon.tech) for service status
2. Verify `DATABASE_URL` environment variable is set in Vercel
3. Check Neon project status -- if suspended, reactivate from dashboard
4. If Neon is experiencing an outage, enable maintenance mode:
   - The circuit breaker (`web/src/lib/db/circuitBreaker.ts`) will auto-trip after repeated failures
   - Users will see degraded service but the app will not crash
5. If data corruption suspected:
   - Use Neon point-in-time recovery (see `backup-recovery.md`)
   - RPO: < 1 hour, RTO: < 4 hours

### WASM CDN Failure (Cloudflare R2)

**Symptoms:** Editor canvas blank, "Failed to load WASM" errors, engine-pkg-* 404s.

**Steps:**
1. Check Cloudflare dashboard for R2 bucket `spawnforge-engine` status
2. Verify `engine-cdn` Worker is running at `engine.spawnforge.ai`
3. Test direct access: `curl -I https://engine.spawnforge.ai/engine-pkg-webgpu/spawnforge_engine_bg.wasm`
4. If CDN is down but R2 is healthy:
   - Redeploy the Worker: `cd infra/engine-cdn && npx wrangler deploy`
5. If R2 is down:
   - Temporarily serve WASM from Vercel public directory (already present as fallback)
   - Set `NEXT_PUBLIC_ENGINE_CDN_URL` to empty string to use local assets
6. Re-upload if files are corrupted: run `/deploy-engine` skill

### Stripe Webhook Failure

**Symptoms:** Payments processing but tier not upgrading, tokens not granted, Sentry errors on `/api/webhooks/stripe`.

**Steps:**
1. Check Stripe dashboard > Developers > Webhooks for failed deliveries
2. Verify webhook signing secret matches `STRIPE_WEBHOOK_SECRET` in Vercel env
3. Check webhook event log for the specific failing event types
4. If events are queuing:
   - Stripe retries automatically for up to 72 hours
   - Manually replay failed events from Stripe dashboard if urgent
5. If endpoint is returning errors:
   - Check Sentry for the specific error
   - Common issue: webhook idempotency table (`webhookEvents`) constraint violation -- safe to ignore (means event was already processed)
6. Verify the webhook URL is correct: `https://spawnforge.ai/api/webhooks/stripe`

### Clerk Auth Failure

**Symptoms:** Users cannot sign in, 401 errors on all authenticated routes, Clerk SDK errors.

**Steps:**
1. Check Clerk dashboard (https://dashboard.clerk.com) for service status
2. Verify environment variables in Vercel:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
   - `CLERK_WEBHOOK_SECRET`
3. If Clerk is experiencing an outage:
   - The app will be largely non-functional for authenticated features
   - The `/dev` route bypasses auth for local testing but is gated in production
   - Post an update in #incidents if one is configured (there is no manually updated status page; https://spawnforge.ai/health shows live status)
4. If keys are rotated or expired:
   - Update keys in Vercel environment variables
   - Redeploy (Vercel > Deployments > Redeploy)

## Rollback Procedure

Vercel provides Instant Rollback to any deployment that has served production.
Under Rolling Releases, **"Promote to Production" is not a rollback**: a promote
of the old build starts a staged rollout of it, or is a silent no-op while a
rollout is active — neither reverts traffic.

**Steps:**
1. Identify the build that is live and the last known-good one. The Deployments
   list cannot tell you which deployment serves production (`vercel ls` prints
   `● Ready` for every row):
   ```bash
   curl -s https://www.spawnforge.ai/api/health | jq .commit   # what is live
   vercel rolling-release fetch --scope tnolan --cwd web       # currentDeployment = the base while a rollout is active
   gh run list --workflow=cd.yml --limit=3                     # the last run logged `Last-known-good production URL:`
   ```
2. Roll back with Instant Rollback — one of:
   - Vercel dashboard > Deployments > `⋮` on the last known-good deployment > **Instant Rollback**
   - `vercel rollback <last-good-deployment-url> --yes --scope tnolan`
   - `gh workflow run cd.yml -f rollback_production=<last-good-deployment-url>`
3. Verify the rollback is live: `curl -s https://www.spawnforge.ai/api/health | jq .commit`
   must equal the restored deployment's commit (a status code says nothing about
   which build answered).
4. Undo the rollback once a fix is ready. Instant Rollback turns **auto-assignment
   of production domains off**: pushes to `main` do not go live by themselves until
   a rolling release completes. CD's `ensure-canary` step starts its rollout
   explicitly; if that run reports it could not become the canary, run
   `vercel promote <fixed-deployment-url> --scope tnolan`
   (vercel.com/docs/instant-rollback#undo-a-rollback).
5. If the issue is in WASM (not web):
   - WASM is served from CDN, not Vercel -- rollback will not help
   - Re-upload previous WASM build using `/deploy-engine` skill

## Sentry Configuration

- **Organization:** `tristan-nolan`
- **Project:** `spawnforge-ai`
- **Dashboard:** https://sentry.io/organizations/tristan-nolan/projects/spawnforge-ai/

### Recommended Alert Rules

See `monitoring-setup.md` for detailed alert rule configuration.
