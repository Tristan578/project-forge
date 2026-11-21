# Required Environment Variables

Pull all variables at once with:

```bash
vercel env pull web/.env.local --scope tnolan
```

`web/.env.example` is the machine-checkable companion to this file: every name below
appears there, and the [drift check](#drift-check) at the bottom proves the two agree
with the code.

## Read this before trusting a "present" result

Most generation keys are **not** read as a literal `process.env.NAME`. Two indirection
tables sit in the way:

| Table | File | Read as |
|---|---|---|
| `PLATFORM_KEY_ENV` | `web/src/lib/config/providers.ts:173-182` | `process.env[PLATFORM_KEY_ENV[provider]]` |
| `ASSET_STORAGE_ENV` | `web/src/lib/config/assetStorage.ts:12-17` | `process.env[ASSET_STORAGE_ENV.accountId]` |

Three consequences, all of which have bitten this project:

1. **Grepping for the literal name finds only the table.** A name that looks unreferenced
   may be load-bearing. Do not delete a variable because `grep process.env.PLATFORM_MESHY_KEY`
   comes back empty.
2. **An unset key produces a degraded provider path, not a startup failure.** Nothing
   throws, no health check goes red at boot, and the route only fails when a user
   actually asks for that capability. "The app started fine" is not evidence that the
   environment is configured.
3. **Drift between the table and the deployed environment is silent.** `healthChecks.ts`
   once read `MESHY_API_KEY` / `ELEVENLABS_API_KEY` / `SUNO_API_KEY` — names nothing sets
   — and the public status page reported a permanent "AI Assistant: outage" against a
   working install (PF-1054, recorded in the comment at `providers.ts:169`).

The live consequence today is **#9117**: zero `PLATFORM_*` keys are set in Vercel
production, so every platform-path generation fails before charging (500 for a missing key; `music` is declared unavailable in code and refused 503 at every entry point, see `docs/guides/platform-keys.md`). That state was easy to reach and hard to
notice partly because this checklist did not name the keys that matter. It does now.

To check the platform keys as the app sees them rather than as you hope they are, hit
`/api/capabilities` — it reports per-capability availability derived from the same
`PLATFORM_KEY_ENV` table.

## Required (app will not start without these)

| Variable | Source | Description |
|----------|--------|-------------|
| `DATABASE_URL` | Neon (auto-provisioned via Vercel integration) | PostgreSQL connection string for Drizzle ORM. Format: `postgresql://user:pass@host/db?sslmode=require` |
| `CLERK_SECRET_KEY` | Clerk dashboard → API Keys | Server-side Clerk secret. Prefix: `sk_live_` (prod) or `sk_test_` (dev). Without this, `auth()` throws and all protected routes 500. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API Keys | Client-side Clerk key. Prefix: `pk_live_` (prod) or `pk_test_` (dev). Required for `<ClerkProvider>` in the browser. There is no bare `CLERK_PUBLISHABLE_KEY` — nothing reads one. |
| `STRIPE_SECRET_KEY` | Stripe dashboard → Developers → API keys | Server-side Stripe secret. Prefix: `sk_live_` (prod) or `sk_test_` (dev). Required for billing, subscriptions, and token purchases. |
| `ENCRYPTION_MASTER_KEY` | Generate once, store in Vercel | AES-256-GCM key encrypting BYOK API keys at rest. Exactly 64 hex chars: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Rotating it makes every stored BYOK key undecryptable. |
| `UPSTASH_REDIS_REST_URL` | Upstash console → Database → REST API | Upstash Redis REST endpoint. Used for rate limiting (IP-based, 30 req/5min). Without this, rate limiting silently fails open. |

## Required for Full Functionality

| Variable | Source | Description |
|----------|--------|-------------|
| `UPSTASH_REDIS_REST_TOKEN` | Upstash console → Database → REST API | Auth token for Upstash REST API. Paired with `UPSTASH_REDIS_REST_URL`. |
| `STRIPE_WEBHOOK_SECRET` | Stripe dashboard → Webhooks → endpoint secret | Verifies Stripe webhook signatures at `/api/webhooks/stripe`. Without this, all webhooks are rejected. |
| `CLERK_WEBHOOK_SECRET` | Clerk dashboard → Webhooks → endpoint secret | Verifies Clerk webhook signatures. Without this, user-lifecycle syncs are rejected. |
| `STRIPE_PRICE_STARTER` / `_CREATOR` / `_STUDIO` | Stripe dashboard → Products | Subscription price IDs. Checkout for a tier fails without its ID. |

## Platform generation keys — the `PLATFORM_KEY_ENV` set

All eight values from `web/src/lib/config/providers.ts:173-182`, complete. These are the
keys used for users who do not bring their own (BYOK). **Each is read through the dynamic
indirection described above** — an unset key degrades that provider rather than failing
the app.

| Variable | Provider | What degrades when unset |
|----------|----------|--------------------------|
| `ANTHROPIC_API_KEY` | Anthropic | AI chat and every text-generation route for non-BYOK users. This is the one the status page's "AI Assistant" check reads. |
| `PLATFORM_OPENAI_KEY` | OpenAI | Image and texture generation for non-BYOK users. |
| `PLATFORM_MESHY_KEY` | Meshy | 3D model and texture generation (`model3d`, `texture` capabilities). |
| `PLATFORM_HYPER3D_KEY` | Hyper3D | Alternative 3D model generation backend. |
| `PLATFORM_ELEVENLABS_KEY` | ElevenLabs | SFX and voice generation (`sfx`, `voice` capabilities). |
| `PLATFORM_SUNO_KEY` | Suno | Unobtainable — Suno has no public API. `music` is declared unavailable in `UNAVAILABLE_CAPABILITIES` regardless of this key and refused before any charge (#9117 / #9522); see `docs/guides/platform-keys.md`. |
| `PLATFORM_REPLICATE_KEY` | Replicate | Sprite generation (`sprite` capability). |
| `PLATFORM_REMOVEBG_KEY` | remove.bg | Background removal (`bg_removal` capability). |

There are no `MESHY_API_KEY`, `ELEVENLABS_API_KEY` or `SUNO_API_KEY` variables in `web/`.
Those three names are read only by `autoforge/autoforge.config.ts`, a sibling workspace.
Setting them does nothing for the app; the comment at `providers.ts:169` exists to stop
that mistake recurring.

## Optional (features degrade gracefully)

| Variable | Source | Description |
|----------|--------|-------------|
| `AI_GATEWAY_API_KEY`, `OPENROUTER_API_KEY`, `GITHUB_MODELS_PAT`, `GOOGLE_AI_API_KEY` | Respective dashboards | Fallback routing for alternative AI providers. |
| `NEXT_PUBLIC_ENGINE_CDN_URL` | Set manually | Base URL for the WASM engine CDN. Production: `https://engine.spawnforge.ai`. Without this, the engine loads from `/engine-pkg-*` in `web/public/`. |
| `NEXT_PUBLIC_ENGINE_VERSION` | Set by CI to the engine build SHA | Cache-busting suffix on engine asset URLs and the preload hint. Unset means no suffix. |
| `CDN_URL` | Set manually | Public base URL marketplace asset keys are served from. **Distinct from `NEXT_PUBLIC_ENGINE_CDN_URL`** — that one is the WASM engine. Signed download URLs and the download route's host check both derive from this. |
| `ASSET_CDN_HOSTS` | Set manually | Comma-separated allowlist of CDN hosts for asset downloads. |
| `ASSET_R2_ACCOUNT_ID`, `ASSET_R2_ACCESS_KEY_ID`, `ASSET_R2_SECRET_ACCESS_KEY`, `ASSET_BUCKET_NAME` | Cloudflare → R2 → API tokens | Marketplace asset object storage, read via `ASSET_STORAGE_ENV`. Without them, asset upload returns 501. There is no `ASSET_STORAGE_TYPE` variable — nothing in the repo reads one. The `CLOUDFLARE_*` names are wrangler/CLI credentials for `/deploy-engine`, not app env vars. |
| `SENTRY_DSN` | Sentry → Project → Settings → Client Keys | Error reporting. Without this, production errors are silently dropped. |
| `NEXT_PUBLIC_SENTRY_DSN` | Same DSN | Client-side Sentry init. Must match `SENTRY_DSN`. |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Sentry → User Settings → Auth Tokens; org `tristan-nolan`; project `spawnforge-ai` | **Build-time only.** `@sentry/nextjs` uploads source maps with these. The build succeeds without them; stack traces stay minified. |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog → Project Settings | Client-side analytics. |
| `POSTHOG_PERSONAL_API_KEY` | PostHog → Personal API Keys | Paired with `NEXT_PUBLIC_POSTHOG_KEY`, activates the local flag evaluator (`web/src/lib/flags/posthogFlags.ts`, PF-971): the `deep-generation-tier` flag and the `provider-kill-switch-<provider>` kill switches. Set only one of the two and the evaluator stays dormant with zero network I/O. |
| `POSTHOG_LLM_CAPTURE` | Set manually | Exact string `"true"` captures LLM prompt/completion payloads to PostHog. Default off. |
| `STRIPE_TAX_ENABLED` | Set manually | Exact string `"true"` creates checkout sessions with `automatic_tax`. **Default off** — billing behaviour changes when set. |
| `STRIPE_RADAR_REVIEW_HOLD` | Set manually | Exact string `"true"` holds payments Radar flags for review instead of fulfilling them. **Default off** — billing behaviour changes when set. |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Stripe → Billing → Customer portal | Billing-portal configuration. Overridable per call; unset means Stripe's account-default portal. |
| `BILLING_METERS_ENABLED` | Set manually | Exact string `"true"` reports confirmed generation token usage to the Stripe `generation_tokens` meter (PF-977/PF-978). The meter must be provisioned first (`web/scripts/provision-billing-meter.ts`), once per Stripe mode. Anything other than `"true"` leaves it fully dormant. Runbook: `docs/guides/billing-meters-setup.md`. |
| `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | Upstash console → QStash | Durable server-side generation callbacks (PF-906). All three plus `NEXT_PUBLIC_APP_URL` (public origin) required; leave any unset and the client-side poller stays the only completion path. |
| `NEXT_PUBLIC_USE_DEEP_GENERATION` | Set manually | Exact string `"true"` routes GDD/world-builder/cutscene generators to `AI_MODEL_DEEP`. A PostHog `deep-generation-tier` flag overrides it when the evaluator is active. |
| `USE_GENERATION_AGENT` | Set manually | Exact string `"true"` routes generation through the server-side agent path. |
| `MCP_HTTP_URL`, `MCP_HTTP_TOKEN` | Your MCP deployment | Remote MCP server. **Both** required; either alone leaves the HTTP client disabled and the in-process server is used. |
| `NEXT_PUBLIC_APP_URL` | Set manually | Public origin for Stripe redirect URLs and QStash callbacks. Defaults to `http://localhost:3000`. |
| `NEXT_PUBLIC_SITE_URL` | Set manually | Canonical origin in marketing-page metadata and JSON-LD. Defaults to `https://spawnforge.ai`. |
| `NEXT_PUBLIC_ENVIRONMENT`, `STAGING_URL` | Set manually | `staging` enables environment-aware behaviour; `STAGING_URL` is required for CORS on staging deployments. |
| `ADMIN_USER_IDS` | Clerk user IDs | Comma-separated list granting `/admin` access. |
| `CRON_SECRET` | Set manually | Shared secret cron routes check. See #9118. |
| `MODERATION_BLOCK_LIST`, `TRADEMARK_BLOCK_LIST` | Set manually | Comma-separated blocked words / trademarked names for generated content. Both merge with built-in lists; unset leaves the built-ins alone. |
| `DB_RATE_LIMIT_PER_SECOND` | Set manually | Max DB operations/sec across instances. Default 80; must be > 0. |
| `LOG_LEVEL` | Set manually | `debug` \| `info` \| `warn` \| `error` for server-side structured logging. |
| `SKIP_ENV_VALIDATION` | Set to `true` in CI | Bypasses startup env validation (needed when running `next start` without full env in CI). |
| `NEXT_PUBLIC_E2E_HOOKS` | Playwright only | Exact string `"true"` exposes deterministic test hooks on `window`. **Never set in production.** |
| `ASEPRITE_PATH` | Local install | Absolute path to an Aseprite binary. Read only by the opt-in Aseprite bridge integration test and its fixture recorder — the app never reads it. |
| `ANALYZE` | `npm run analyze` | Build-time only; `1` emits the bundle visualization. |

## Injected by the platform — never set by hand

`NODE_ENV` and `NEXT_RUNTIME` come from Next.js. `VERCEL`, `VERCEL_ENV`, `VERCEL_URL`,
`VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_COMMIT_REF`, `NEXT_PUBLIC_VERCEL_ENV`,
`NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`, `VERCEL_SKEW_PROTECTION_ENABLED` and
`VERCEL_DEPLOYMENT_ID` come from Vercel when "Automatically expose system environment
variables" is ON. They are listed in `.env.example` only so the drift check below comes
out clean.

## Not app environment variables

Named here because they get mistaken for app config:

- `NEON_API_KEY` — used by the `neon` MCP server for direct DB queries while debugging.
  Belongs in your MCP client config (`.mcp.json`), not `.env.local`.
- `CLOUDFLARE_ACCOUNT_ID` and the `CLOUDFLARE_R2_*` pair — wrangler credentials for
  `/deploy-engine`. The app's R2 access uses the `ASSET_R2_*` names instead.

## Drift check

Run this after changing either file. It compares every production `process.env` read
under `web/` against `web/.env.example`:

```bash
{ grep -rl 'process\.env' web/src web/scripts \
    | grep -v '__tests__\|\.test\.\|\.spec\.'
  ls web/next.config.ts web/instrumentation*.ts web/sentry*.ts 2>/dev/null
} > /tmp/files.txt
xargs grep -hoE 'process\.env\.[A-Z_][A-Z0-9_]*|process\.env\[.[A-Z_][A-Z0-9_]*.\]' < /tmp/files.txt \
  | sed -E "s/process\.env\[?\.?['\"]?//; s/['\"]?]?$//" | sort -u > /tmp/reads.txt
grep -oE '^#? *[A-Z_][A-Z0-9_]*=' web/.env.example | sed -E 's/^#? *//; s/=$//' | sort -u > /tmp/documented.txt
comm -23 /tmp/reads.txt /tmp/documented.txt   # read but undocumented
comm -13 /tmp/reads.txt /tmp/documented.txt   # documented but not literally read
```

Expected output as of 2026-08-29:

- **read but undocumented** — empty except the nine platform-injected names above.
- **documented but not literally read** — exactly the two indirection tables
  (`ANTHROPIC_API_KEY` + the seven `PLATFORM_*`; the four `ASSET_R2_*`/`ASSET_BUCKET_NAME`),
  the three autoforge-only names, and `ASEPRITE_PATH` (test-only).

Anything else in either list is real drift. Note the second list is where a silently
degraded provider hides — a new name there needs an explanation, not a shrug.

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

Pulling does **not** tell you a variable is set correctly — only that Vercel has a value
for it. For the platform keys, confirm against `/api/capabilities`.

### Manual setup (new environment)

1. **Neon** — Go to Vercel dashboard → Storage tab → your Neon database → `.env.local` snippet
2. **Clerk** — https://dashboard.clerk.com → your app → API Keys
3. **Stripe** — https://dashboard.stripe.com → Developers → API keys
4. **Upstash** — https://console.upstash.com → your Redis → REST API tab
5. **Platform generation keys** — one per provider in the `PLATFORM_KEY_ENV` table above.
   Skipping this step is #9117.

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
| Generation 500s for non-BYOK users, app otherwise healthy | The relevant `PLATFORM_*` key is unset — no startup error is produced | Check `/api/capabilities`, then set the key from the table above. This is #9117. |
| Status page reports a provider outage that is not real | A `PLATFORM_KEY_ENV` value drifted from the deployed variable name | Compare `providers.ts:173-182` against `web/.env.example` and Vercel. This is PF-1054. |
| Asset upload returns 501 | One of the four `ASSET_R2_*` / `ASSET_BUCKET_NAME` names is unset | Set all four; there is no `ASSET_STORAGE_TYPE` to set |
