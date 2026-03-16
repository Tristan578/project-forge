# Monitoring & Alerting Setup

> **Last updated:** 2026-03-16

## Sentry Alert Rules

Configure these alert rules in Sentry (Settings > Alerts > Create Alert Rule) for the `spawnforge-ai` project.

### P1 -- Critical Alerts (Immediate Notification)

#### 1. High Error Rate
- **Type:** Metric Alert
- **Metric:** Number of errors
- **Threshold:** > 50 errors in 5 minutes
- **Action:** Slack #incidents + PagerDuty (when configured)
- **Resolve:** < 10 errors in 5 minutes

#### 2. Transaction Failure Spike
- **Type:** Metric Alert
- **Metric:** Transaction failure rate
- **Threshold:** > 10% failure rate over 5 minutes
- **Action:** Slack #incidents
- **Resolve:** < 2% failure rate over 5 minutes

#### 3. Unhandled Exception (New Issue)
- **Type:** Issue Alert
- **Condition:** First seen, level = error or fatal
- **Filter:** Event occurs 5+ times in 10 minutes (avoids noise from one-off errors)
- **Action:** Slack #incidents

### P2 -- Degraded Service Alerts

#### 4. Slow API Response
- **Type:** Metric Alert
- **Metric:** Transaction duration (p95)
- **Threshold:** > 5 seconds over 10 minutes
- **Action:** Slack #engineering
- **Resolve:** < 2 seconds over 10 minutes

#### 5. Database Circuit Breaker Open
- **Type:** Issue Alert
- **Condition:** Message contains "CircuitBreakerOpenError"
- **Action:** Slack #incidents
- **Note:** The circuit breaker (`web/src/lib/db/circuitBreaker.ts`) opens after repeated DB failures

#### 6. Payment Processing Errors
- **Type:** Issue Alert
- **Condition:** Transaction matches `/api/webhooks/stripe`, level = error
- **Frequency:** Alert once per hour (Stripe retries automatically)
- **Action:** Slack #engineering

### P3 -- Monitoring Alerts

#### 7. Elevated Warning Rate
- **Type:** Metric Alert
- **Metric:** Number of warnings
- **Threshold:** > 200 in 1 hour
- **Action:** Slack #engineering (daily digest)
- **Resolve:** < 50 in 1 hour

#### 8. Weekly Error Summary
- **Type:** Scheduled report
- **Frequency:** Weekly, Monday 9:00 AM
- **Content:** New issues, regression count, top errors by frequency
- **Action:** Slack #engineering

## Performance Monitoring

### Key Transactions to Monitor

| Transaction | Expected p50 | Alert p95 | Notes |
|-------------|-------------|-----------|-------|
| `GET /api/projects` | < 200ms | > 2s | User project list |
| `POST /api/projects/save` | < 500ms | > 5s | Scene save (varies by scene size) |
| `GET /api/user/profile` | < 100ms | > 1s | Auth + DB lookup |
| `POST /api/chat` | < 2s | > 30s | AI response (LLM dependent) |
| `POST /api/generate/*` | < 1s | > 10s | AI asset generation kickoff |

### Browser Performance

Configure Sentry Browser SDK to track:
- **LCP (Largest Contentful Paint):** Target < 2.5s, alert at > 4s
- **FID (First Input Delay):** Target < 100ms, alert at > 300ms
- **CLS (Cumulative Layout Shift):** Target < 0.1, alert at > 0.25

## Infrastructure Monitoring

### Vercel
- **Deployment notifications:** Slack #deployments
- **Build failure alerts:** Slack #engineering
- **Usage alerts:** Set spending limit in Vercel dashboard

### Cloudflare (R2 + Workers)
- **Worker error rate:** Monitor in Cloudflare dashboard > Workers > Analytics
- **R2 availability:** Monitor via synthetic checks (periodic curl to CDN URL)
- **Recommended:** Set up Cloudflare notification policy for Worker errors > 1% rate

### Neon Database
- **Connection pool usage:** Monitor in Neon dashboard
- **Storage usage alerts:** Configure in Neon project settings
- **Compute usage:** Set autoscaling limits to prevent cost overruns

## Slack Integration Setup

1. Go to Sentry > Settings > Integrations > Slack
2. Install the Sentry Slack app
3. Configure channels:
   - `#incidents` -- P1 and P2 alerts
   - `#engineering` -- P3 alerts and daily digests
   - `#deployments` -- Vercel deployment notifications

## Uptime Monitoring (Recommended)

Set up external uptime monitoring (e.g., Checkly, UptimeRobot, or Vercel Monitoring):

| Endpoint | Interval | Timeout | Alert After |
|----------|----------|---------|-------------|
| `https://spawnforge.ai` | 1 min | 10s | 2 failures |
| `https://spawnforge.ai/api/health` | 1 min | 5s | 2 failures |
| `https://engine.spawnforge.ai/engine-pkg-webgpu/spawnforge_engine_bg.wasm` | 5 min | 15s | 3 failures |
