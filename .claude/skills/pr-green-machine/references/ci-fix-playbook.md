# CI Fix Playbook

Step-by-step fixes for every common CI failure type. Look up the failing check name, follow the steps, push again.

---

## How to Read CI Failures

```bash
# List all failing checks on a PR
gh pr checks <PR_NUMBER>

# Get the run ID of a failing workflow
gh run list --branch <branch-name> --limit 5

# See what actually failed in the logs
gh run view <RUN_ID> --log-failed
```

---

## Lint Failures (`eslint`)

**Symptom:** CI check named `lint` or `eslint` fails

**Step 1: Auto-fix what's auto-fixable**
```bash
cd web && npx eslint --fix .
```

**Step 2: Check what's left**
```bash
cd web && npx eslint --max-warnings 0 .
```

**Step 3: Manual fixes for common patterns**

| Error | Fix |
|-------|-----|
| `no-unused-vars: 'foo' is defined but never used` | Remove or prefix with `_foo` |
| `no-unused-vars: '_foo' is defined but never used` | Remove it entirely |
| `react-hooks/exhaustive-deps: React Hook useEffect has missing dependency 'foo'` | Add `foo` to the deps array, or wrap in `useCallback` |
| `@typescript-eslint/no-explicit-any` | Replace `any` with proper type or add `@ts-expect-error` with reason |
| `@next/next/no-img-element` | Replace `<img>` with `<Image>` from `next/image` |
| `jsx-a11y/alt-text` caused by Lucide Image icon | Import as `import { Image as ImageIcon }` |
| `react-hooks/rules-of-hooks` | Hooks must be at top level — move out of conditionals/loops |
| `no-console` | Remove console.log or use proper logging |

**Never do:** `// eslint-disable-file` at the file level. Only `// eslint-disable-next-line rule-name` on specific lines with a comment explaining why.

---

## TypeScript Failures (`tsc`)

**Symptom:** CI check named `typecheck` or `tsc` fails

**Step 1: Run locally**
```bash
cd web && npx tsc --noEmit 2>&1 | head -100
```

**Step 2: Fix by error type**

| Error pattern | Fix |
|---------------|-----|
| `Type 'string' is not assignable to type 'number'` | Fix the type at the source or add explicit conversion |
| `Object is possibly 'undefined'` | Add null check: `if (obj)` or `obj?.property` |
| `Property 'foo' does not exist on type 'Bar'` | Check property name, add to interface, or use optional chaining |
| `Parameter 'e' implicitly has an 'any' type` | Add explicit type: `(e: React.ChangeEvent<HTMLInputElement>)` |
| `Module '"../foo"' has no exported member 'Bar'` | Fix import path or add the export |
| `Argument of type 'X | undefined' is not assignable to parameter of type 'X'` | Add null check before the call |

**Never do:** `// @ts-ignore` — use `// @ts-expect-error` with a comment explaining the actual issue.

---

## Vitest Unit Test Failures

**Symptom:** CI check named `test`, `vitest`, or `unit-tests` fails

**Step 1: Run the specific failing test locally**
```bash
cd web && npx vitest run --reporter=verbose <test-file-path>
```

**Step 2: Get error detail**
```bash
# Run with verbose output
cd web && npx vitest run --reporter=verbose 2>&1 | grep -A 20 "FAIL\|Error:"
```

**Common patterns and fixes:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Cannot find module '@/lib/foo'` | Missing mock or wrong path | Check `vi.mock('@/lib/foo', ...)` uses `@/` alias |
| `TypeError: X is not a function` | Mocked function not set up | Verify `vi.fn()` setup in test or `vi.mock()` |
| `Expected X received Y` after refactor | Test checking old behavior | Update test assertion to match new behavior (or revert the code if the test was correct) |
| Test timeout | Async code not resolved | Add `await` or increase timeout |
| `localStorage is not defined` | Missing jsdom setup | Check `vitest.config.jsdom.ts` is used for component tests |
| Flaky test passes locally, fails CI | Race condition | Add `await waitFor(() => ...)` pattern |

**Never do:** Mark tests `it.skip(...)` to make CI pass. Fix the test or the code.

---

## E2E Test Failures (Playwright)

**Symptom:** CI check named `e2e` or `playwright` fails

**Step 1: Check the screenshot/video artifacts**
```bash
# Download artifacts from the failed CI run
gh run download <RUN_ID>
```

**Step 2: Run locally (requires WASM build + dev server)**
```bash
# Start dev server
cd web && npm run dev &

# Run the specific failing test
cd web && npx playwright test <test-file> --reporter=html
```

**Common patterns:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| Selector not found | CSS class changed or element not rendered | Update selector to use `data-testid` instead of class |
| Timeout waiting for element | Page not loading or hydration slow | Add `await page.waitForLoadState('networkidle')` |
| `auth()` crash in Server Component | Clerk not configured in CI | Use `safeAuth()` from `@/lib/auth/safe-auth.ts` |
| WASM binary not found | Engine not built | Run `powershell -ExecutionPolicy Bypass -File build_wasm.ps1` |
| "next start requires env vars" | Missing `SKIP_ENV_VALIDATION` | Add to CI env: `SKIP_ENV_VALIDATION=true` |

---

## MCP Manifest Sync Failures

**Symptom:** CI check for manifest sync fails

```bash
# Check what's different
diff mcp-server/manifest/commands.json web/src/data/commands.json
```

**Fix:**
```bash
# Copy the source to the web copy (mcp-server is the source of truth)
cp mcp-server/manifest/commands.json web/src/data/commands.json
```

Then verify:
```bash
bash .claude/tools/validate-mcp.sh sync
```

---

## Lockfile Drift

**Symptom:** CI fails with `npm ci` error about lockfile

```bash
# Regenerate the lockfile
cd web && npm install
git add package-lock.json
git commit -m "fix: regenerate lockfile"
```

**WARNING:** If this happened after cherry-picking commits that added packages, those commits modified `package.json` without updating `package-lock.json`. Always run `npm install` after cherry-picks that touch dependencies.

---

## Workflow File Errors (0-second failures)

**Symptom:** GitHub Actions run completes in 0 seconds with "failure"

**This is always a YAML parse error in the workflow file.**

```bash
# Find the 0s failure
gh run list --workflow=cd.yml --branch main --limit 3

# View the error
gh run view <ID> --log-failed
```

**Common causes:**
- Duplicate `env:` blocks on the same step (first one gets silently dropped)
- Duplicate YAML keys at any level
- Indentation error
- Missing `on:` trigger

**Fix:** Look at the workflow file for the offending job/step. Merge duplicate keys into one block.

---

## Archive of Common CI Patterns (from project_lessons_learned.md)

| Pattern | PR that introduced it | Fix |
|---------|----------------------|-----|
| Duplicate `env:` YAML key | #6732 | Merge into single block |
| `npm` not found in CI for vercel build | — | Use `vercel deploy` (remote build), not `vercel build --prebuilt` |
| Artifact version mismatch (`@v3` vs `@v4`) | — | Both upload-artifact and download-artifact must use same major version |
| `reusable-workflow` with `write` permissions | — | Must be `read: contents` |
| `auth()` crash without Clerk | — | Use `safeAuth()` in Server Components |
| vitest coverage hangs in CI | — | Use `--pool=threads --coverage` + `timeout 600` wrapper |
