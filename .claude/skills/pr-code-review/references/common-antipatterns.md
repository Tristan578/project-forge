# Common Anti-Patterns — SpawnForge Codebase

These are the top recurring bugs caught in code review. Every reviewer must check for these before issuing a verdict.

---

## 1. panelRegistry Nested Insertion (21 occurrences)

**The bug:** New panel entry gets nested inside the preceding entry's object literal because the reviewer/agent didn't read the closing `},` of the prior entry.

**File:** `web/src/lib/workspace/panelRegistry.ts`

**Wrong:**
```ts
{
  id: 'existing-panel',
  component: ExistingPanel,
  // NEW PANEL INSERTED HERE — inside the existing panel's object!
  { id: 'new-panel', component: NewPanel }
}
```

**Fix:** Read 10 lines before AND after the insertion point. Run `npx vitest run src/lib/workspace/__tests__/panelRegistry.test.ts` after every edit.

---

## 2. Missing `await` on Rate Limiting

**The bug:** `rateLimitPublicRoute()` is async. Without `await`, it returns a truthy Promise, silently skipping the rate limit check on every request.

**Files:** Any file in `web/src/app/api/`

**Wrong:**
```ts
const limited = rateLimitPublicRoute(request); // returns Promise<true> — always truthy!
if (limited) return Response.json({ error: 'Rate limited' }, { status: 429 });
```

**Fix:**
```ts
const limited = await rateLimitPublicRoute(request);
```

---

## 3. `||` vs `??` for Numeric Defaults

**The bug:** `||` treats `0` as falsy. `Number(undefined)` is `NaN`, not caught by `??`.

**Wrong:**
```ts
const count = args.count || 10;       // 0 falls through to 10
const val = Number(str) ?? 0;         // NaN ?? 0 → NaN (NaN is not nullish)
```

**Fix:**
```ts
const count = args.count ?? 10;       // 0 is preserved
const val = Number.isFinite(Number(str)) ? Number(str) : 0;
```

---

## 4. `db.transaction()` with Neon HTTP Driver

**The bug:** `db.transaction()` throws "No transactions support in neon-http driver" at runtime.

**Files:** Any file importing from `@/lib/db/`

**Wrong:**
```ts
await db.transaction(async (tx) => { ... });
```

**Fix:**
```ts
const neonSql = getNeonSql();
await neonSql.transaction([
  neonSql`INSERT INTO ...`,
  neonSql`UPDATE ...`,
]);
```

---

## 5. `auth()` in Server Components

**The bug:** `auth()` from `@clerk/nextjs/server` throws when Clerk middleware isn't configured (CI/E2E environments), crashing the dev server.

**Files:** Any `page.tsx` or server component

**Wrong:**
```ts
import { auth } from '@clerk/nextjs/server';
const { userId } = auth(); // crashes in CI
```

**Fix:**
```ts
import { safeAuth } from '@/lib/auth/safe-auth';
const { userId } = safeAuth(); // returns { userId: null } if Clerk not configured
```

---

## 6. Missing `Closes #NNNN` in PR Body

**The bug:** Using `Closes PF-XXX` instead of `Closes #NNNN` (GitHub issue number). CI checks for GitHub issue numbers.

**Fix:** Run `python3 .claude/hooks/github_project_sync.py push` first to create GitHub issues, then use `gh issue list --search "PF-XXX in:title" --limit 1` to find the issue number.

---

## 7. `onConflictDoUpdate` Missing Fields

**The bug:** Fields listed in `.values()` but missing from `.set()` in an upsert silently retain the original value on conflict.

**Fix:** Compare `.values(...)` fields with `.set({...})` fields line by line. Every mutable field must appear in both.

---

## 8. ZADD Member Uniqueness Collision

**The bug:** `Date.now()` as the Sorted Set member collides within the same millisecond.

**Wrong:**
```ts
await redis.zadd(key, { score: Date.now(), member: `${Date.now()}` });
```

**Fix:**
```ts
const member = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
```

---

## 9. Duplicate YAML Keys in GitHub Actions

**The bug:** Two `env:` blocks on the same step — YAML silently drops the first one.

**Fix:** Merge all `env:` vars into a single block per step.

---

## 10. `useRef.current` During Render

**The bug:** ESLint `react-hooks/refs` rule flags this. Values read during render from refs are not reactive.

**Fix:** Use the `useState` prev-value pattern:
```tsx
const [prev, setPrev] = useState(prop);
if (prev !== prop) { setPrev(prop); setDerived(compute(prop)); }
```

---

## 11. `neon-http` Tagged Template Returns Array, Not Object

**The bug:** `neonSql\`...\`` resolves to `Row[]`, not `{ rowCount: number }`. Using `.rowCount` returns `undefined`.

**Fix:** Use `.length` to check rows affected:
```ts
const rows = await neonSql`INSERT INTO ...`;
if (rows.length === 0) { /* nothing inserted */ }
```

---

## 12. Cherry-Pick Without Lockfile Regeneration

**The bug:** Cherry-picking commits that modify `package.json` without regenerating `package-lock.json` breaks `npm ci` in CI.

**Fix:** After any cherry-pick touching `package.json`, run `npm install` to regenerate the lockfile.

---

## 13. Stripe v21 Hold-Back

**The bug:** `stripe` is pinned at `^20.4.1`. Do not upgrade to v21 — breaking changes in decimal string fields.

**Fix:** Any PR bumping `stripe` past `20.x` is a FAIL.

---

## 14. `experimental.sri` in next.config

**The bug:** SRI hashes baked at build time break on Vercel's edge layer (compression changes bytes). Produces blank pages.

**Fix:** Reject any PR re-enabling `experimental.sri`.

---

## 15. `Clerk <SignIn>/<SignUp>` in Server Components

**The bug:** Importing `<SignIn>` from `@clerk/nextjs` in a Server Component causes SSR 500 in production.

**File pattern:** `app/**/page.tsx` that renders auth components

**Fix:** Wrap in a dedicated `'use client'` file (e.g. `SignInClient.tsx`).
