# Next.js Conventions Reference

Conventions for Next.js 16.x (App Router) in `web/src/`.

## File Conventions

| File | Purpose |
|------|---------|
| `app/layout.tsx` | Root layout — `force-dynamic` export required for CI |
| `app/page.tsx` | Route page (Server Component by default) |
| `app/error.tsx` | Error boundary for the route segment |
| `app/loading.tsx` | Suspense skeleton for the route segment |
| `app/not-found.tsx` | 404 page |
| `app/route.ts` | API route handler — no conflicting `page.tsx` in same dir |
| `proxy.ts` | Auth middleware (renamed from `middleware.ts` in Next.js 16) |

## Middleware: proxy.ts

Next.js 16 renames `middleware.ts` → `proxy.ts`. Export `proxy`, not `middleware`:

```ts
// web/src/proxy.ts
import { clerkMiddleware } from '@clerk/nextjs/server';
export const proxy = clerkMiddleware(...);
```

## Server Components by Default

Files in `app/` are Server Components unless explicitly marked `'use client'`. Push the
`'use client'` boundary as far down the tree as possible:

```
app/editor/page.tsx           — Server Component (fetches session, passes data)
  └─ components/editor/EditorLayout.tsx   — 'use client' boundary (needs Zustand)
       └─ components/editor/InspectorPanel.tsx  — 'use client' (uses hooks)
```

## Server Actions for Mutations

Use Server Actions (not API routes) for form submissions and mutations from Server
Components:

```ts
// app/actions/createProject.ts
'use server';
import { auth } from '@clerk/nextjs/server';
export async function createProject(formData: FormData) {
  const { userId } = await auth();
  ...
}
```

## Async Request APIs (Next.js 15+)

`cookies()`, `headers()`, `params`, and `searchParams` are now async:

```ts
// CORRECT
const cookieStore = await cookies();
const { id } = await params;

// WRONG — synchronous access removed in Next.js 15
const cookieStore = cookies();
```

## safeAuth() — NEVER auth() in Page Files

`auth()` from `@clerk/nextjs/server` throws when Clerk is not configured (CI/E2E). Use
`safeAuth()` from `@/lib/auth/safe-auth.ts` in all page and layout files:

```ts
// CORRECT
import { safeAuth } from '@/lib/auth/safe-auth';
const { userId } = await safeAuth();

// WRONG — crashes in CI without CLERK_SECRET_KEY
import { auth } from '@clerk/nextjs/server';
const { userId } = await auth();
```

## Clerk SignIn/SignUp Must Be 'use client'

Importing `<SignIn>` or `<SignUp>` from `@clerk/nextjs` in a Server Component causes a
production SSR 500. Always wrap in a dedicated client file:

```tsx
// app/sign-in/SignInClient.tsx
'use client';
import { SignIn } from '@clerk/nextjs';
export default function SignInClient() {
  return <SignIn />;
}
```

## Import Boundary

Next.js production builds CANNOT import outside `web/`. Never import from `../mcp-server`
or `../../packages` in page/component files.

Exception: `@spawnforge/ui` is allowed via `transpilePackages` in `next.config.ts`.

## MCP Manifest Dual Location

```
mcp-server/manifest/commands.json   ← source of truth
web/src/data/commands.json          ← COPY — must be kept in sync
```

When adding or editing commands, update BOTH files. Run `bash .claude/tools/validate-mcp.sh sync`
to verify they match.

## Turbopack vs Webpack

| Context | Bundler |
|---------|---------|
| `npm run dev` | Webpack (`--webpack` flag — Turbopack has compatibility issues with dev) |
| `npm run build` | Turbopack (default in Next.js 16) |
| CI | Turbopack |

Do not add webpack-only plugins that are incompatible with Turbopack.

## Root Layout force-dynamic

`web/src/app/layout.tsx` exports:

```ts
export const dynamic = 'force-dynamic';
```

This prevents prerender failures when Clerk keys are absent (CI/E2E environments). Do not
remove this export.

## Route Handlers

- File: `app/api/my-route/route.ts`
- Export named functions: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`
- No `page.tsx` in the same directory as `route.ts` — they conflict
- No React DOM available — route handlers run in the Edge/Node runtime

```ts
// app/api/example/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest) {
  return NextResponse.json({ ok: true });
}
```
