# Common Failure Patterns in SpawnForge

Patterns that recur across sessions, with diagnostic steps and confirmed fixes.

---

## 1. Node 25.x Segfaults (V8 JIT Bug)

**Symptom:** Hook or script crashes mid-execution with a C++ stack trace referencing `libnode`. Output shows something like `Segmentation fault: 11` or `Illegal instruction`.

**Root cause:** Intermittent V8 JIT compiler bug in Node 25.x. Not our code.

**Diagnosis:**
```bash
node --version   # If v25.x, this is likely the cause
```

**Fix:**
- Downgrade to Node 22 LTS (current LTS as of 2026): `nvm use 22`
- Do NOT bypass with `--no-verify` or skip the hook — fix the runtime first
- If downgrade is not possible, retry the operation once (JIT crashes are non-deterministic)

---

## 2. `auth()` Crash Without Clerk Middleware

**Symptom:** Dev server crashes on startup, or E2E tests fail with a cryptic Clerk error. Error message: "Clerk: You are calling... outside of a clerkMiddleware context."

**Root cause:** `auth()` from `@clerk/nextjs/server` called directly in a Server Component without `clerkMiddleware()` wrapping the route. Common in CI and E2E where `CLERK_SECRET_KEY` is missing.

**Diagnosis:**
```bash
grep -rn "from '@clerk/nextjs/server'" web/src/app/ | grep -v "safeAuth\|proxy\|sign-in\|sign-up"
```

**Fix:** Use `safeAuth()` from `@/lib/auth/safe-auth.ts` instead:
```typescript
// WRONG
import { auth } from '@clerk/nextjs/server';
const { userId } = await auth();

// CORRECT
import { safeAuth } from '@/lib/auth/safe-auth';
const { userId } = await safeAuth();  // returns { userId: null } when Clerk is absent
```

---

## 3. `neon-http` `db.transaction()` Crash

**Symptom:** API route crashes with "No transactions support in neon-http driver."

**Root cause:** Drizzle's `db.transaction()` is not supported by the neon-http driver (which is what we use for serverless).

**Diagnosis:**
```bash
grep -rn "db\.transaction" web/src/ | grep -v "\.test\."
```

**Fix:** Use `getNeonSql()` with tagged template transactions:
```typescript
// WRONG
await db.transaction(async (tx) => { ... });

// CORRECT
const neonSql = getNeonSql();
await neonSql.transaction([
  neonSql`INSERT INTO ...`,
  neonSql`UPDATE ...`,
]);
```

---

## 4. Missing WASM Binaries

**Symptom:** Editor canvas is blank, engine events never fire, E2E tests time out waiting for the engine.

**Diagnosis:**
```bash
ls web/public/engine-pkg-*/forge_engine_bg.wasm 2>/dev/null || echo "MISSING"
```

**Fix:**
```powershell
# Run the full dual build (5-10 minutes)
powershell -ExecutionPolicy Bypass -File build_wasm.ps1
```

**Common build failures:**
- wasm-bindgen version mismatch: `cargo install wasm-bindgen-cli --version 0.2.108 --force`
- Missing target: `rustup target add wasm32-unknown-unknown`
- Missing wasm-opt: `cargo install wasm-opt` or `npm i -g wasm-opt`
- `tonemapping_luts` feature missing: check `engine/Cargo.toml` Bevy features

---

## 5. Turbopack vs Webpack Differences

**Symptom:** Dev server works but production build fails, or vice versa. Specific error: module not found, or "You're importing a component that needs X" appearing only in one mode.

**Root cause:** SpawnForge dev uses `--webpack` flag (compatibility); builds use Turbopack (default in Next.js 16).

**Diagnosis:**
```bash
# Check what flag is used in dev
grep "\"dev\"" web/package.json
```

**Common causes:**
- `next/dynamic` imports that work in Webpack but fail in Turbopack
- CSS `@import` ordering differences
- Server/client boundary detection differences

**Fix:** Test your changes with both:
```bash
cd web && npm run dev       # Webpack (dev)
cd web && npm run build     # Turbopack (production)
```

---

## 6. panelRegistry Nesting Bug

**Symptom:** A new panel opens inside another panel's content area, or two panels collapse into one.

**Root cause:** When inserting a new panel entry into `panelRegistry.ts`, the closing `},` of the preceding entry was consumed, causing the new entry to be nested inside the previous one's object literal.

**Diagnosis:**
```bash
cd web && npx vitest run src/lib/workspace/__tests__/panelRegistry.test.ts
```

**Fix:**
1. Read 10 lines BEFORE and AFTER the insertion point before editing
2. Verify the closing `},` of the previous entry is still present after your edit
3. Run the panelRegistry test immediately after editing

---

## 7. `rateLimitPublicRoute()` Missing `await`

**Symptom:** Rate limiting silently bypassed — all requests pass regardless of rate. No error thrown.

**Root cause:** `rateLimitPublicRoute()` is async. Without `await`, it returns a `Promise` (truthy) — the rate limit check is never actually evaluated.

**Diagnosis:**
```bash
grep -n "rateLimitPublicRoute(" web/src/app/api/ -r | grep -v "await "
```

**Fix:**
```typescript
// WRONG — silently passes all requests
const limited = rateLimitPublicRoute(request);

// CORRECT — actually waits for the check
const limited = await rateLimitPublicRoute(request);
if (limited) return limited;
```

---

## 8. `experimental.sri` Breaking Production (Blank Page)

**Symptom:** Production site loads blank page. Browser console shows integrity check failures: `Failed to find a valid digest in the 'integrity' attribute for resource`.

**Root cause:** Next.js SRI bakes sha256 hashes at build time. Vercel's CDN post-processes chunks (compression, immutable headers), changing byte content and invalidating hashes.

**Fix:** Remove `experimental.sri` from `next.config.ts`. CSP `script-src 'self'` covers external injection.

**Never re-enable this option.**

---

## 9. Clerk `<SignIn>`/`<SignUp>` in Server Components

**Symptom:** SSR 500 error in production for sign-in page. Works fine in development.

**Root cause:** Importing Clerk UI components from `@clerk/nextjs` in a Server Component triggers server-side evaluation of Clerk internals.

**Fix:** Always use a `'use client'` wrapper:
```typescript
// web/src/components/auth/SignInClient.tsx
'use client';
import { SignIn } from '@clerk/nextjs';
export function SignInClient() { return <SignIn />; }
```

---

## 10. Duplicate YAML `env:` Keys Silently Dropping Credentials

**Symptom:** Deploy step fails at 0s with "authentication required" or 401. No obvious error message.

**Root cause:** YAML allows duplicate keys but silently drops the first occurrence. GitHub Actions workflows with two `env:` blocks on the same step lose the first block's contents.

**Diagnosis:**
```bash
grep -n "^\s*env:" .github/workflows/*.yml
# Look for the same step having env: appear twice
```

**Fix:** Merge all env vars into a single `env:` block per step.
