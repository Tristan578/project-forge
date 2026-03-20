# Vercel Integration Patterns

## Configuration
- Framework: Next.js 16 on Vercel
- Dev: `cd web && npm run dev` (uses `--webpack`, NOT Turbopack)
- Build: `cd web && npm run build` (uses Turbopack by default)
- Edge middleware: `web/src/proxy.ts` (NOT `middleware.ts` -- Next.js 16 renamed it). Export `proxy` function, not `middleware`
- Root layout: `export const dynamic = "force-dynamic"` -- prevents prerender failures when Clerk keys missing in CI

## Environment Variables
- `NEXT_PUBLIC_ENGINE_CDN_URL=https://engine.spawnforge.ai` -- build-time, Production + Preview
- `NEXT_PUBLIC_POSTHOG_KEY` -- client-side analytics
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` -- client-side auth
- Server-only: `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `DATABASE_URL`, `SENTRY_DSN`

## Gotchas
1. **maxDuration**: AI-heavy routes MUST export `export const maxDuration = 60` (or higher). Default is 10s on Vercel, which kills generation routes.
2. **Import boundary**: Next.js cannot import outside `web/`. Shared data must be copied into `web/src/data/`.
3. **Edge Runtime**: `proxy.ts` runs on Edge. No Node.js APIs (no `fs`, no `Buffer` from node).
4. **Turbopack**: Default for builds in Next.js 16. Dev uses `--webpack` for compatibility.
5. **Staging**: `spawnforge-staging` environment exists and is configured.

## Testing
- Mock `next/server` for API route tests
- CI builds without Clerk keys -- `force-dynamic` on root layout handles this
