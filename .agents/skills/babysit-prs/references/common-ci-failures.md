# Common CI Failure Patterns in SpawnForge

Top 10 failure patterns seen in CI, with diagnostic steps and fixes.

---

## 1. ESLint Warnings (Zero-Warning Policy)

**Symptom:** `eslint` job fails with `X warnings found` or `error: Too many warnings`.

**Common causes and fixes:**

| Warning | Fix |
|---------|-----|
| `no-unused-vars` | Remove unused import/variable, or prefix with `_` |
| `react-hooks/exhaustive-deps` | Add missing dep to array, wrap handler in `useCallback` |
| `react-hooks/purity` | Move `Date.now()`/`Math.random()` to `useEffect` or `useMemo` |
| `@next/next/no-img-element` | Replace `<img>` with `next/image` |
| `jsx-a11y/alt-text` | Add `alt` prop; import Lucide `Image` as `ImageIcon` |
| Blanket `eslint-disable` | Replace with `eslint-disable-next-line` on specific line |

**Diagnosis:**
```bash
cd web && npx eslint --max-warnings 0 . 2>&1 | head -40
```

---

## 2. TypeScript Errors

**Symptom:** `tsc` job fails with type errors.

**Common causes:**
- `any` type used without `@ts-expect-error`
- Missing return types on exported functions
- Zustand store slice doesn't match `EditorStore` interface after adding new slice fields
- `Promise<void>` vs `Promise<Response>` mismatch in route handlers

**Diagnosis:**
```bash
cd web && npx tsc --noEmit 2>&1 | head -60
```

**Fix pattern:** Check the specific file and line. Usually a missing type annotation or a mismatched interface. Never cast to `any` — fix the actual type.

---

## 3. Vitest Timeouts (vitest#3077)

**Symptom:** CI hangs at `vitest run --coverage` for 10+ minutes, then exits 124 (timeout).

**Root cause:** `jsdom` environment leaves open handles (HTTP connections, timers) that prevent process exit.

**Fix already in place:** `quality-gates.yml` runs `timeout 600 npx vitest run --coverage` and adjudicates the exit code with `scripts/check-vitest-exit.sh`, which swallows a timeout only when the output shows a green summary AND the coverage-report marker (read that script's header for the exact guarantee). If you see this fail:
- Check `vitest.config.ts` — ensure `pool: 'threads'` is set
- Ensure tests that use `fetch` mock it properly (don't leave real requests open)
- Add `afterEach(() => vi.restoreAllMocks())` to test files using timers

---

## 4. E2E Hydration Failures

**Symptom:** Playwright test fails clicking a button that should be visible, or gets intercepted by a dialog.

**Root cause:** Clerk/Next.js hydration creates a `<dialog>` element that overlays the page during initial load.

**Fix:**
```typescript
// Wait for hydration dialog to dismiss before interacting
const dialog = page.getByRole('dialog');
if (await dialog.isVisible()) {
  await dialog.waitFor({ state: 'hidden', timeout: 5000 });
}
```

**Diagnosis:**
```bash
cd web && npx playwright test <failing-test> --debug
# Look for dialog elements in the DOM snapshot
```

---

## 5. Missing Environment Variables

**Symptom:** Build fails with `Missing required environment variable: DATABASE_URL` or Clerk throws during SSR.

**Common missing vars in CI:**
- `DATABASE_URL` — Neon connection string
- `CLERK_SECRET_KEY` — Required for `auth()` calls in server components
- `STRIPE_SECRET_KEY` — Required for billing routes
- `UPSTASH_REDIS_REST_URL` — Required for rate limiting

**Fix:**
- Ensure vars are set in GitHub Actions secrets and referenced in the workflow `env:` block
- For tests that don't need real services, add `SKIP_ENV_VALIDATION=true` to the env block
- Use `safeAuth()` instead of `auth()` in Server Components — returns `{userId: null}` when Clerk is missing

**Diagnosis:**
```bash
gh run view <RUN_ID> --log-failed | grep "Missing\|CLERK\|DATABASE\|STRIPE"
```

---

## 6. Lockfile Drift (`npm ci` fails)

**Symptom:** `npm ci` fails with `npm ERR! Invalid: lock file's ... does not satisfy ...` or similar.

**Root cause:** `package.json` was updated but `package-lock.json` was not regenerated. Common after cherry-picks that touch `package.json`.

**Fix:**
```bash
cd "$(git rev-parse --show-toplevel)" && npm install   # single root lockfile — there is no web/package-lock.json
git add package-lock.json
git commit -m "chore: regenerate lockfile"
```

**Prevention:** The `auto-lockfile-sync.sh` hook should catch this on Edit/Write. If it didn't fire, check `.claude/hooks/`.

---

## 7. Sentry Comment Blocking PR Review

**Symptom:** PR has an unanswered Sentry (Seer) "Bug prediction" or "Security" comment.

**Process:**
1. Read the Sentry comment carefully
2. Determine: real bug, false positive, or already fixed?
3. Post a reply (mandatory — even false positives need a reply):
   - Real bug fixed: `"Fixed in abc1234. <description>"`
   - False positive: `"False positive — <specific technical reason>"`
   - Already fixed: `"Already addressed in abc1234."`
4. Never use: "will fix later", "known issue", "if this becomes a problem"

**Diagnosis:**
```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments --jq '.[] | select(.user.login | test("sentry|seer"; "i")) | {id: .id, body: .body[:200]}'
```

---

## 8. Artifact Version Mismatch

**Symptom:** `download-artifact` step fails with `Unable to find any artifacts for the associated workflow`.

**Root cause:** Usually a pre-v4 action (`@v3` or older) on one side — that format is incompatible with v4+. From v4 on, the artifact format is cross-compatible, so the two actions do NOT need to share a major.

**Fix:** Pin both to a Node24-era major (the tree runs `upload-artifact@v7` + `download-artifact@v8`, SHA-pinned). Never pin to a major still on the removed Node20 runtime. See `.claude/rules/gotchas-build-ci.md`.

---

## 9. Gate Job Never Runs / Shows "Expected"

**Symptom:** PR shows "Expected — waiting for status to be reported" on the required gate check, but CI has finished all other jobs.

**Root cause:** GitHub Actions path filters cause jobs to be skipped. The gate job depends on skipped jobs and never gets a signal to run.

**Fix:** A job that must run after skippable dependencies needs `if: always()` AND an explicit `.result` check for every job in its `needs:` — `always()` alone removes the implicit success lock. See lessons-learned #4 and `.claude/rules/gotchas-build-ci.md`.

---

## 10. Duplicate YAML `env:` Keys

**Symptom:** Workflow step silently drops credentials; deploy fails with "authentication required" or 401 at 0s.

**Root cause:** YAML allows duplicate keys but silently drops the first occurrence. Two `env:` blocks on the same step causes the first (often containing secrets) to vanish.

**Fix:** Merge all `env:` vars into a single block per step:
```yaml
- name: Deploy
  env:
    VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}   # ✅ one block
    VERCEL_ORG_ID: ${{ secrets.VERCEL_TEAM_ID }}
```

**Diagnosis:** Search workflow files for duplicate `env:` keys:
```bash
grep -n "^\s*env:" .github/workflows/*.yml | sort
```
