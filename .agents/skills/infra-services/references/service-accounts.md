# SpawnForge Canonical Service Accounts

CRITICAL: Read before any infrastructure work. Using the wrong account will deploy to the wrong project or bill the wrong team.

---

## Vercel

- **Account scope**: `tnolan` (Pro account)
- **Team ID**: `team_5SxqWz8yLPKiOnLbTXUyJKsp`
- **CLI flag**: `--scope tnolan` on EVERY Vercel CLI command

### SpawnForge Vercel Projects

| Project Name | Purpose | URL |
|-------------|---------|-----|
| `spawnforge` | Main web app (production) | spawnforge.ai |
| `spawnforge-staging` | Staging environment | staging.spawnforge.ai |
| `spawnforge-docs` | Documentation site | docs.spawnforge.ai |
| `spawnforge-design` | Design workbench (Storybook) | design.spawnforge.ai |

### DO NOT TOUCH (separate apps on same account)
- `ember-frontend` — separate product
- `portfolio-site` — personal site

### GitHub Actions Secrets Required

| Secret | Value Source |
|--------|-------------|
| `VERCEL_TOKEN` | Vercel API token |
| `VERCEL_TEAM_ID` | `team_5SxqWz8yLPKiOnLbTXUyJKsp` |
| `VERCEL_PROJECT_ID` | Main web app project ID |
| `VERCEL_STAGING_PROJECT_ID` | Staging project ID |
| `VERCEL_DOCS_PROJECT_ID` | Docs project ID |
| `VERCEL_DESIGN_PROJECT_ID` | Design workbench project ID |

---

## Sentry

- **Organization**: `tristan-nolan` (NOT `ember-l0` — that is a different org)
- **Project**: `spawnforge-ai`
- **Dashboard**: https://sentry.io/organizations/tristan-nolan/projects/spawnforge-ai/
- **Config files**: `sentry.server.config.ts`, `sentry.edge.config.ts`

---

## Cloudflare

- **Account ID**: `0b949ff499d179e24dde841f71d6134f`
- **R2 Bucket — Engine CDN**: `spawnforge-engine`
  - Serves WASM binaries via custom domain worker
  - Worker: `engine-cdn` at `engine.spawnforge.ai/*`
  - Source: `infra/engine-cdn/worker.js` + `wrangler.toml`
- **R2 Bucket — Assets**: `spawnforge-assets`
  - Server-side only (signed URL uploads)
  - No CORS Worker needed
- **Upload command**: `wrangler r2 object put <bucket>/<key> --file <path> --remote`

---

## Neon (Postgres)

- **Provisioned via**: Vercel Marketplace integration
- **Connection**: via `DATABASE_URL` env var (neon-http driver)
- **ORM**: Drizzle (`web/src/lib/db/schema.ts`)
- **Schema changes**: require `npm run db:generate` + migration file

---

## Upstash (Redis)

- **Provisioned via**: Vercel Marketplace integration
- **Usage**: Rate limiting (`distributedRateLimit()`)
- **Env vars**: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

---

## Clerk (Authentication)

- **Env vars**: `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- **Webhooks**: `POST /api/webhooks/clerk`
- **CI/E2E**: Missing key = `safeAuth()` returns `{userId: null}`, auth is bypassed

---

## Stripe (Payments)

- **Tiers**: starter (free), hobbyist, creator, pro
- **Env vars**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (no publishable key — checkout redirects server-side to a Stripe-hosted page)
- **Version pin**: `^20.4.1` — v21 has breaking changes (see `changelog-review` skill)

---

## PostHog (Analytics + Feature Flags)

- **Env vars**: `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_LLM_CAPTURE`
- There is **no** `NEXT_PUBLIC_POSTHOG_HOST` — nothing in the repo reads one
- **Not client-side only**: `web/src/lib/analytics/posthog-server.ts` does content-free
  server-side LLM capture, and `web/src/lib/flags/posthogFlags.ts` evaluates feature flags
  server-side (including the `provider-kill-switch-<provider>` gates that run before token
  deduction). Both need `NEXT_PUBLIC_POSTHOG_KEY`; the flag evaluator additionally needs
  `POSTHOG_PERSONAL_API_KEY`, and server capture additionally needs `POSTHOG_LLM_CAPTURE=true`.

---

## Important Anti-Patterns

- NEVER use `nolantj-livecoms-projects` (hobby account) for SpawnForge
- NEVER omit `--scope tnolan` from Vercel CLI commands
- NEVER commit API keys or secrets to the repository
- NEVER call Vercel APIs without checking the scope first
