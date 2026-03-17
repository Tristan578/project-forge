# SpawnForge Production Support Guide

> Last updated: 2026-03-16 | Pass #1 | SDE Audit

## 1. Service Inventory

| Service | Health Check | SLO | Alert | Runbook | Owner |
|---------|-------------|-----|-------|---------|-------|
| Neon Database | `SELECT 1` (5s timeout) | 99.9% uptime, <100ms p99 | db-connection-failure (P0) | See 3.1 | Engineering |
| Clerk Auth | JWKS HEAD (3s timeout) | 99.9% uptime | auth-failure-spike (P0) | See 3.2 | Engineering |
| Stripe Billing | Config check (env var presence) | 99.95% uptime | payment-failure (P1) | See 3.3 | Engineering |
| Sentry Error Tracking | DSN format validation | 99.9% uptime | N/A (meta-monitoring) | See 3.4 | Engineering |
| Cloudflare R2 (Assets) | Config check (4 env vars) | 99.9% uptime | r2-config-failure (P1) | See 3.5 | Engineering |
| Engine CDN (R2 Worker) | HEAD request (5s timeout) | 99.9%, <200ms TTFB | cdn-failure (P1) | See 3.6 | Engineering |
| Anthropic Claude API | HEAD to api.anthropic.com (3s) | 99.5%, <30s generation | ai-generation-failure (P1) | See 3.7 | Engineering |
| Meshy 3D Generation | Config check (env var) | 99%, <60s generation | asset-gen-failure (P2) | See 3.8 | Engineering |
| ElevenLabs Audio | Config check (env var) | 99%, <10s generation | audio-gen-failure (P2) | See 3.9 | Engineering |
| Suno Music | Config check (env var) | 99%, <30s generation | music-gen-failure (P2) | See 3.10 | Engineering |
| WASM Engine | Runtime load (client-side) | 99.9%, <5s init | wasm-panic (P0) | See 3.11 | Engineering |
| Vercel Hosting | Platform managed | 99.99% uptime | deployment-failure (P1) | See 3.12 | Engineering |
| Upstash Redis (Rate Limiting) | Config check (env var) | 99.9% uptime | rate-limit-degraded (P2) | See 3.13 | Engineering |

### Current State Summary

**What exists (strong foundation):**
- Health check library (`web/src/lib/monitoring/healthChecks.ts`) with 10 individual checks
- Aggregated health API at `GET /api/health` with critical vs. non-critical distinction
- Sentry integration (client + server) with performance tracing, session replay, source maps
- Sentry tunnel (`POST /api/sentry`) to bypass ad-blockers
- Post-deploy smoke tests for staging and production (health, homepage, static, WASM)
- CI pipeline with lint, typecheck, unit tests, E2E, security audit, bundle size checks
- CD pipeline with staging-first deployment, quality gates, and automated production promotion
- In-memory rate limiting with IP-based public route protection
- CSP headers, X-Frame-Options, X-Content-Type-Options
- Cost observability DB tables (tokenConfig, tierConfig, costLog, creditTransactions)
- Weekly repository health report (GitHub Actions agent)

**What is missing (gaps identified):**
- No external synthetic monitoring (uptime checks from outside the network)
- No structured log aggregation or search (relies on Vercel's built-in logs)
- No distributed tracing across AI provider call chains
- No database connection pool monitoring or slow query alerts
- No client-side performance metrics collection (Web Vitals)
- No cost anomaly detection for AI provider spend
- No SSL/TLS certificate expiry monitoring
- No CDN cache hit rate monitoring
- No deployment rollback automation (manual Vercel rollback only)
- No defined on-call rotation or PagerDuty integration
- No incident response channel or war room process
- No post-mortem template or blameless review process
- Health check endpoint is not rate-limited (makes real network calls per request)
- Upstash rate limiting listed as a dependency but implementation is in-memory only
- Duplicate health check functions: `checkAuthentication()` and `checkClerk()` do the same thing
- Stripe health check only validates config presence, not API reachability
- R2 and AI provider checks only validate config presence, not actual connectivity

## 2. Incident Severity Levels

| Level | Definition | Response Time | Notification | Example |
|-------|-----------|--------------|-------------|---------|
| P0 | Service down, all users affected | <15 min | PagerDuty + Slack #incidents | DB down, WASM panic, auth failure |
| P1 | Major feature degraded, >10% users | <1 hour | Slack #incidents | AI generation failing, export broken, CDN down |
| P2 | Minor feature degraded, <10% users | <4 hours | Slack #engineering | Asset gen slow, analytics gap, rate limit exhaustion |
| P3 | Cosmetic/non-blocking | Next business day | GitHub issue | UI glitch, doc error, non-critical test failure |

## 3. Runbooks

### 3.1 Database (Neon)

**Health check implementation:** `checkDatabase()` in `healthChecks.ts` runs `SELECT 1` via `@neondatabase/serverless` with 5s timeout.

**Critical service:** Yes. Database failure triggers HTTP 503 on `/api/health`.

**Symptoms:**
- `/api/health` returns `status: "error"`, `database: "unavailable"`
- API routes returning 500 errors
- "connection refused" or "timed out" errors in Sentry

**Impact:** All authenticated features unavailable. Save/load, publish, user settings, cost tracking, billing -- all down.

**Diagnosis steps:**
1. Check `/api/health` response -- look at Database (Neon) service status
2. Check Neon dashboard: https://console.neon.tech
3. Verify `DATABASE_URL` env var on Vercel (Settings > Environment Variables)
4. Check if Neon region is experiencing an outage: https://neonstatus.com

**Recovery:**
1. If Neon outage: wait for resolution; communicate to users via status page
2. If config issue: update `DATABASE_URL` on Vercel, trigger redeployment
3. If connection pool exhaustion: restart Vercel serverless functions (redeploy)
4. If schema mismatch: check recent migrations, rollback if needed

**Prevention:**
- Connection pool monitoring (GAP: not currently implemented)
- Slow query alerting (GAP: not currently implemented)

---

### 3.2 Authentication (Clerk)

**Health check implementation:** `checkClerk()` in `healthChecks.ts` sends HEAD to `https://api.clerk.com/v1/jwks` with Bearer auth, 3s timeout.

**Critical service:** Yes. Clerk failure triggers HTTP 503 on `/api/health`.

**Symptoms:**
- Users cannot sign in or sign up
- `/api/health` shows Clerk as "degraded" or "down"
- 401/403 errors on authenticated routes
- JWKS endpoint unreachable

**Impact:** All authenticated features unavailable. Unauthenticated routes (homepage, `/dev`, published games) still work.

**Diagnosis steps:**
1. Check `/api/health` Clerk service status
2. Check Clerk dashboard: https://dashboard.clerk.com
3. Check Clerk status page: https://status.clerk.com
4. Verify `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` on Vercel

**Recovery:**
1. If Clerk outage: wait for resolution; `/dev` route bypasses auth for development
2. If key rotation needed: update both keys on Vercel, trigger redeployment
3. If JWKS cache stale: Clerk SDK handles this automatically

---

### 3.3 Payments (Stripe)

**Health check implementation:** `checkPayments()` in `healthChecks.ts` validates `STRIPE_SECRET_KEY` presence only. Does not ping Stripe API.

**Symptoms:**
- Subscription creation/update fails
- Webhook events not processing
- Sentry errors from `/api/webhooks/stripe`

**Impact:** Payment processing and tier upgrades unavailable. Existing subscriptions and features continue working.

**Diagnosis steps:**
1. Check `/api/health` Payments (Stripe) status
2. Check Stripe dashboard: https://dashboard.stripe.com
3. Check webhook logs: Stripe Dashboard > Developers > Webhooks
4. Verify `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on Vercel

**Recovery:**
1. If Stripe outage: payments queue and retry automatically
2. If webhook secret rotated: update `STRIPE_WEBHOOK_SECRET` on Vercel, redeploy
3. If failed webhooks: replay events from Stripe dashboard

---

### 3.4 Error Tracking (Sentry)

**Health check implementation:** `checkSentry()` validates DSN format (starts with `https://`, contains `@`). No network call.

**Config:**
- Org: `tristan-nolan`, Project: `spawnforge-ai`
- Client: 10% trace sample rate in prod, 100% in dev
- Session replay: 10% sessions, 100% on error
- Tunnel: `POST /api/sentry` bypasses ad-blockers
- Source maps uploaded and deleted after upload

**Symptoms:**
- No errors appearing in Sentry dashboard
- `/api/health` shows Sentry as "degraded"

**Impact:** Errors not tracked. No user-facing impact, but blind to production issues.

**Diagnosis steps:**
1. Check `/api/health` Sentry status
2. Verify `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` on Vercel
3. Check Sentry status: https://status.sentry.io
4. Test tunnel: `curl -X POST https://spawnforge.ai/api/sentry` (should return 400, not 503)
5. Verify `SENTRY_AUTH_TOKEN` for source map uploads

**Recovery:**
1. If DSN missing: add `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` to Vercel env vars
2. If tunnel broken: check `/api/sentry` route, verify rate limiting not blocking
3. If source maps missing: re-run build with `SENTRY_AUTH_TOKEN` set

---

### 3.5 Asset Storage (Cloudflare R2)

**Health check implementation:** `checkCloudflareR2()` validates 4 env vars: `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`. No actual S3 API call.

**Symptoms:**
- Asset upload failures
- Published game assets not loading
- `/api/health` shows R2 as "degraded" or "down"

**Impact:** Asset upload and retrieval broken. Existing cached assets may still work.

**Diagnosis steps:**
1. Check `/api/health` R2 status
2. Check Cloudflare dashboard: https://dash.cloudflare.com
3. Verify all 4 R2 env vars on Vercel
4. Check R2 bucket `spawnforge-assets` exists and has correct CORS policy

**Recovery:**
1. If Cloudflare R2 outage: wait for resolution
2. If credential rotation: update all 4 env vars, redeploy
3. If bucket deleted: recreate bucket, restore from backup if available

---

### 3.6 Engine CDN (R2 Worker)

**Health check implementation:** `checkEngineCdn()` sends HEAD request to `NEXT_PUBLIC_ENGINE_CDN_URL` with 5s timeout. Accepts 404 (no file at root is OK), rejects 5xx and non-404 4xx.

**CDN config:** Worker `engine-cdn` at `engine.spawnforge.ai`, R2 bucket `spawnforge-engine`.

**Symptoms:**
- WASM engine files load slowly or fail to load
- Post-deploy smoke test "WASM available" check fails
- `/api/health` shows Engine CDN as "degraded"

**Impact:** Engine load time increases (falls back to Vercel-hosted WASM). Not a hard failure -- local copies exist as fallback.

**Diagnosis steps:**
1. Check `/api/health` Engine CDN status
2. Test directly: `curl -I https://engine.spawnforge.ai/engine-pkg-webgl2/forge_engine_bg.wasm`
3. Check Cloudflare Workers dashboard for errors
4. Verify `NEXT_PUBLIC_ENGINE_CDN_URL` on Vercel

**Recovery:**
1. If Worker down: check `infra/engine-cdn/worker.js`, redeploy via Wrangler
2. If R2 bucket issue: verify `spawnforge-engine` bucket exists
3. If CDN stale: re-run `/deploy-engine` skill to upload fresh WASM binaries
4. Fallback: app automatically serves WASM from Vercel if CDN unavailable

---

### 3.7 Anthropic Claude API

**Health check implementation:** `checkAnthropic()` sends HEAD to `https://api.anthropic.com` (no tokens consumed), 3s timeout.

**Symptoms:**
- AI chat generation fails or times out
- Compound actions (create_scene, etc.) fail
- Sentry errors from chat API routes

**Impact:** AI-powered features unavailable. Manual editing still works. BYOK users with their own API keys may be unaffected.

**Diagnosis steps:**
1. Check `/api/health` Anthropic status
2. Check Anthropic status: https://status.anthropic.com
3. Verify `ANTHROPIC_API_KEY` on Vercel
4. Check cost observability: are tokens depleted?
5. Check rate limiting: has the API key been rate-limited?

**Recovery:**
1. If Anthropic outage: wait for resolution; AI features degrade gracefully
2. If API key revoked: generate new key, update on Vercel
3. If rate limited: check admin economics dashboard (`/admin/economics`) for spend patterns
4. If token budget exhausted: top up via Anthropic console

---

### 3.8 Meshy 3D Generation

**Health check implementation:** Config check only (`MESHY_API_KEY` presence in `checkAiProviders()`).

**Symptoms:**
- 3D model generation fails
- Meshy dialog shows error state

**Impact:** 3D asset generation unavailable. Users can still import models manually.

**Diagnosis steps:**
1. Check `/api/health` AI Providers status
2. Verify `MESHY_API_KEY` on Vercel
3. Check Meshy dashboard for API status/quota

**Recovery:**
1. Update API key if expired
2. Check Meshy billing/quota

---

### 3.9 ElevenLabs Audio

**Health check implementation:** Config check only (`ELEVENLABS_API_KEY` presence).

**Symptoms:**
- Voice and SFX generation fails

**Impact:** Audio generation unavailable. Manual audio import still works.

**Recovery:** Same pattern as 3.8.

---

### 3.10 Suno Music

**Health check implementation:** Config check only (`SUNO_API_KEY` presence).

**Symptoms:**
- Music generation fails

**Impact:** Music generation unavailable. Manual audio import still works.

**Recovery:** Same pattern as 3.8.

---

### 3.11 WASM Engine

**Health check implementation:** No server-side check. Engine loads client-side via `useEngine.ts` hook. Post-deploy smoke test checks binary availability.

**Symptoms:**
- Editor canvas blank or shows loading spinner indefinitely
- Browser console shows WASM panic or OOM
- `useEngine.ts` error callback fires

**Impact:** P0. Editor completely non-functional. Users cannot create or edit games.

**Diagnosis steps:**
1. Check browser console for WASM errors
2. Verify WASM files exist: `curl -I https://spawnforge.ai/engine-pkg-webgl2/forge_engine_bg.wasm`
3. Check CDN: `curl -I https://engine.spawnforge.ai/engine-pkg-webgl2/forge_engine_bg.wasm`
4. Check CI build logs for WASM compilation errors
5. Check WASM binary size (should be ~47MB, threshold 50MB)

**Recovery:**
1. If WASM binary missing: re-run CD pipeline or `/deploy-engine` skill
2. If WASM panic: check Sentry for error details, may need engine code fix
3. If size regression: check CI binary size check, may need feature removal
4. If WebGPU-specific: browser falls back to WebGL2 automatically

**Known issue:** `initPromise` does not reset on timeout (PF-585), blocking retry. Workaround: page refresh.

---

### 3.12 Vercel Hosting

**Health check implementation:** Platform managed. Not checked by health endpoint.

**Symptoms:**
- Site completely unreachable
- Build/deploy failures in GitHub Actions

**Impact:** P0 if site unreachable. P1 if deploys blocked.

**Diagnosis steps:**
1. Check Vercel status: https://www.vercel-status.com
2. Check GitHub Actions CD workflow for deployment errors
3. Verify `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` secrets

**Recovery:**
1. If Vercel outage: wait for resolution
2. If deploy failure: check build logs, fix code, re-run CD
3. Manual rollback: Vercel Dashboard > Deployments > promote previous deployment

---

### 3.13 Rate Limiting (Upstash)

**Health check implementation:** `checkRateLimiting()` validates `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` presence.

**Current state:** Health check references Upstash, but actual rate limiting is IN-MEMORY (`web/src/lib/rateLimit.ts`). Upstash is not wired up yet.

**Impact:** In-memory rate limiting resets on cold start and is per-instance (not distributed). Under load, rate limits may not be effective.

**Diagnosis steps:**
1. Check if Upstash env vars are configured
2. Review rate limit effectiveness via API response headers (`X-RateLimit-Remaining`)

**Recovery:**
1. In-memory rate limiting provides basic protection
2. Vercel Edge and Cloudflare provide upstream rate limiting

---

## 4. Monitoring Thresholds

### Error Rate Thresholds

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| Overall error rate | >1% for 5min | >5% for 2min | Page on-call |
| API 5xx rate | >0.5% for 10min | >2% for 5min | Page on-call |
| WASM panic rate | Any panic | >1 in 5min | Page on-call immediately |
| Auth failure rate | >5 in 5min | >20 in 5min | Page on-call + review security |
| Payment failure (charge.failed) | Any occurrence | N/A | Page on-call + review billing |

### Latency Thresholds

| Endpoint | p50 | p95 | p99 | Action if exceeded |
|----------|-----|-----|-----|--------------------|
| `/api/health` | <50ms | <200ms | <500ms | Alert if p99 >1s |
| API routes (general) | <100ms | <500ms | <2s | Alert if p99 >5s |
| AI generation (Claude) | <5s | <15s | <30s | Alert if p99 >60s |
| AI generation (Meshy 3D) | <15s | <45s | <60s | Alert if >120s |
| WASM engine init | <2s | <5s | <10s | Alert if >15s |
| Page load (LCP) | <1.5s | <2.5s | <4s | Alert if >4s |
| Database queries | <20ms | <50ms | <100ms | Alert if p99 >500ms |

### Resource Thresholds

| Resource | Warning | Critical |
|----------|---------|----------|
| DB connection pool | >60% utilized | >80% utilized |
| Token balance (per user) | <10% tier allocation | 0 remaining |
| JS bundle size | >3.5MB | >4MB |
| WASM binary size | >47MB (current) | >50MB (CI threshold) |
| Client memory (heap) | >500MB | >1GB |
| Vercel function duration | >5s | >10s (Vercel limit) |
| AI provider monthly spend | >80% budget | >100% budget |

## 5. CI/CD Pipeline

### Quality Gates (must all pass for deployment)

| Gate | Tool | Where |
|------|------|-------|
| Lint (zero warnings) | ESLint | CI + CD |
| Type checking | TypeScript `tsc --noEmit` | CI + CD |
| Unit tests (5000+) | Vitest | CI + CD |
| MCP tests (25+) | Vitest | CI + CD |
| WASM build | Cargo + wasm-bindgen | CI + CD |
| E2E UI tests | Playwright | CI + CD |
| Security audit | `npm audit` + `cargo audit` | CI + CD |
| Bundle size check | Custom script | CI |
| WASM binary size check | Custom script | CI |
| MCP command parity | Custom script | CI |

### Deployment Flow

```
Push to main
  -> Lint + TypeScript + Tests + WASM Build + E2E + Security (parallel)
  -> Upload WASM to R2 CDN (if enabled)
  -> Deploy to Staging (Vercel preview)
  -> Smoke test staging (health, homepage, static, WASM)
  -> Deploy to Production (Vercel prod)
  -> Smoke test production
```

### Post-Deploy Smoke Tests

The `post-deploy-smoke.yml` workflow verifies 4 checks:
1. `/api/health` returns 200 with valid JSON
2. Homepage returns 200 and contains "SpawnForge"
3. `/manifest.json` returns 200
4. WASM binary (`/engine-pkg-webgl2/forge_engine_bg.wasm`) returns 200 with correct content-type

## 6. Escalation Matrix

| Level | Who | When |
|-------|-----|------|
| L1 | On-call engineer | First responder, all P0-P2 incidents |
| L2 | Engineering lead | If L1 cannot resolve in 30 min, or any P0 |
| L3 | CTO/Founder | P0 lasting >1 hour, data loss risk, security breach |

## 7. On-Call Rotation

**Current state: NOT CONFIGURED.**

Immediate actions needed:
- Set up PagerDuty or Opsgenie for alert routing
- Define rotation schedule
- Create Slack #incidents channel
- Wire Sentry alerts to PagerDuty

## 8. Post-Incident Process

1. Incident declared in Slack #incidents (to be created)
2. War room initiated for P0/P1 (video call link in channel topic)
3. Incident commander assigned (on-call engineer or escalation)
4. Status updates every 30 min for P0, every 1 hour for P1
5. Resolution verified via smoke tests and health check
6. Post-mortem document within 48 hours (blameless)
7. Action items tracked as PF-tickets on taskboard
8. Runbook updated with learnings from incident
9. Monitoring improved if gap discovered

### Post-Mortem Template

```markdown
## Incident Post-Mortem: [Title]

**Date:** YYYY-MM-DD
**Duration:** X hours Y minutes
**Severity:** P0/P1/P2
**Impact:** [Number of users affected, features degraded]

### Timeline
- HH:MM — [Event]
- HH:MM — [Detection]
- HH:MM — [Response]
- HH:MM — [Resolution]

### Root Cause
[Detailed technical explanation]

### What Went Well
- [Item]

### What Went Poorly
- [Item]

### Action Items
| Action | Owner | Ticket | Due Date |
|--------|-------|--------|----------|
| [Description] | [Name] | PF-XXX | YYYY-MM-DD |
```

## 9. Environment Variables Inventory

### Critical (P0 if missing in production)

| Variable | Service | Server/Client |
|----------|---------|---------------|
| `DATABASE_URL` | Neon | Server |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk | Client |
| `CLERK_SECRET_KEY` | Clerk | Server |

### Important (P1 if missing)

| Variable | Service | Server/Client |
|----------|---------|---------------|
| `STRIPE_SECRET_KEY` | Stripe | Server |
| `STRIPE_WEBHOOK_SECRET` | Stripe | Server |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry | Client |
| `SENTRY_DSN` | Sentry | Server |
| `SENTRY_AUTH_TOKEN` | Sentry source maps | Build |
| `ANTHROPIC_API_KEY` | Claude AI | Server |
| `NEXT_PUBLIC_ENGINE_CDN_URL` | Engine CDN | Client |
| `CLOUDFLARE_ACCOUNT_ID` | R2 | Server |
| `R2_ACCESS_KEY_ID` | R2 | Server |
| `R2_SECRET_ACCESS_KEY` | R2 | Server |
| `R2_BUCKET_NAME` | R2 | Server |

### Optional (P2 if missing)

| Variable | Service | Server/Client |
|----------|---------|---------------|
| `MESHY_API_KEY` | Meshy 3D gen | Server |
| `ELEVENLABS_API_KEY` | ElevenLabs audio | Server |
| `SUNO_API_KEY` | Suno music | Server |
| `UPSTASH_REDIS_REST_URL` | Rate limiting | Server |
| `UPSTASH_REDIS_REST_TOKEN` | Rate limiting | Server |
| `VERCEL_TOKEN` | Deployment | CI/CD |
| `VERCEL_ORG_ID` | Deployment | CI/CD |
| `VERCEL_PROJECT_ID` | Deployment | CI/CD |

## 10. Known Limitations and Risks

1. **Rate limiting is in-memory only.** The health check references Upstash, but `rateLimit.ts` uses an in-memory `Map`. This resets on cold start and is per-serverless-instance, not distributed. Under sustained attack, rate limits are ineffective.

2. **No external uptime monitoring.** All health checks are self-reported. If Vercel is down, the health endpoint is unreachable. Need external synthetic monitoring (e.g., Checkly, Better Uptime).

3. **No structured logging.** Server logs go to Vercel's built-in log viewer which has limited retention (1 hour for free, 3 days for Pro). No log aggregation, search, or alerting on log patterns.

4. **No distributed tracing for AI calls.** AI generation involves multiple services (Claude, Meshy, ElevenLabs) but traces do not span across providers. Latency attribution is manual.

5. **Health endpoint is not rate-limited.** Each call to `/api/health` triggers real network requests (DB query, Clerk JWKS fetch, CDN HEAD). A DDoS on `/api/health` could amplify to downstream services.

6. **Duplicate health checks.** `checkAuthentication()` and `checkClerk()` both check Clerk JWKS. `runAllHealthChecks()` only calls `checkClerk()`, but `checkAuthentication()` is still exported and could cause confusion.

7. **WASM init has no retry.** If `initPromise` fails, it is not reset (PF-585). Users must manually refresh the page.

8. **No deployment rollback automation.** Rollback requires manual action in Vercel dashboard. No "one-click rollback" in CI/CD.

9. **No client-side Web Vitals collection.** LCP, FID, CLS, INP are not being reported to any backend for monitoring.

10. **AI provider cost has no automatic circuit breaker.** If API costs spike (e.g., due to a bug generating infinite requests), there is no automatic shutoff beyond per-user token limits.

---

## 11. SSL/TLS Certificate Management

### 11.1 Certificate Ownership

| Domain | Certificate Provider | Renewal Mechanism | Managed By |
|--------|---------------------|-------------------|------------|
| `spawnforge.ai` | Let's Encrypt (via Vercel) | Automatic (60-day certificates, renewed at 30 days) | Vercel |
| `www.spawnforge.ai` | Let's Encrypt (via Vercel) | Automatic | Vercel |
| `engine.spawnforge.ai` | Cloudflare Universal SSL | Automatic (90-day certificates) | Cloudflare |

### 11.2 How Auto-Renewal Works

**Vercel (spawnforge.ai)**

Vercel automatically provisions and renews Let's Encrypt certificates for all custom domains attached to a project. Renewal is triggered approximately 30 days before expiry. No manual action is required under normal circumstances. Vercel retries failed renewals and surfaces errors in the project dashboard under "Domains".

**Cloudflare (engine.spawnforge.ai)**

The `engine.spawnforge.ai` domain is a Cloudflare custom hostname backed by the `engine-cdn` Worker. Cloudflare Universal SSL covers all hostnames under the zone and renews automatically. The CDN Worker (`infra/engine-cdn/worker.js`) adds CORS headers but does not touch TLS — certificate management is entirely Cloudflare's responsibility.

### 11.3 Verifying Certificates Manually

Use the provided script to check certificate expiry for all SpawnForge domains:

```bash
# Standard check — prints a human-readable report
bash scripts/verify-ssl-certs.sh

# Check with custom thresholds
bash scripts/verify-ssl-certs.sh --warn-days 45 --alert-days 14

# JSON output (suitable for piping to monitoring systems)
bash scripts/verify-ssl-certs.sh --json

# Quiet mode (only prints warnings/alerts, suppresses info output)
bash scripts/verify-ssl-certs.sh --quiet
```

Exit codes:
- `0` — All certificates healthy (expiry > 30 days by default)
- `1` — One or more certificates expire within the warn threshold
- `2` — One or more certificates expire within the alert threshold (treat as incident)
- `3` — Could not retrieve one or more certificates (connectivity or TLS error)

You can also check a domain directly with `openssl`:

```bash
# Show certificate expiry date
echo "" | openssl s_client -connect spawnforge.ai:443 -servername spawnforge.ai 2>/dev/null \
  | openssl x509 -noout -enddate

# Full certificate details
echo "" | openssl s_client -connect engine.spawnforge.ai:443 -servername engine.spawnforge.ai 2>/dev/null \
  | openssl x509 -noout -text
```

### 11.4 What To Do If Auto-Renewal Fails

**Vercel certificate failure:**

1. Go to the Vercel dashboard → Project → Settings → Domains.
2. Find the domain showing a certificate error. Vercel will display the error type (DNS propagation, CAA record conflict, etc.).
3. If the domain is correctly configured and Vercel renewal still fails, click "Refresh" to trigger an immediate re-attempt.
4. If the domain shows "Invalid Configuration", verify the DNS records in Cloudflare match Vercel's required CNAME/A record.
5. As a last resort, remove and re-add the custom domain in Vercel — this triggers a fresh certificate issuance.
6. **Escalation:** Open a Vercel support ticket. Vercel SLA for enterprise is 4 hours; Pro tier is best-effort.

**Cloudflare certificate failure:**

1. Go to the Cloudflare dashboard → SSL/TLS → Edge Certificates.
2. Check whether Universal SSL is showing "Active" or "Pending". Pending can take up to 24 hours on a new zone.
3. If Universal SSL is disabled, re-enable it under SSL/TLS → Overview → Universal SSL → Enable.
4. If the certificate is stuck in "Pending Validation", check that there are no conflicting CAA DNS records that exclude Cloudflare's issuer (`digicert.com` or `letsencrypt.org`).
5. **Escalation:** Open a Cloudflare support ticket. Cloudflare resolves certificate issues within hours for paid plans.

**Emergency fallback (certificate expired, site unreachable over HTTPS):**

1. Temporarily disable "Always Use HTTPS" in Cloudflare to allow HTTP traffic while the certificate is renewed.
2. Post a status update on the SpawnForge status page immediately.
3. Work the Vercel or Cloudflare support channels in parallel.
4. Re-enable "Always Use HTTPS" immediately after renewal completes.

### 11.5 Monthly Verification Checklist

Add the following item to the monthly ops review:

- [ ] Run `bash scripts/verify-ssl-certs.sh` and confirm exit code 0.
- [ ] Verify both domains return expiry > 30 days from today.
- [ ] Check Vercel dashboard "Domains" tab for any certificate warnings.
- [ ] Check Cloudflare dashboard "SSL/TLS → Edge Certificates" for any anomalies.
- [ ] If a certificate is < 45 days from expiry, open a tracking ticket and monitor daily.

This check takes under 2 minutes and should be part of the standard monthly on-call handoff.
