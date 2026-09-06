---
name: infra-services
description: Infrastructure specialist for SpawnForge. Use when working with Vercel, Cloudflare R2, Neon DB, Upstash Redis, Clerk, Stripe, Sentry, PostHog, GitHub Actions CI/CD, or monitoring CI check status on PRs.
user-invocable: true
allowed-tools: Bash, Read, Glob, Grep, Agent, WebFetch
argument-hint: "[service: vercel|r2|neon|upstash|clerk|stripe|sentry|posthog|github|ci-status]"
paths: ".github/workflows/**, infra/**, vercel.json"
---

# Infrastructure & Services Guide

SpawnForge's infrastructure stack and how each service connects.

## Architecture Overview

```
User Browser
  ├─ Vercel Edge (CDN, routing, middleware)
  │    ├─ Next.js App (SSR + API routes)
  │    │    ├─ Neon Postgres (users, projects, tokens, billing)
  │    │    ├─ Upstash Redis (rate limiting, caching)
  │    │    ├─ Clerk (authentication, webhooks)
  │    │    ├─ Stripe (payments, webhooks)
  │    │    ├─ Sentry (error tracking, AI monitoring)
  │    │    └─ PostHog (analytics, feature flags)
  │    └─ Static Assets
  └─ Cloudflare R2 CDN (WASM engine binaries at engine.spawnforge.ai)
```

Estimated monthly cost: ~$130-150

## Service Reference

Account IDs, project slugs and DO-NOT-TOUCH rules are canonical in
[references/service-accounts.md](references/service-accounts.md). If this file and that one
ever disagree, that one is right — fix this one.

### Vercel (Hosting + Compute)

- **Project**: `spawnforge` (production, spawnforge.ai) — NOT `spawnforge-ai`, which is the
  Sentry project slug. Passing `spawnforge-ai` to a Vercel command returns a not-found that
  is indistinguishable from a permissions failure.
- **Sibling projects**: `spawnforge-staging`, `spawnforge-docs`, `spawnforge-design`
- **Scope**: `--scope tnolan` on EVERY Vercel CLI command
- **CLI commands**: `vercel ls --scope tnolan`, `vercel logs --scope tnolan`, `vercel env ls|pull --scope tnolan`
- **Config**: `vercel.json` (crons, headers, rewrites)
- **Key env vars**: `VERCEL_URL`, `NEXT_PUBLIC_SITE_URL`
- **Gotchas**:
  - `vercel dev` runs all services locally
  - Preview deployments get unique URLs
  - `force-dynamic` scoped to auth routes only (not root layout)

### Cloudflare R2 (Engine CDN)

- **Buckets**: `spawnforge-engine` (WASM binaries), `spawnforge-assets` (server-side uploads)
- **Worker**: `engine-cdn` at `engine.spawnforge.ai/*` — adds CORS headers
- **Source**: `infra/engine-cdn/worker.js` + `wrangler.toml`
- **Account ID**: `0b949ff499d179e24dde841f71d6134f`
- **Upload**: `wrangler r2 object put <bucket>/<key> --file <path> --remote`
- **Deploy skill**: `/deploy-engine` handles upload and verification
- **Gotchas**:
  - R2 CORS rules only apply to S3 API, NOT custom domain — Worker is required
  - `spawnforge-assets` is server-side only (signed URLs, no CORS Worker)
  - Content-hash filenames for cache busting (PF-888)

### Neon Postgres (Database)

- **Provisioned via**: Vercel Marketplace (auto env vars)
- **ORM**: Drizzle (`web/src/lib/db/schema.ts`)
- **Key env var**: `DATABASE_URL`
- **Commands**:
  ```bash
  cd web && npm run db:generate    # Generate migration
  cd web && npm run db:migrate     # Apply migrations
  cd web && npm run db:push        # Push schema (dev only)
  cd web && npm run db:studio      # Visual browser
  ```
- **Gotchas**:
  - Use `neon-http` driver for serverless (not neon-serverless WebSocket)
  - Transactions via `sql.transaction([...statements])`
  - No connection pooling needed — neon-http is stateless

### Upstash Redis (Rate Limiting + Cache)

- **Provisioned via**: Vercel Marketplace
- **Key env vars**: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- **Usage**: `distributedRateLimit()` in `web/src/lib/rateLimit/distributed.ts`
- **Gotchas**:
  - REST-based (HTTP), not TCP — works everywhere including edge
  - Rate limiter uses sorted sets with sliding window

### Clerk (Authentication)

- **Key env vars**: `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- **Webhooks**: `POST /api/webhooks/clerk` — handles `user.created`, `user.updated`, `user.deleted`
- **Proxy**: `proxy.ts` calls `clerkMiddleware()` — required for `auth()` in Server Components
- **Gotchas**:
  - `vercel integration add clerk` needs terminal interaction (blocked for AI agents)
  - Must manually set `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` and `SIGN_UP_URL`
  - CI/E2E: publishable key check gates ClerkProvider — missing key = no auth wrapper
  - `user.deleted` webhook must cascade-delete user data (PF-840)

### Stripe (Payments)

- **Key env vars**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (no publishable key — checkout is a server-side redirect to a Stripe-hosted page, so `web/` never loads Stripe.js)
- **Webhooks**: `POST /api/webhooks/stripe` — handles checkout, subscription, invoice, charge events
- **Local testing**: `stripe listen --forward-to http://spawnforge.localhost:1355/api/webhooks/stripe`
- **Tiers**: starter (free), hobbyist, creator, pro
- **Gotchas**:
  - Webhook signatures MUST be verified with `constructEvent()`
  - Idempotency keys stored in DB to prevent duplicate processing
  - Refund webhooks must reverse addon token credits

### Sentry (Error Tracking)

- **Org**: `tristan-nolan` (NOT `ember-l0`)
- **Project**: `spawnforge-ai`
- **Config**: `sentry.server.config.ts`, `sentry.edge.config.ts` (NEVER client config for AI monitoring)
- **Key env vars**: `SENTRY_AUTH_TOKEN`, `NEXT_PUBLIC_SENTRY_DSN`
- **MCP tools**: `search_issues`, `get_issue_details`, `search_events`, `get_trace_details`
- **Gotchas**:
  - `captureException` import from `@/lib/monitoring/sentry-server` (not `@sentry/nextjs` directly)
  - Fingerprinting configured in server + edge configs
  - PR code review via Sentry comments — must reply with commit SHA or false-positive explanation

### PostHog (Analytics + Feature Flags)

- **Key env vars**: `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_LLM_CAPTURE`
  (there is no `NEXT_PUBLIC_POSTHOG_HOST` — nothing in the repo reads one)
- **Tracking**: gated behind cookie consent (GDPR compliance, PF-668)
- **Client provider**: `web/src/components/providers/PostHogProvider.tsx`
- **Server capture**: `web/src/lib/analytics/posthog-server.ts` — content-free `$ai_generation`
  LLM observability (PF-907). Dependency-free `fetch` to PostHog's capture endpoint; dormant
  unless `POSTHOG_LLM_CAPTURE === 'true'` AND `NEXT_PUBLIC_POSTHOG_KEY` is set, and a no-op
  without per-call consent.
- **Feature flags**: `web/src/lib/flags/posthogFlags.ts` — a local evaluator (PF-971 / #8952),
  not the PostHog SDK. Requires BOTH `POSTHOG_PERSONAL_API_KEY` and `NEXT_PUBLIC_POSTHOG_KEY`;
  omit either and `getBooleanFlag()` returns the caller's default with zero network I/O.
  It supplies:
  - `deep-generation-tier` — overrides `NEXT_PUBLIC_USE_DEEP_GENERATION`
  - `provider-kill-switch-<provider>` — checked by `createGenerationHandler` **before token
    deduction**, so these gate real spend
- **Gotchas**:
  - Only a safe subset of PostHog targeting is evaluated locally (full rollout, 0% rollout, or
    a single `tier` exact-match filter); anything else falls back to the default with a one-time
    warn log
  - Server capture never carries `$ai_input` / `$ai_output_choices` — do not add them

### GitHub Actions (CI/CD)

- **Workflows**: `.github/workflows/ci.yml` (PR checks), `.github/workflows/cd.yml` (deploy)
- **CI gate job**: required check that depends on all other jobs
- **WASM caching**: artifacts shared between CI and CD for same SHA
- **Gotchas**:
  - Path filters can cause gate job to never run (shows "Expected" forever)
  - CodeQL runs on push-to-main, on every PR targeting main, and weekly (`.github/workflows/codeql.yml`)
  - Action versions must be pinned to SHA (not floating tags)
  - `CRON_SECRET` header required for cron job verification

## Health Check

```bash
# Quick health check of all services
curl -s http://spawnforge.localhost:1355/api/health | python3 -m json.tool
```

`/api/health` checks **ten** services, not four (`web/src/lib/monitoring/healthChecks.ts`):
Database (Neon), Clerk, Payments (Stripe), Rate Limiting (Upstash), Engine CDN, Cloudflare R2,
AI Providers, Generation Factory, Chat Backend, Sentry.

Only **Database and Clerk** failures return HTTP 503; everything else degrades to HTTP 200 with
a per-service `degraded`/`down` entry. So a green status code is not a green stack — read
`services[]`.

The `AI Providers` check grades per capability (#9719), not per key:

| Verdict | When |
|---------|------|
| `down` | no chat backend resolves at all — nothing AI-shaped can be served |
| `degraded` | a chat backend resolves but some generation capability has neither a platform key nor a gateway route. The unconfigured capabilities are named in `error`, in `details.unconfiguredCapabilities`, and in the public-safe `summary` |
| `healthy` | chat resolves and every offered capability is configured |

An unset `PLATFORM_*` key therefore yields **`degraded`, never "outage"** — and that is
production's expected steady state today (`docs/guides/platform-keys.md`: no `PLATFORM_*` key
is set, deliberately). Because it is expected, that entry carries `configurationOnly: true`,
which keeps it out of the top-level `overall` and out of the 15-minute synthetic monitor's
Sentry pages (#9727) — the entry itself still reads `degraded` on the status page. So: an
amber AI Providers card with no `/health` banner and no Sentry page is the documented
baseline; the same card WITH a page is a real regression.

Those key names are read through an indirection table (`PLATFORM_KEY_ENV` in
`web/src/lib/config/providers.ts`), so grepping for them finds nothing — see
`web/.env.example` before concluding a provider is actually down.

## Scripts

- `bash "${CLAUDE_SKILL_DIR}/scripts/check-services.sh"` — Health check all SpawnForge services: Vercel status, GitHub CI recent runs, git remote connectivity, dev server, and WASM binaries
- `bash "${CLAUDE_SKILL_DIR}/scripts/check-vercel-project.sh" [project-name]` — Show deployment details for a specific Vercel project (default: spawnforge)

## References

- See [service-accounts.md](references/service-accounts.md) — Canonical account IDs, project names, DO-NOT-TOUCH rules, and required GitHub Actions secrets
- See [runbook.md](references/runbook.md) — Quick runbook: Vercel logs, rollback, Sentry checks, R2 CDN verification, Stripe webhook testing, CI diagnostics

## CI Status Monitoring

Monitor all CI checks on a PR and report pass/fail with failure logs.

### Check current status

```bash
gh pr checks <PR_NUMBER> 2>&1
```

### Get failure logs

```bash
# Get the run ID from the check URL
gh run view <RUN_ID> --log-failed 2>&1 | tail -30
```

### Output format

```
PR #NNNN CI Status
━━━━━━━━━━━━━━━━━
✓ 15/18 passing
✗ 1 failing: Lighthouse Effects Delta Gate
⏳ 2 pending: WASM Build, E2E UI Tests

FAILURE: Lighthouse Effects Delta Gate
  Error: ENOENT: no such file or directory, scandir '.lhci-baseline'
```

### Tips

- WASM Build takes ~12 min, E2E depends on it — these are always last to finish
- Seer Code Review is external (Sentry) — may take 3-5 min
- If `npm ci` fails in multiple jobs simultaneously, it's a lockfile issue — check the lockfile section in `/build`
