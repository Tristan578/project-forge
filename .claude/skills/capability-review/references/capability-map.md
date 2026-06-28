# Capability Map

Per-provider inventory for `capability-review`. For each provider: the **changelog/release URL** to fetch (always with a dated query), the **pricing URL** to fetch for Step 4, and the **grep markers** the fingerprint script keys on to decide `using` vs `GAP`.

> Keep the "We currently wire" column honest — update it when adoption changes. A drifted map produces false "adoption gaps."

## Analytics & Product Intelligence

### PostHog — `posthog-js`
- Changelog: https://posthog.com/changelog · Roadmap: https://posthog.com/roadmap
- Pricing: https://posthog.com/pricing (per-product free tiers: events, replays, flag requests, survey responses, LLM events)
- We currently wire: event capture (gated behind cookie consent — PF-30). 
- Opportunity surface: session replay, feature flags, experiments, surveys, web analytics, **LLM observability** (`$ai_generation` on `/api/generate/*` + chat), error tracking, group analytics, cohorts, data warehouse.
- Grep markers: `posthog.capture`, `posthog.feature_flags` / `useFeatureFlag`, `posthog.startSessionRecording` / `session_recording`, `$ai_generation`, `posthog.identify`, `posthog.group`.

### Vercel Analytics / Speed Insights
- Docs: https://vercel.com/docs/analytics · https://vercel.com/docs/speed-insights
- Pricing: bundled with Vercel plan (data-point caps per plan) — https://vercel.com/pricing
- Grep markers: `@vercel/analytics`, `@vercel/speed-insights`, `<Analytics`, `<SpeedInsights`.

## Monitoring, Observability & Agent Tracking

### Sentry — `@sentry/nextjs`
- Releases: https://github.com/getsentry/sentry-javascript/releases · Changelog: https://sentry.io/changelog/
- Pricing: https://sentry.io/pricing/ (errors, performance units, profile hours, replays, cron monitors, uptime monitors, Seer/AI billed separately)
- We currently wire: error capture, tracing, `dataCollection`/`sendDefaultPii` migration (#8778/#8780).
- Opportunity surface: **profiling**, **cron monitors**, **uptime monitoring**, **Seer** (AI root-cause + AI code review — note "Seer Code Review" already appears as a PR check), **logs**, session replay, **AI Agent Monitoring / LLM spans**, release health, user feedback widget.
- Grep markers: `Sentry.init`, `tracesSampleRate`, `profilesSampleRate`, `Sentry.cron` / `withMonitor`, `replayIntegration`, `Sentry.metrics`, `Sentry.captureFeedback`, `vercelAIIntegration` / `Sentry.ai`.

### Vercel Observability / Agent
- Changelog: https://vercel.com/changelog · Docs: https://vercel.com/docs/observability
- Pricing: https://vercel.com/pricing (Observability Plus add-on; Agent in beta)
- Opportunity surface: runtime logs/drains, OpenTelemetry export, **Vercel Agent** (AI reviews + prod investigations, beta).
- Grep markers: `@vercel/otel`, `registerOTel`, `otel`.

## Infrastructure & Platform

### Vercel (platform)
- Changelog: https://vercel.com/changelog · Pricing: https://vercel.com/pricing
- We currently wire: Functions, crons (cd.yml), preview deploys, Deployment Protection (SSO gate).
- Opportunity surface: **Fluid Compute** tuning, **Queues** (beta), **Sandbox** (GA), **AI Gateway**, **BotID** (GA), **Rolling Releases** (GA), ISR, `vercel.ts` config migration, edge config.
- Grep markers: `vercel.json`, `vercel.ts`, `waitUntil`, `unstable_after` / `after(`, `@vercel/functions`, `BotId` / `@vercel/bot`, `ai-gateway` / `gateway/`.

### Cloudflare
- Changelog: https://developers.cloudflare.com/changelog/ · Pricing: https://developers.cloudflare.com/r2/pricing/ , https://www.cloudflare.com/plans/developer-platform/
- We currently wire: R2 (`spawnforge-engine` + `spawnforge-assets`), `engine-cdn` Worker.
- Opportunity surface: Workers AI, Vectorize, D1, Hyperdrive, Queues, Images, Cache Reserve, R2 event notifications.
- Grep markers: `wrangler.toml`, `@cloudflare/`, `R2Bucket`, `Vectorize`, `D1Database`, `workers-ai`.

### Upstash
- Releases: https://github.com/upstash/redis-js/releases · Changelog: https://upstash.com/changelog
- Pricing: https://upstash.com/pricing (Redis, QStash, Vector, Workflow, Search — per-request / per-vector tiers)
- We currently wire: Redis REST for rate limiting.
- Opportunity surface: **QStash** (durable queues + schedules — could replace ad-hoc polling), **Workflow**, **Vector** (semantic search over games/assets), **Search**, daily backups.
- Grep markers: `@upstash/redis`, `@upstash/ratelimit`, `@upstash/qstash`, `@upstash/vector`, `@upstash/workflow`.

### Neon
- Releases: https://github.com/neondatabase/serverless/releases · Changelog: https://neon.tech/docs/changelog
- Pricing: https://neon.tech/pricing (compute hours, storage, branches, read replicas)
- We currently wire: Postgres + Drizzle, neon-http driver.
- Opportunity surface: DB **branching for preview envs**, autoscaling, read replicas, **Data API**, Neon Auth, scheduled backups.
- Grep markers: `@neondatabase/serverless`, `neon(`, `getNeonSql`, `pgBranch` / `branch`.

## AI / Generation Stack

### AI SDK — `ai`, `@ai-sdk/react`
- Releases: https://github.com/vercel/ai/releases · Docs: https://ai-sdk.dev
- Pricing: model cost flows through the provider / Vercel AI Gateway — https://vercel.com/docs/ai-gateway
- We currently wire: streaming chat (`toUIMessageStreamResponse`), tool loop (`ToolLoopAgent`), `createSpawnforgeAgent`, `createGenerationHandler` (12 generate routes).
- Opportunity surface: **prompt caching** tiers, structured output, agents, **MCP** tool integration, batch, embeddings, image/video gen via Gateway, new providers/models via Gateway strings.
- Grep markers: `toUIMessageStreamResponse`, `streamText`, `generateObject`, `tool(`, `experimental_`, `providerOptions.*cacheControl` / `cache_control`, `gateway`.

### Anthropic / model tier
- Models + pricing: https://docs.anthropic.com/en/docs/about-claude/models · https://www.anthropic.com/pricing
- We currently wire: Sonnet 4.6 default, Opus deep tier (`AI_MODEL_DEEP`, flag `NEXT_PUBLIC_USE_DEEP_GENERATION`).
- Opportunity surface: newer models, prompt-cache pricing tiers, tool streaming, citations, batch API (50% discount), extended context.
- Grep markers: `AI_MODEL`, `claude-`, `anthropic`, `cache_control`.

## Payments, Auth & Compliance

### Stripe — `stripe`
- Releases: https://github.com/stripe/stripe-node/releases · API changelog: https://docs.stripe.com/changelog
- Pricing: https://stripe.com/pricing (+ Tax, Radar, Billing as separate line items)
- We currently wire: Checkout, subscriptions (4 tiers), webhooks, atomic-CTE refunds, customer portal. SDK `22.x`, API `2026-06-24.dahlia` (pinned literal in `stripe-client.ts`).
- Opportunity surface: **Billing meters / usage-based** (token overage billing), Tax, Radar (fraud), entitlements API, adaptive pricing, portal config.
- Grep markers: `stripe.checkout`, `stripe.subscriptions`, `stripe.billing.meters` / `billing/meters`, `stripe.tax` / `automatic_tax`, `radar`, `entitlements`.

### Clerk — `@clerk/nextjs`
- Releases: https://github.com/clerk/javascript/releases · Changelog: https://clerk.com/changelog
- Pricing: https://clerk.com/pricing (MAU tiers, B2B/orgs add-on)
- We currently wire: auth, `<SignIn>`/`<SignUp>`, `safeAuth()`, `redirectToSignIn`.
- Opportunity surface: Organizations/B2B, MFA, passkeys, bot protection, billing integration, new `Appearance` API.
- Blocked note: `7.5.x` removes `baseTheme` from `Appearance` → TS2353 in `web/src/app/layout.tsx`; treat as blocked pending an appearance-API migration ticket.
- Grep markers: `@clerk/nextjs`, `clerkMiddleware`, `<SignIn`, `OrganizationProfile`, `baseTheme`, `appearance`.
