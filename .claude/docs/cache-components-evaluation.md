# Evaluation: `cacheComponents` and `cachedNavigations` in Next.js 16.2

**Date:** 2026-03-22
**Ticket:** PF-826
**Result:** Both flags enabled and working. `'use cache'` directives added to 3 Server Component pages.

## What `cacheComponents` Does

`cacheComponents` is a **top-level** `NextConfig` option (not inside `experimental`) that gates the `'use cache'` directive for Server Components. When `false` (default), adding `'use cache'` at the top of a Server Component file causes a build-time error:

```
Error: Caching is not enabled in the current environment.
```

When `true`, the `'use cache'` directive is processed by the React/Next.js compiler and the component's render output is cached by the Next.js cache layer. This is equivalent to the `unstable_cache` mechanism but expressed as a file-level directive.

Source: `web/node_modules/next/dist/server/config-shared.js` line 135 — defaults to `false`, promoted to the root config object (not experimental).

## What `cachedNavigations` Does

`cachedNavigations` lives inside `experimental` and inherits `cacheComponents`'s value by default (config-shared.js line 133 comment: "Will default to cacheComponents value"). When enabled, the App Router stores rendered RSC (React Server Component) payloads for navigations at the edge, so subsequent navigations to the same route are served from cache without a server round-trip.

This is distinct from `prefetchInlining` (which inlines prefetch payloads into the page HTML) — `cachedNavigations` applies at the navigation response level.

## Build Result

Build succeeded with both flags enabled:

```
▲ Next.js 16.2.0 (Turbopack)
✓ Compiled successfully in 8.0s
```

The flags do not appear in the "Experiments" list in build output because `cacheComponents` is not an experimental flag and `cachedNavigations` does not log separately. No errors related to either flag.

The existing Turbopack NFT tracing warning (about the `next.config.ts` import trace) is pre-existing and unrelated to these flags.

## Pages Updated with `'use cache'`

The following pure Server Component pages had `'use cache'` added as their first line:

| File | Purpose |
|------|---------|
| `web/src/app/(marketing)/page.tsx` | Marketing home page — static content, icons, no dynamic data |
| `web/src/app/privacy/page.tsx` | Privacy policy — static legal content |
| `web/src/app/terms/page.tsx` | Terms of service — static legal content |

These pages are pure Server Components with no `cookies()`, `headers()`, or other per-request dynamic data. They are safe to cache globally.

## Pages NOT Updated

- `web/src/app/(pricing)/page.tsx` — This is a client component wrapper (`'use client'`). `'use cache'` applies only to Server Components.
- Any page using `cookies()`, `headers()`, `auth()`, or other request-scoped APIs — these must not use `'use cache'` globally (would serve stale/wrong user data).

## Known Considerations

1. **Cache invalidation**: `'use cache'` uses the default `cacheLife` (configured in `next.config.ts`). These static pages can safely use long cache lifetimes.
2. **Revalidation**: If marketing content changes, a full deployment triggers revalidation. No `revalidatePath()` calls are needed for these fully static pages.
3. **Gateway compatibility**: `cachedNavigations` stores RSC payloads at the edge. Verify with `vercel inspect` after deployment that edge caching is active.
4. **No `use cache` in layouts**: The root layout has `export const dynamic = "force-dynamic"` for Clerk compatibility. Do not add `'use cache'` to layouts.
