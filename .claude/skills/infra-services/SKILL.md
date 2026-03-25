---
name: infra-services
description: Infrastructure and external service specialist for SpawnForge. Use when working with Vercel, Cloudflare R2, Neon DB, Upstash Redis, Clerk auth, Stripe payments, Sentry monitoring, PostHog analytics, or GitHub Actions CI/CD.
user-invocable: true
allowed-tools: Bash, Read, Glob, Grep, Agent, WebFetch
argument-hint: "[service: vercel|r2|neon|upstash|clerk|stripe|sentry|posthog|github|all]"
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

### Vercel (Hosting + Compute)

- **Project**: spawnforge-ai
- **Staging env**: spawnforge-staging
- **CLI commands**: `vercel ls`, `vercel logs`, `vercel env ls/pull`
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

- **Key env vars**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
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

### PostHog (Analytics)

- **Key env vars**: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
- **Tracking**: gated behind cookie consent (GDPR compliance, PF-668)
- **Provider**: `web/src/components/providers/PostHogProvider.tsx`
- **Gotchas**:
  - Client-side only — no server-side tracking
  - Feature flags available via PostHog but not yet wired

### GitHub Actions (CI/CD)

- **Workflows**: `.github/workflows/ci.yml` (PR checks), `.github/workflows/cd.yml` (deploy)
- **CI gate job**: required check that depends on all other jobs
- **WASM caching**: artifacts shared between CI and CD for same SHA
- **Gotchas**:
  - Path filters can cause gate job to never run (shows "Expected" forever)
  - CodeQL on push-to-main + weekly schedule only (not on every PR)
  - Action versions must be pinned to SHA (not floating tags)
  - `CRON_SECRET` header required for cron job verification

## Health Check

```bash
# Quick health check of all services
curl -s http://spawnforge.localhost:1355/api/health | python3 -m json.tool
```

The `/api/health` endpoint checks connectivity to Neon, Upstash, Clerk, and Stripe.
