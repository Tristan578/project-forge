# Required Environment Variables

Pull all variables at once with:

```bash
vercel env pull web/.env.local --scope tnolan
```

## Required (app will not start without these)

| Variable | Source | Description |
|----------|--------|-------------|
| `DATABASE_URL` | Neon (auto-provisioned via Vercel integration) | PostgreSQL connection string for Drizzle ORM. Format: `postgresql://user:pass@host/db?sslmode=require` |
| `CLERK_SECRET_KEY` | Clerk dashboard → API Keys | Server-side Clerk secret. Prefix: `sk_live_` (prod) or `sk_test_` (dev). Without this, `auth()` throws and all protected routes 500. |
| `STRIPE_SECRET_KEY` | Stripe dashboard → Developers → API keys | Server-side Stripe secret. Prefix: `sk_live_` (prod) or `sk_test_` (dev). Required for billing, subscriptions, and token purchases. |
| `UPSTASH_REDIS_REST_URL` | Upstash console → Database → REST API | Upstash Redis REST endpoint. Used for rate limiting (IP-based, 30 req/5min). Without this, rate limiting silently fails open. |

## Required for Full Functionality

| Variable | Source | Description |
|----------|--------|-------------|
| `UPSTASH_REDIS_REST_TOKEN` | Upstash console → Database → REST API | Auth token for Upstash REST API. Paired with `UPSTASH_REDIS_REST_URL`. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API Keys | Client-side Clerk key. Prefix: `pk_live_` (prod) or `pk_test_` (dev). Required for `<ClerkProvider>` in the browser. |
| `CLERK_PUBLISHABLE_KEY` | Same as above | Server-side mirror of the publishable key, used in some Clerk server utilities. |
| `STRIPE_WEBHOOK_SECRET` | Stripe dashboard → Webhooks → endpoint secret | Used to verify Stripe webhook signatures at `/api/webhooks/stripe`. Without this, all webhooks are rejected. |

## Optional (features degrade gracefully)

| Variable | Source | Description |
|----------|--------|-------------|
| `NEXT_PUBLIC_ENGINE_CDN_URL` | Set manually | Base URL for the WASM engine CDN. Default: `https://engine.spawnforge.ai`. Without this, the engine loads from `/engine-pkg-*` in `web/public/`. |
| `SENTRY_DSN` | Sentry → Project → Settings → Client Keys | Error reporting. Without this, production errors are silently dropped. |
| `NEXT_PUBLIC_SENTRY_DSN` | Same DSN | Client-side Sentry init. Must match `SENTRY_DSN`. |
| `SENTRY_AUTH_TOKEN` | Sentry → User Settings → Auth Tokens | Used by `@sentry/nextjs` to upload source maps at build time. |
| `SENTRY_ORG` | `tristan-nolan` | Sentry org slug. |
| `SENTRY_PROJECT` | `spawnforge-ai` | Sentry project slug. |
| `OPENAI_API_KEY` | OpenAI dashboard | Used by AI asset generation routes. Without this, image/texture generation falls back to other providers. |
| `ANTHROPIC_API_KEY` | Anthropic console | Used by AI chat routes. Required for the main Claude integration. |
| `FAL_API_KEY` | fal.ai dashboard | Used for fast image generation (sprites, textures). |
| `REPLICATE_API_TOKEN` | Replicate dashboard | Used for model inference (audio, 3D). |
| `ELEVENLABS_API_KEY` | ElevenLabs dashboard | Used for AI voice/audio generation. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard | `0b949ff499d179e24dde841f71d6134f`. Used for R2 asset uploads. |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | Cloudflare → R2 → API tokens | R2 bucket access key. |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | Cloudflare → R2 → API tokens | R2 bucket secret. |
| `NEON_API_KEY` | Neon console → Account → API keys | Used by `neon` MCP server for direct DB queries during debugging. |
| `POSTHOG_API_KEY` | PostHog → Project Settings | Analytics event collection. |
| `NEXT_PUBLIC_POSTHOG_KEY` | Same key | Client-side PostHog init. |
| `SKIP_ENV_VALIDATION` | Set to `true` in CI | Bypasses startup env validation (needed when running `next start` without full env in CI). |

## How to Get Them

### Fast path — pull from Vercel (recommended)
```bash
# Pulls all vars configured on the Vercel project
vercel env pull web/.env.local --scope tnolan
```

This pulls Production environment variables. For preview/development:
```bash
vercel env pull web/.env.local --environment preview --scope tnolan
```

### Manual setup (new environment)

1. **Neon** — Go to Vercel dashboard → Storage tab → your Neon database → `.env.local` snippet
2. **Clerk** — https://dashboard.clerk.com → your app → API Keys
3. **Stripe** — https://dashboard.stripe.com → Developers → API keys
4. **Upstash** — https://console.upstash.com → your Redis → REST API tab

### CI/CD secrets (GitHub Actions)

These are set in GitHub → Settings → Secrets and variables → Actions:

| Secret | Value |
|--------|-------|
| `VERCEL_TOKEN` | Vercel API token (tnolan account) |
| `VERCEL_TEAM_ID` | `team_5SxqWz8yLPKiOnLbTXUyJKsp` |
| `VERCEL_PROJECT_ID` | spawnforge project ID |
| `VERCEL_STAGING_PROJECT_ID` | spawnforge-staging project ID |
| `VERCEL_DOCS_PROJECT_ID` | spawnforge-docs project ID |
| `VERCEL_DESIGN_PROJECT_ID` | spawnforge-design project ID |

## Common Errors

| Error | Likely Cause | Fix |
|-------|-------------|-----|
| `auth() called without Clerk middleware` | `CLERK_SECRET_KEY` missing or wrong | Re-pull env vars, use `safeAuth()` in Server Components |
| `Connection refused` on DB | `DATABASE_URL` missing or DB paused | Pull env vars, check Neon console |
| Rate limiting not working | `UPSTASH_REDIS_REST_URL` missing | Pull env vars |
| Stripe webhooks failing | `STRIPE_WEBHOOK_SECRET` missing | Get from Stripe dashboard → Webhooks |
| Engine CDN 404 | `NEXT_PUBLIC_ENGINE_CDN_URL` wrong | Should be `https://engine.spawnforge.ai` |
