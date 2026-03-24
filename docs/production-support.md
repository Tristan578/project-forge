# SpawnForge Production Support Handbook

## Audit Changelog

| Pass | Date | Changes | Rationale |
|------|------|---------|-----------|
| #1 | 2026-03-16 | Initial audit: created document, 11 tickets (PF-607 to PF-617) | Baseline operational readiness assessment |
| #2 | 2026-03-16 | Deepened runbooks with copy-pasteable commands; added dependency map, degraded mode behavior, capacity planning, disaster recovery, security incident playbook; corrected SLOs; reviewed all 11 tickets | Pass #1 had placeholder runbooks lacking actionable commands; missing DR/capacity/security sections |

---

## 1. Service Inventory

| Service | Provider | Purpose | Health Check | Critical? |
|---------|----------|---------|--------------|-----------|
| Web App | Vercel (Next.js 16) | Editor UI, API routes | `GET /api/health` | Yes |
| Database | Neon (PostgreSQL) | User data, projects, assets, cost logs | `SELECT 1` via health check | Yes |
| Authentication | Clerk | User auth, session management | HEAD `api.clerk.com/v1/jwks` | Yes |
| Payments | Stripe | Subscriptions, billing | Config check only (no live ping) | Yes |
| Error Tracking | Sentry | Error capture, tracing, replay | DSN format validation | No |
| Asset Storage | Cloudflare R2 | User assets, marketplace files | Config check (4 env vars) | No |
| Engine CDN | Cloudflare R2 + Worker | WASM binary delivery | HEAD `engine.spawnforge.ai/` | No |
| Rate Limiting | Upstash Redis | Distributed rate limiting | Config check | No |
| AI (Anthropic) | Anthropic API | Chat, scene generation | HEAD `api.anthropic.com` | No |
| AI (Meshy) | Meshy API | 3D model generation | Config check | No |
| AI (ElevenLabs) | ElevenLabs API | SFX/voice generation | Config check | No |
| AI (Suno) | Suno API | Music generation | Config check | No |

### Critical vs Non-Critical

Only **Database (Neon)** and **Clerk** trigger HTTP 503 on the health endpoint. All other services degrade gracefully -- the app remains usable without AI, payments, or asset storage.

---

## 2. Service Level Objectives (SLOs)

| Metric | Target | Measurement | Alert Threshold |
|--------|--------|-------------|-----------------|
| Availability | 99.9% (8.7h downtime/year) | External synthetic monitor (1-min interval, 3 regions) | 2 consecutive failures = page |
| Health endpoint latency (p99) | < 3s | Sentry transaction traces | > 5s for 5 min |
| Homepage TTFB (p95) | < 1.5s | Web Vitals reporting | > 3s for 10% of sessions |
| LCP (p75) | < 2.5s | Web Vitals reporting | > 4s warning, > 6s critical |
| CLS (p75) | < 0.1 | Web Vitals reporting | > 0.25 |
| INP (p75) | < 200ms | Web Vitals reporting | > 500ms |
| WASM init (p95) | < 8s | Custom Sentry measurement | > 10s |
| API error rate (5xx) | < 1% | Sentry/Vercel analytics | > 2% for 5 min |
| AI generation success rate | > 95% | costLog table aggregation | < 90% for 15 min |
| DB query latency (p99) | < 500ms | Sentry spans | > 1s for 5 min |
| Deploy success rate | 100% | CD workflow outcomes | Any failure = investigate |

---

## 3. Dependency Map

```
User Browser
  |
  v
Vercel Edge (CDN, routing, headers)
  |
  +---> Next.js App (API Routes + SSR)
  |       |
  |       +---> Neon (PostgreSQL)      -- user data, projects, cost logs, credits
  |       |       (DATABASE_URL)
  |       |
  |       +---> Clerk (Auth)           -- session validation, user management
  |       |       (CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  |       |
  |       +---> Stripe (Payments)      -- subscriptions, webhooks
  |       |       (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET)
  |       |
  |       +---> Anthropic API          -- AI chat, scene generation
  |       |       (ANTHROPIC_API_KEY)
  |       |
  |       +---> Meshy / ElevenLabs / Suno  -- AI asset generation
  |       |
  |       +---> Cloudflare R2          -- asset upload/download (S3 API)
  |       |       (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)
  |       |
  |       +---> Upstash Redis          -- distributed rate limiting
  |       |       (UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN)
  |       |
  |       +---> Sentry                 -- error tracking, tracing
  |               (SENTRY_DSN, via /api/sentry tunnel)
  |
  +---> Engine CDN (engine.spawnforge.ai)  -- WASM binary delivery
          Cloudflare Worker -> R2 bucket (spawnforge-engine)
```

### Failure Cascade Analysis

| If this goes down... | What breaks | What still works |
|---------------------|-------------|------------------|
| **Neon (Database)** | All authenticated operations, projects, save/load, marketplace, admin, cost tracking | Static pages, WASM engine (cached), local-only editing (no save) |
| **Clerk (Auth)** | Login, signup, all authenticated API routes, user tier checks | Public pages, health check, already-loaded editor sessions (until token expires) |
| **Stripe** | New subscriptions, plan changes, webhook processing | Existing users retain current tier, all editing features work |
| **Anthropic API** | AI chat, scene generation, compound AI actions | Manual editing, all non-AI features, asset import/export |
| **R2 (Assets)** | Asset upload/download, marketplace, published game hosting | Editor with local assets, WASM engine (separate CDN) |
| **Engine CDN** | New WASM loads for new visitors | Returning visitors with cached WASM, Vercel fallback if R2_CDN_ENABLED=false |
| **Upstash Redis** | Distributed rate limiting (falls back to in-memory per-instance) | All features; rate limiting still works per-instance |
| **Sentry** | Error tracking, tracing, replay capture | All features; errors just go untracked |

---

## 4. Degraded Mode Behavior

### Database Down
- Health endpoint returns HTTP 503
- All `/api/*` routes requiring auth will fail (Clerk may still validate JWTs, but DB-dependent operations fail)
- Users already in the editor can continue editing locally but cannot save
- Mitigation: Neon has automatic failover; check Neon dashboard

### Auth Down
- Health endpoint returns HTTP 503
- New logins fail; existing sessions with valid JWTs may continue briefly
- `/dev` route (development bypass) still accessible
- Mitigation: Clerk has 99.99% SLA; check status.clerk.com

### AI Providers Down
- Health endpoint stays 200 (non-critical)
- AI chat shows error messages; manual editing fully functional
- Per-provider: if only one provider is down, other generation types still work

### CDN Down
- New users cannot load WASM engine
- If `R2_CDN_ENABLED != 'true'`, Vercel serves WASM from `/public/` as fallback
- Users with browser-cached WASM are unaffected

---

## 5. Runbooks

### 5.1 Complete Outage (Site Unreachable)

**Detection:** External synthetic monitor fires after 2 consecutive failures (~3 min). PagerDuty alert: "SpawnForge Unreachable".

**Verification:**
```bash
# From your local machine or a different network:
curl -sS -o /dev/null -w "HTTP %{http_code} | TTFB: %{time_starttransfer}s\n" \
  --max-time 10 https://spawnforge.ai/api/health

# Check Vercel deployment status:
vercel ls --scope=<team> --token=$VERCEL_TOKEN | head -5

# Check if it's a DNS issue:
dig spawnforge.ai +short
nslookup spawnforge.ai
```

**Mitigation:**
```bash
# 1. Check Vercel status page: https://www.vercel-status.com/
# 2. Check GitHub Actions for failed deploy:
gh run list --workflow=cd.yml --limit=5

# 3. If last deploy is the cause, rollback:
# Option A: Vercel Dashboard > Deployments > find last-known-good > "Promote to Production"
# Option B: Manual rollback via CLI:
vercel ls --scope=<team> --token=$VERCEL_TOKEN
vercel promote <last-good-deployment-url> --scope=<team> --token=$VERCEL_TOKEN

# 4. If Vercel itself is down, there is no self-remediation.
#    Post in #incidents: "Vercel outage affecting SpawnForge. Monitoring Vercel status page."
```

**Communication:**
- Page on-call engineer via PagerDuty (when PF-608 is implemented)
- Post in #incidents Slack channel
- If user-facing for > 15 min, update status page

**Resolution Verification:**
```bash
curl -sS https://spawnforge.ai/api/health | python3 -m json.tool
# Expect: {"status": "ok", ...}

# Run full smoke test:
gh workflow run post-deploy-smoke.yml -f target_url=https://spawnforge.ai
```

**Prevention:** PF-607 (synthetic monitoring), PF-614 (auto-rollback)

---

### 5.2 Database Outage

**Detection:** Health endpoint returns 503 with Database service "down". Sentry alert: "Database connection failure".

**Verification:**
```bash
# Check health endpoint for DB status:
curl -sS https://spawnforge.ai/api/health | python3 -c "
import sys, json
data = json.load(sys.stdin)
db = next((s for s in data['services'] if 'Database' in s.get('name','')), None)
print(f\"DB Status: {db}\" if db else 'DB service not found')
"

# Check Neon dashboard: https://console.neon.tech/
# Check Neon status: https://neonstatus.com/
```

**Mitigation:**
```bash
# 1. Verify DATABASE_URL is still valid in Vercel env:
vercel env ls --scope=<team> --token=$VERCEL_TOKEN | grep DATABASE

# 2. If Neon is down (check neonstatus.com), wait for recovery.
#    Neon serverless driver auto-reconnects. No manual restart needed.

# 3. If DATABASE_URL was rotated (e.g., branch reset):
#    Update in Vercel Dashboard > Settings > Environment Variables
#    Redeploy: vercel --prod --scope=<team> --token=$VERCEL_TOKEN

# 4. Test direct connectivity (requires psql or neon CLI):
#    neon connection-string --project-id <id>
```

**Communication:** Post in #incidents: "Database connectivity issue. Investigating. Users may be unable to save/load projects."

**Resolution Verification:**
```bash
curl -sS https://spawnforge.ai/api/health | python3 -c "
import sys, json; data = json.load(sys.stdin)
print('OK' if data['database'] == 'connected' else 'STILL DOWN')
"
```

**Prevention:** PF-616 (query monitoring), connection pool health tracking

---

### 5.3 Auth Service Outage

**Detection:** Health endpoint returns 503 or Clerk service shows "degraded"/"down".

**Verification:**
```bash
# Check Clerk status:
curl -sS https://api.clerk.com/v1/jwks -H "Authorization: Bearer $CLERK_SECRET_KEY" -o /dev/null -w "%{http_code}\n"
# Expect: 200

# Check Clerk status page: https://status.clerk.com/
```

**Mitigation:**
```bash
# 1. If Clerk is partially down, existing sessions with valid JWTs still work.
#    No action needed unless it persists > 30 min.

# 2. If Clerk keys were rotated:
#    - Get new keys from Clerk Dashboard
#    - Update CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY in Vercel
#    - Redeploy

# 3. For development/testing, /dev route bypasses auth entirely.
```

**Communication:** Post in #engineering-alerts: "Auth service degraded. New logins may fail. Existing sessions unaffected."

**Resolution Verification:**
```bash
curl -sS https://spawnforge.ai/api/health | python3 -c "
import sys, json; data = json.load(sys.stdin)
clerk = next((s for s in data['services'] if 'Clerk' in s.get('name','')), None)
print(f\"Clerk: {clerk['status']}\" if clerk else 'NOT FOUND')
"
```

---

### 5.4 WASM Engine Load Failure

**Detection:** Post-deploy smoke test fails on WASM binary check. Users report blank canvas.

**Verification:**
```bash
# Check WASM availability on CDN:
curl -sI --max-time 10 https://engine.spawnforge.ai/engine-pkg-webgl2/forge_engine_bg.wasm | head -5

# Check Vercel-hosted fallback:
curl -sI --max-time 10 https://spawnforge.ai/engine-pkg-webgl2/forge_engine_bg.wasm | head -5

# Check file size (should be ~15-40MB):
curl -sI https://engine.spawnforge.ai/engine-pkg-webgl2/forge_engine_bg.wasm | grep -i content-length
```

**Mitigation:**
```bash
# 1. If CDN is down but Vercel fallback works:
#    Temporarily set R2_CDN_ENABLED=false in Vercel env vars and redeploy

# 2. If WASM is missing from both CDN and Vercel:
#    Check last successful CD run for WASM build artifacts:
gh run list --workflow=cd.yml --status=success --limit=3
#    Re-run CD workflow if needed:
gh workflow run cd.yml

# 3. If CDN Worker is misconfigured:
#    Check Cloudflare dashboard for engine-cdn worker
#    Worker source: infra/engine-cdn/worker.js (if infra/ exists, otherwise check R2 directly)
```

**Resolution Verification:**
```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  https://engine.spawnforge.ai/engine-pkg-webgl2/forge_engine_bg.wasm
# Expect: 200
```

---

### 5.5 AI Provider Failure

**Detection:** AI generation failure rate > 10% in 15 min window. Sentry alert: "AI generation failure spike".

**Verification:**
```bash
# Check Anthropic API:
curl -sI --max-time 5 https://api.anthropic.com | head -3

# Check health endpoint AI providers status:
curl -sS https://spawnforge.ai/api/health | python3 -c "
import sys, json; data = json.load(sys.stdin)
for s in data['services']:
    if 'AI' in s.get('name','') or 'Anthropic' in s.get('name',''):
        print(f\"{s['name']}: {s['status']}\")
"

# Check Anthropic status: https://status.anthropic.com/
```

**Mitigation:**
```bash
# 1. If Anthropic is down, all AI features degrade. Manual editing still works.
#    Post in #engineering-alerts with ETA from status page.

# 2. If API key was invalidated:
#    - Rotate key in Anthropic console
#    - Update ANTHROPIC_API_KEY in Vercel env
#    - Redeploy

# 3. If cost anomaly triggered circuit breaker (PF-612 when implemented):
#    Check /admin/economics dashboard for spend spikes
#    Re-enable via admin override if spend was legitimate
```

---

### 5.6 Payment System Failure

**Detection:** Stripe webhook failures spike. Sentry alert: "Stripe webhook error".

**Verification:**
```bash
# Check Stripe status: https://status.stripe.com/
# Check webhook delivery in Stripe Dashboard > Developers > Webhooks
```

**Mitigation:**
```bash
# 1. Stripe webhook failures are automatically retried by Stripe (up to 72h).
#    No immediate action needed unless persistent.

# 2. If STRIPE_WEBHOOK_SECRET was rotated:
#    - Get new secret from Stripe Dashboard > Developers > Webhooks
#    - Update in Vercel env
#    - Redeploy

# 3. Existing subscriptions continue to work; only new signups/changes are affected.
```

---

### 5.7 Rate Limiting Exhaustion

**Detection:** Spike in 429 responses. Sentry breadcrumbs show rate limit triggers.

**Verification:**
```bash
# Test rate limiting on health endpoint:
for i in $(seq 1 35); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" https://spawnforge.ai/api/health)
  echo "Request $i: HTTP $code"
done
# Should see 429 after 30 requests in 5 minutes
```

**Mitigation:**
```bash
# 1. Current rate limiting is in-memory per Vercel function instance.
#    Under DDoS, each instance has its own counter -- not truly distributed.
#    PF-610 addresses this with Upstash Redis.

# 2. For acute DDoS, use Vercel's Edge protection or Cloudflare in front.

# 3. To adjust limits, edit web/src/lib/rateLimit.ts:
#    rateLimitPublicRoute() defaults: 30 requests per 5 minutes per IP
```

---

### 5.8 Deployment Failure

**Detection:** CD workflow fails. GitHub Actions notification.

**Verification:**
```bash
# Check latest CD run:
gh run list --workflow=cd.yml --limit=3
gh run view <run-id> --log-failed
```

**Mitigation:**
```bash
# 1. Identify which job failed:
gh run view <run-id>

# Common failures:
# - Lint/TypeScript: Fix code, push new commit
# - WASM build: Check Rust toolchain, wasm-bindgen version (must be 0.2.108)
# - E2E tests: Check Playwright report artifact
# - Vercel deploy: Check VERCEL_TOKEN, project IDs

# 2. Production is NOT affected by a failed deploy -- it stays on the last good version.

# 3. If you need to force a redeploy of the last good code:
gh workflow run cd.yml
```

---

## 6. Capacity Planning

### Current Limits

| Resource | Current Limit | Scaling Trigger | Action |
|----------|--------------|-----------------|--------|
| Vercel Serverless Functions | Pro: 1000 concurrent | > 700 concurrent avg | Upgrade to Enterprise or add edge caching |
| Neon Database | Free: 0.5 GiB storage, 1 compute | > 400 MiB storage | Upgrade to Pro (autoscaling) |
| Neon Compute | Free: 0.25 vCPU | p99 query > 500ms sustained | Upgrade, add read replicas |
| Cloudflare R2 | 10 GiB free storage | > 8 GiB used | Monitor via Cloudflare dashboard |
| R2 Bandwidth | 10 GiB free/month | > 8 GiB/month | Add caching, optimize WASM size |
| Anthropic API | Per-key rate limits | 429 responses > 5% | Request limit increase, add retry/backoff |
| Clerk | 10k MAU free | > 8k MAU | Upgrade to Pro plan |
| Stripe | No hard limits | N/A | N/A |
| Sentry | 5k errors/month free | > 4k errors/month | Increase sample rate filtering, upgrade plan |
| Upstash Redis | 10k commands/day free | > 8k commands/day | Upgrade to Pro |

### WASM Binary Size
- WebGL2 editor: ~20-30 MiB (after wasm-opt)
- WebGPU editor: ~25-35 MiB
- Runtime variants: ~15-25 MiB (stripped editor systems)
- Each deploy uploads 4 variants to R2 CDN

### Monitoring Recommendations
- Track R2 storage via Cloudflare Analytics
- Track Neon storage via Neon Dashboard metrics
- Track Vercel function invocations in Vercel Analytics
- Track Sentry event count in Sentry Settings > Subscription

---

## 7. Disaster Recovery

### Recovery Point Objective (RPO) / Recovery Time Objective (RTO)

| Data Store | Backup Method | RPO | RTO | Notes |
|-----------|---------------|-----|-----|-------|
| Neon PostgreSQL | Point-in-time recovery (PITR) | ~0 (WAL-based, continuous) | < 5 min | Neon retains 7 days of history (free) or 30 days (Pro). Restore via Neon console: Branches > Create from timestamp |
| Cloudflare R2 | No built-in versioning | Last upload | < 30 min (re-upload from source) | Asset files can be re-uploaded. WASM binaries regenerated from CI |
| Clerk | Managed by Clerk | N/A | N/A | User accounts managed externally. No backup needed from our side |
| Stripe | Managed by Stripe | N/A | N/A | Subscription data managed externally |
| Vercel | Git-based (deploy from any commit) | Last commit | < 10 min | Rollback by promoting previous deployment |
| Code | GitHub (git) | Last push | Immediate | Protected main branch, PR reviews |

### Database Recovery Procedure
```bash
# 1. Go to Neon Console: https://console.neon.tech/
# 2. Select the SpawnForge project
# 3. Go to "Branches" tab
# 4. Click "Create Branch"
# 5. Select "From a point in time" and pick a timestamp BEFORE the incident
# 6. Name it "recovery-YYYY-MM-DD"
# 7. Get the new branch's connection string
# 8. Update DATABASE_URL in Vercel env vars to point to the recovery branch
# 9. Redeploy
# 10. Verify data integrity
# 11. Once confirmed, either:
#     a. Keep using the recovery branch (rename to main), or
#     b. Export data and import back to the original branch
```

### Full Environment Recovery (from scratch)
1. Clone repo from GitHub
2. Set up Neon database, run Drizzle migrations: `cd web && npx drizzle-kit push`
3. Configure all env vars in Vercel (see `web/src/lib/config/validateEnv.ts` for required list)
4. Build and deploy WASM: `gh workflow run cd.yml`
5. Upload WASM to R2 CDN (if R2_CDN_ENABLED)
6. Verify via smoke tests: `gh workflow run post-deploy-smoke.yml`

---

## 8. Security Incident Playbook

### 8.1 Auth Breach (Leaked Clerk Keys)

**Detection:** Unexpected user creation, suspicious session activity, or key detected in public repo.

**Immediate Actions (within 15 min):**
```bash
# 1. Rotate Clerk keys immediately:
#    - Clerk Dashboard > API Keys > Rotate
#    - Update in Vercel env:
#      CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

# 2. Redeploy immediately:
gh workflow run cd.yml

# 3. Invalidate all active sessions:
#    Clerk Dashboard > Users > "Sign out all users" (if feature available)
#    Or: Clerk API to revoke sessions

# 4. Audit recent user activity:
#    Check Clerk Dashboard > Logs for suspicious sign-ups or session creation
```

**Communication:** Post in #incidents: "Security incident: Auth key rotation in progress. Users will need to re-login."

### 8.2 Database Credentials Leaked

**Immediate Actions:**
```bash
# 1. Rotate DATABASE_URL in Neon Console:
#    Project > Settings > Connection > Reset password

# 2. Update DATABASE_URL in Vercel env vars

# 3. Redeploy

# 4. Audit database for unauthorized access:
#    Check Neon query logs for unusual patterns
#    Check for new tables, dropped tables, or data exfiltration queries
```

### 8.3 API Key Exposure (AI Providers, Stripe)

**Immediate Actions:**
```bash
# 1. Rotate the exposed key in the provider's dashboard:
#    - Anthropic: console.anthropic.com > API Keys
#    - Stripe: dashboard.stripe.com > Developers > API Keys
#    - Meshy/ElevenLabs/Suno: respective dashboards

# 2. Update in Vercel env vars

# 3. Redeploy

# 4. Check provider dashboards for unauthorized usage/spend
```

### 8.4 DDoS Attack

**Detection:** Spike in 429 responses, Vercel function timeouts, degraded health check latency.

**Immediate Actions:**
```bash
# 1. Check current rate limiting status:
curl -sS https://spawnforge.ai/api/health -w "\nHTTP: %{http_code} | Time: %{time_total}s\n"

# 2. Current rate limiting is per-instance in-memory (web/src/lib/rateLimit.ts).
#    Under sustained DDoS, this is insufficient.

# 3. Enable Vercel Firewall rules (Vercel Dashboard > Firewall):
#    - Block specific IPs or CIDR ranges
#    - Enable challenge mode for suspicious traffic

# 4. If attack targets engine.spawnforge.ai:
#    - Cloudflare Dashboard > Security > WAF > Create rule to block pattern
#    - Or: temporarily enable "Under Attack Mode" in Cloudflare

# 5. Health endpoint amplification (PF-609):
#    /api/health makes real network calls. Under DDoS, this amplifies to Neon/Clerk/CDN.
#    Temporary fix: Add response caching at Vercel Edge
```

### 8.5 Data Leak (User Data Exposed)

**Immediate Actions:**
1. Identify the scope: which data, which users, which endpoint
2. Fix the vulnerability (patch and deploy)
3. Audit access logs for exploitation evidence
4. If PII was exposed: prepare notification per applicable privacy law
5. Document in incident report

**Post-Incident:**
- Review all API routes for similar patterns
- Add/improve input validation
- Consider adding request logging (PF-613)

---

## 9. Environment Configuration

### Required Environment Variables (Production)

| Variable | Service | Validated At |
|----------|---------|-------------|
| `DATABASE_URL` | Neon PostgreSQL | Startup (`validateEnvironment`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk (client) | Startup |
| `CLERK_SECRET_KEY` | Clerk (server) | Startup |
| `STRIPE_SECRET_KEY` | Stripe | Startup |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhooks | Startup |

### Optional Environment Variables

| Variable | Service | Default |
|----------|---------|---------|
| `NEXT_PUBLIC_APP_URL` | App URL | `http://localhost:3000` |
| `NEXT_PUBLIC_ENGINE_CDN_URL` | WASM CDN | (empty, uses local) |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Sentry | (empty, errors untracked) |
| `ANTHROPIC_API_KEY` | Anthropic AI | (empty, AI disabled) |
| `MESHY_API_KEY` | Meshy 3D gen | (empty) |
| `ELEVENLABS_API_KEY` | ElevenLabs audio | (empty) |
| `SUNO_API_KEY` | Suno music | (empty) |
| `CLOUDFLARE_ACCOUNT_ID` | R2 config | (empty) |
| `R2_ACCESS_KEY_ID` | R2 auth | (empty) |
| `R2_SECRET_ACCESS_KEY` | R2 auth | (empty) |
| `R2_BUCKET_NAME` | R2 bucket | (empty) |
| `UPSTASH_REDIS_REST_URL` | Rate limiting | (empty, in-memory fallback) |
| `UPSTASH_REDIS_REST_TOKEN` | Rate limiting | (empty) |

---

## 10. Deployment Pipeline

### Pipeline Stages (cd.yml)

```
push to main
  |
  +---> [Parallel Quality Gates]
  |       Lint (eslint --max-warnings 0)
  |       TypeScript (tsc --noEmit)
  |       Web Tests (vitest run)
  |       MCP Tests (vitest run)
  |       WASM Build (4 variants: webgl2/webgpu x editor/runtime)
  |       Security Audit (cargo audit + npm audit)
  |
  +---> E2E Tests (Playwright, needs WASM build)
  |
  +---> [Optional] Upload WASM to R2 CDN (if R2_CDN_ENABLED=true)
  |
  +---> Deploy to Staging
  |
  +---> Deploy to Production
  |
  +---> [Triggered] Post-Deploy Smoke Tests
          - /api/health (200 + valid JSON)
          - / (200 + contains "SpawnForge")
          - /manifest.json (200)
          - WASM binary (200 + correct content-type)
```

### Rollback Procedure
```bash
# Option 1: Vercel Dashboard
# Deployments > select last-known-good > "Promote to Production"

# Option 2: CLI
vercel promote <deployment-url> --scope=<team> --token=$VERCEL_TOKEN

# Option 3: Re-run CD from a good commit
git log --oneline -10  # Find the last good commit
gh workflow run cd.yml --ref <good-commit-sha>
```

---

## 11. Monitoring Architecture

### Current State
- **Sentry**: Client-side (browser tracing + replay) and server-side error tracking
  - Client sample rate: 10% traces, 10% session replay, 100% error replay
  - Server sample rate: 10% traces
  - Tunnel: `/api/sentry` (bypasses ad-blockers)
  - Org: `tristan-nolan`, Project: `spawnforge-ai`
- **Health endpoint**: `/api/health` with 8 service checks (5s timeout each, 3s for external services)
- **Post-deploy smoke tests**: 4 checks run automatically after CD
- **Env validation**: Startup check for 5 required vars (`validateEnvironment()`)

### Gaps (Addressed by PF-607 through PF-617)
- No external synthetic monitoring (PF-607)
- No on-call rotation or paging (PF-608)
- Health endpoint not rate-limited (PF-609)
- Rate limiting is per-instance, not distributed (PF-610)
- No client Web Vitals reporting (PF-611)
- No AI cost anomaly detection (PF-612)
- No structured log aggregation (PF-613)
- No automated rollback (PF-614)
- Duplicate checkAuthentication() function (PF-615)
- No DB query monitoring (PF-616)
- No CDN cache metrics (PF-617)

---

## 12. Sentry Configuration Reference

### Alert Rules (To Be Created)

| Alert Name | Condition | Severity | Action |
|-----------|-----------|----------|--------|
| DB Connection Failure | `Database (Neon)` health check returns "down" 2x in 5 min | P0 | Page on-call |
| Auth Failure Spike | Clerk health check "down" for 5 min | P0 | Page on-call |
| 5xx Error Rate | > 2% of requests return 5xx for 5 min | P1 | Page on-call |
| AI Gen Failure Spike | AI provider errors > 10% for 15 min | P1 | Notify #engineering-alerts |
| WASM Load Failure | Custom measurement `wasm_init_time` errors > 5% | P1 | Notify #engineering-alerts |
| High LCP | p75 LCP > 4s for 30 min | P2 | Notify #engineering-alerts |
| Rate Limit Exhaustion | 429 responses > 20/min for 10 min | P2 | Investigate DDoS |
| Cost Anomaly | Hourly AI spend > 2x rolling 7-day avg | P2 | Notify + review |

### Sentry Tracing Configuration

```typescript
// Client: web/sentry.client.config.ts
tracesSampleRate: 0.1        // 10% of transactions
replaysSessionSampleRate: 0.1 // 10% of sessions
replaysOnErrorSampleRate: 1.0 // 100% of error sessions

// Server: web/sentry.server.config.ts
tracesSampleRate: 0.1         // 10% of server transactions
```

---

## 13. Vercel Skew Protection

Skew Protection prevents version mismatch between the JS client and server during rolling deployments. This is critical for SpawnForge: if the JS loader and WASM binary come from different deployments, the engine fails to initialise.

Next.js 14.1.4+ implements Skew Protection automatically — no code changes required. The project uses Next.js 16, so it is fully supported.

### Enable in the Vercel Dashboard

1. Go to **Vercel Dashboard** > **spawnforge** project > **Settings** > **Advanced**
2. Under **System Environment Variables**, enable **Automatically expose system environment variables**
3. Scroll to **Skew Protection** and enable the toggle
4. Set the maximum age (default: 24 hours — suitable for most sessions; increase to 7 days for safety)
5. **Redeploy** the latest production deployment for the change to take effect

Vercel then auto-injects two env vars on every build:
- `VERCEL_SKEW_PROTECTION_ENABLED=1`
- `VERCEL_DEPLOYMENT_ID=dpl_xxx`

Next.js uses these to attach `?dpl=<id>` to framework-managed requests (static assets, RSC fetches, prefetches), routing them to the same deployment that served the initial HTML.

### What it protects

| Request type | Protected automatically |
|---|---|
| JS/CSS bundles, framework chunks | Yes |
| RSC (React Server Component) fetches | Yes |
| Client-side route transitions | Yes |
| Prefetch requests | Yes |
| Custom `fetch()` from client components | No — must add `x-deployment-id` header manually |
| Full-page navigations (hard refresh) | No — Vercel serves latest deployment, client detects mismatch and reloads |
| WASM binary loads from `/engine-pkg-*` | No — these are static assets loaded imperatively by `useEngine.ts` |

### WASM binary version safety

The WASM binaries in `/public/engine-pkg-*/` are immutably cached (`Cache-Control: public, max-age=31536000, immutable`). Each deployment produces unique binary filenames (via wasm-bindgen content hashing). The JS loader (`useEngine.ts`) always fetches from the same deployment's public directory — so WASM and JS are always from the same build as long as the page was served by the same deployment. Skew Protection handles this correctly via the framework's asset pinning.

### Verify Skew Protection is active

After enabling and redeploying:
```bash
# Confirm Vercel has set the env var on the deployment
vercel env ls --scope=<team> | grep VERCEL_SKEW

# Check Vercel Monitoring dashboard for skew_protection = 'active' requests
# Dashboard > spawnforge > Monitoring > filter: skew_protection = 'active'
```

---

## 14. Known Technical Debt

| Item | Ticket | Risk | Impact |
|------|--------|------|--------|
| checkAuthentication() is dead code duplicate of checkClerk() | PF-615 | Low | Maintenance confusion |
| Rate limiting is in-memory per-instance | PF-610 | Medium | Ineffective under distributed load |
| Health endpoint makes real network calls without caching | PF-609 | Medium | DDoS amplification vector |
| No structured logging or log retention beyond Vercel limits | PF-613 | High | Cannot diagnose past incidents |
| No automated rollback on smoke test failure | PF-614 | Medium | Manual intervention needed |
| Sentry traces at 10% may miss intermittent issues | -- | Low | Increase if budget allows |

---

## 15. On-Call Checklist

When paged, follow this sequence:

1. **Acknowledge** the page within 5 minutes
2. **Assess** severity:
   - Check `https://spawnforge.ai/api/health`
   - Check Sentry for error spikes
   - Check Vercel deployment status
3. **Classify**: P0 (site down), P1 (major feature broken), P2 (degraded performance)
4. **Mitigate** using the appropriate runbook above
5. **Communicate** in #incidents with:
   - What is happening
   - What is affected
   - What you are doing
   - ETA for resolution (or "investigating")
6. **Resolve** and verify with health checks + smoke tests
7. **Post-mortem** within 24 hours for P0/P1 incidents
