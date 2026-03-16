# Incident Runbook

> **Last updated:** 2026-03-16

## SLA Targets

| Priority | Description | Response Time | Resolution Time | Examples |
|----------|-------------|---------------|-----------------|----------|
| P1 — Critical | Site down, data loss, security breach | 30 minutes | 4 hours | Production outage, DB corruption, auth bypass |
| P2 — Degraded | Major feature broken, significant perf degradation | 4 hours | 24 hours | WASM CDN failure, payment processing down, AI generation broken |
| P3 — Minor | Non-critical bug, cosmetic issue, minor perf regression | 24 hours | 72 hours | UI glitch, tooltip wrong, non-blocking error in logs |

## Escalation Path

```
1. Sentry Alert fires
   |
2. Slack #incidents channel notification (via Sentry integration)
   |
3. On-call engineer acknowledges within SLA response time
   |
4. PagerDuty escalation (when configured) if no acknowledgment
   |
5. Engineering lead notified for P1 after 15 minutes without response
```

### Contact Points

| Role | Channel | When |
|------|---------|------|
| On-call engineer | Slack #incidents | All alerts |
| Engineering lead | Slack DM + phone | P1 unacknowledged after 15 min |
| Product lead | Slack #incidents | P1 confirmed, P2 customer-facing |

## Incident Response Process

### 1. Acknowledge
- Respond in Slack #incidents with "Investigating" and your name
- Set Sentry issue status to "In Progress"

### 2. Assess
- Determine priority (P1/P2/P3) based on impact scope
- Identify affected systems (DB, CDN, auth, payments, engine)
- Check: Is this a new deploy? If yes, consider immediate rollback

### 3. Mitigate
- Apply the relevant recovery procedure below
- Communicate status updates every 15 minutes for P1, every hour for P2

### 4. Resolve
- Confirm service restored
- Write postmortem for P1/P2 within 48 hours
- Create follow-up tickets for root cause fixes

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
   - Communicate to users via status page
4. If keys are rotated or expired:
   - Update keys in Vercel environment variables
   - Redeploy (Vercel > Deployments > Redeploy)

## Rollback Procedure

Vercel provides instant rollback to any previous deployment.

**Steps:**
1. Go to Vercel dashboard > Deployments
2. Find the last known-good deployment
3. Click "..." menu > "Promote to Production"
4. Verify the rollback resolved the issue
5. If the issue is in WASM (not web):
   - WASM is served from CDN, not Vercel -- rollback will not help
   - Re-upload previous WASM build using `/deploy-engine` skill

## Sentry Configuration

- **Organization:** `tristan-nolan`
- **Project:** `spawnforge-ai`
- **Dashboard:** https://sentry.io/organizations/tristan-nolan/projects/spawnforge-ai/

### Recommended Alert Rules

See `monitoring-setup.md` for detailed alert rule configuration.
