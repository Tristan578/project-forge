# SpawnForge — Claude Code Instructions

## Project Overview

SpawnForge is an AI-native 2D/3D game engine for the browser. Architecture: React shell (Next.js) → Bevy engine (Rust/WASM) → WebGPU/WebGL2 rendering. All engine operations are JSON commands through `handle_command()`.

## Build Commands

### WASM Engine (required for E2E tests and dev server)
```bash
# From project root:
powershell -ExecutionPolicy Bypass -File build_wasm.ps1
```
- Produces 4 variants in `web/public/engine-pkg-*`
- Takes ~5-10 minutes
- Requires: Rust stable, wasm32-unknown-unknown target, wasm-bindgen-cli v0.2.108

### Web Frontend
```bash
cd web && npm install && npm run dev
# → http://spawnforge.localhost:1355 (via Portless)
# Auth bypass: http://spawnforge.localhost:1355/dev
# Fallback (no Portless): http://localhost:3000
```

## Test Commands

### Quick validation (run after every feature change)
```bash
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run
cd packages/ui && npx vitest run
cd apps/docs && npx vitest run
```

### Full suite
```bash
# Lint
cd web && npx eslint --max-warnings 0 .

# TypeScript
cd web && npx tsc --noEmit

# Unit tests (14,200+)
cd web && npx vitest run

# Unit tests with coverage
cd web && npx vitest run --coverage

# UI library tests
cd packages/ui && npx vitest run

# Docs scripts tests
cd apps/docs && npx vitest run

# MCP server tests
cd mcp-server && npx vitest run

# E2E tests (requires WASM build)
cd web && npx playwright test
```

## Environment Setup

```bash
vercel env pull          # Pull env vars to .env.local (Neon, Upstash, Clerk, Stripe, Sentry, PostHog)
cd web && npm run db:push   # Push schema to Neon (dev only)
cd web && npm run db:studio # Visual DB browser
```

Required: `.env.local` with `DATABASE_URL`, `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `UPSTASH_REDIS_REST_URL`. See `web/.env.example` for full list.

### CD Pipeline Secrets (GitHub Repository Settings)

| Secret | Purpose |
|--------|---------|
| `VERCEL_TOKEN` | Vercel API token for all deployments |
| `VERCEL_TEAM_ID` | Vercel team/org ID |
| `VERCEL_PROJECT_ID` | Main web app project ID |
| `VERCEL_STAGING_PROJECT_ID` | Staging web app project ID |
| `VERCEL_DOCS_PROJECT_ID` | Docs app (`apps/docs/`) project ID |
| `VERCEL_DESIGN_PROJECT_ID` | Design workbench (`apps/design/`) project ID |

## MCP Servers (`.mcp.json`)

- **context7** — live library documentation lookup for all 30+ dependencies
- **neon** — direct DB queries during debugging (needs `NEON_API_KEY`)

## Agents (`.claude/agents/`)

| Agent | Purpose |
|-------|---------|
| `builder` | Implementation, coding |
| `validator` | QA gate, full validation suite |
| `planner` | Architecture, spec creation |
| `dx-guardian` | DX audits, cross-IDE consistency |
| `security-reviewer` | Auth, injection, encryption audits |
| `test-writer` | Vitest + RTL tests, coverage gaps |
| `infra-devops` | Deploy, CI/CD, monitoring, services |
| `code-reviewer` | PR review, regression checks |
| `docs-maintainer` | Documentation, README, CLAUDE.md |
| `rust-engine` | Bevy ECS, bridge, WASM, engine/ code |

## Key Architecture Rules

- **Bridge isolation**: Only `engine/src/bridge/` may import web_sys/js_sys/wasm_bindgen. `core/` is pure Rust.
- **Command-driven**: All engine ops go through `handle_command()` JSON commands.
- **Event-driven**: Bevy → bridge → JS callback → Zustand store → React re-render.
- **wasm-bindgen version**: Must be 0.2.108 (pinned to match Cargo.lock).
- **Import boundary exception**: `@spawnforge/ui` is the only allowed external import via `transpilePackages` in `next.config.ts`. All other imports must be within `web/`.

## Test Conventions

- Store slices: Use `sliceTestTemplate.ts` pattern with `createSliceStore()` and `createMockDispatch()`
- Script worker tests: Stub `self` with mock `postMessage`, use `vi.resetModules()` + dynamic import
- Vitest workspace: `web/vitest.workspace.ts` splits tests into two configs:
  - `web/vitest.config.node.ts` (environment: node) — lib, stores, API routes
  - `web/vitest.config.jsdom.ts` (environment: jsdom) — components, hooks
  - `web/vitest.config.ts` — standalone config (jsdom) used when running without workspace
- Playwright config: `web/playwright.config.ts`, 2 workers in CI
- Agent viewport tests: `cd web && npx playwright test --config playwright.agent.config.ts`

## Taskboard

- API: http://taskboard.localhost:1355/api (fallback: http://localhost:3010/api)
- Project ID: 01KK974VMNC16ZAW7MW1NH3T3M
- Always create a ticket before starting work

## Working Principles

- **Reviews are PASS or FAIL** — no "pass with issues." Any issue at any severity blocks.
- **Boy Scout Rule** — fix every bug you find, regardless of whose fault it is. No known issues left behind.
- **Systems, not genres** — games are compositions of systems (movement, input, camera, etc.), not genre categories. See `specs/2026-03-25-game-creation-orchestrator-phase2a-v4.md`.
- **Lessons learned are enforced via hooks** — `inject-lessons-learned.sh` fires on every Edit/Write/Bash, showing relevant anti-patterns before action.

## Gotchas

- **`cd web/` + git diff paths = double prefix** — `git diff --name-only` returns `web/src/...` paths relative to repo root. If a script does `cd web/` then passes those paths to vitest/eslint, the tool sees `web/web/src/...`. Always strip the `web/` prefix with `sed 's|^web/||'` after collecting paths and before invoking tools inside `web/`. Hit 4 times in this codebase (run-affected-tests.sh, coverage-diff.sh, fix-common-ci.sh, boundary-check paths).
- **Subagent hooks don't inherit settings.json** — Only frontmatter hooks fire in subagents. If a hook must run for ALL agents (like inject-lessons-learned.sh), add it to every agent's frontmatter PreToolUse. settings.json hooks only fire in the main session.
- **Verify npm package names with `npm view`** — Before adding any package to `.mcp.json`, `package.json`, or CI configs, verify it exists: `npm view <pkg> version`. Hallucinated package names (e.g. `@anthropic-ai/playwright-mcp` vs real `@playwright/mcp`) cause silent startup failures.
- **vitest --coverage needs `--coverage.reporter=json-summary`** — Without this flag, `coverage-summary.json` is never created and scripts parsing it silently get N/A values. Always specify the reporter format explicitly.
- **Node 25.x segfaults** — intermittent V8 JIT crashes in hooks/scripts. If a hook crashes with a stack trace in `libnode`, it's a Node runtime bug, not code. Investigate and fix (Boy Scout Rule) — don't bypass with `--no-verify`.
- **`vercel build` in CI** — uses `child_process.spawn('npm')` which can't find npm on GHA runners. Use `vercel deploy` (remote build) instead of `vercel build` + `deploy --prebuilt`.
- **Artifact versions** — `upload-artifact` and `download-artifact` MUST use the same major version (`@v4`). Never upgrade one without the other.
- **Reusable workflow permissions** — `quality-gates.yml` must use `permissions: contents: read`. Never `write` — it causes `startup_failure` on every CI run.
- **panelRegistry insertion** — the #1 agent bug (21 instances). Read 10 lines before AND after the insertion point. New panels get nested inside the preceding entry's object literal if the closing `},` is swallowed. Run `npx vitest run src/lib/workspace/__tests__/panelRegistry.test.ts` after editing.
- **Missing `await` on rate limiting** — `rateLimitPublicRoute()` is async. Without `await`, you get a Promise (truthy), silently bypassing rate limits on every request.
- **`||` vs `??` for defaults** — `||` treats `0` as falsy. `Number(undefined)` is `NaN`, not caught by `??`. Use `Number.isFinite()` for parsed numbers.
- **Full vitest in worktrees kills M2** — never run the full suite when only a few files changed. Use `npx vitest run <specific-file>` or `npm run test:changed`.
- **`auth()` crashes without Clerk keys** — Server Components must use `safeAuth()` from `@/lib/auth/safe-auth.ts`, not `auth()` from `@clerk/nextjs/server`. Without `clerkMiddleware()` (CI/E2E), `auth()` throws a fatal error that crashes the dev server and fails all E2E tests.
- **neon-http `db.transaction()` throws** — the neon-http driver does not support Drizzle's `db.transaction()`. Use `getNeonSql()` → `neonSql.transaction([...statements])`. Within the batch, each statement sees prior statements' effects — place INSERT...SELECT BEFORE any UPDATE it reads from, or audit records reflect post-mutation state.
- **vitest workspace drops coverage thresholds** — `--workspace vitest.workspace.ts` ignores per-project thresholds. CI must use the standalone `vitest.config.ts` (which has 70/60/65/72 thresholds). Workspace is for local dev only.
- **usageId in generate route responses** — NEVER remove. Client-side `useGenerationPolling.triggerRefund()` needs it for async job refunds. Fix double-refund via idempotent `refundTokens()` (metadata JSONB check), not by removing usageId.
- **`refundTokens()` idempotency** — Check `metadata->>'refundedUsageId'` before crediting. Without this, server + client both refunding the same failed job doubles credits.
- **`onConflictDoUpdate` field completeness** — List EVERY mutable field in `.set()`. Missing fields silently keep original values. Compare `.values()` fields with `.set()` fields after every upsert.
- **Delete children before insert on upsert** — `db.delete(childTable).where(eq(parentId))` before inserting new children. Otherwise concurrent upserts create duplicates.
- **ZADD member uniqueness** — `Date.now()` collides in same ms. Use `` `${Date.now()}:${Math.random().toString(36).slice(2,8)}` `` for sorted set members.
- **Dockview CSS class** — `.dv-dockview` (NOT `.dv-dockview-container`). Used in E2E fixtures and editor boot tests.
- **Sentry re-reviews every commit** — Reply with commit SHA + evidence, not "already fixed". Sentry doesn't resolve until the code on the PR branch actually changes.
- **SHADOWED_GLOBALS shared module** — `web/src/lib/scripting/sandboxGlobals.ts` is single source of truth. Import in scriptWorker, scriptBundler, and tests. Never duplicate the list.
- **Vercel account scope** — ALWAYS use `--scope tnolan` on Vercel CLI commands. The `nolantj-livecoms-projects` hobby account must NEVER be used for SpawnForge. See `memory/reference_service_accounts.md` for all project IDs.
- **Worktree branch loss** — Nested worktrees (worktree-within-worktree) lose their branches on cleanup. Never nest. Always rebase onto main first. Always push before agent completes.
- **Schema changes need migrations** — Any change to `web/src/lib/db/schema.ts` MUST include a migration file via `npm run db:generate` or be reverted. `db:push` works in dev but production needs `ALTER TABLE`.
- **IV/crypto changes need migration path** — Changing encryption parameters (IV length, algorithm) breaks decryption of existing stored data without a re-encryption migration.
- **`.lighthouserc.js` auto-detected by lhci** — The `startServerCommand` in this file overrides manually-started servers. If Lighthouse CI fails with exit code 127, check this file first. The workflow manages servers directly via `next build && next start`.
- **`next start` requires env vars** — In production mode, the instrumentation hook validates env vars at startup. Set `SKIP_ENV_VALIDATION=true` in CI when running `next start` without the full env.
- **Max 5-7 fixes per builder dispatch** — Agents rushing through 25+ fix lists introduce the same anti-patterns they're fixing. Cap scope, require lint+tsc pass after EACH fix.
- **neon-http tagged template returns `Row[]`** — `neonSql`\`...\`` resolves to an array, NOT an object with `.rowCount`. Use `.length` to check insert/update results. `INSERT...WHERE NOT EXISTS` returns empty array when skipped.
- **`lhci collect` flags differ from Lighthouse CLI** — Use `--outputDir` (not `--output-path`), `--numberOfRuns` (not `--number-of-runs`), `--settings.chromeFlags` (not `--chrome-flags`). Wrong flags are silently ignored, results go to default `.lighthouseci/`.
- **`nodeVersion` is invalid in `vercel.json`** — Vercel rejects it with "should NOT have additional property". Configure Node version in Vercel project settings instead.
- **Cherry-pick + lockfile** — Cherry-picking commits that modify `package.json` without running `npm install` to regenerate `package-lock.json` breaks `npm ci` across ALL CI jobs. Always regenerate the lockfile after cherry-picks that touch dependencies.
- **`experimental.sri` is incompatible with Vercel CDN** — Next.js SRI bakes sha256 hashes into HTML at build time. Vercel's edge layer post-processes chunks (compression, immutable cache headers), changing byte content without updating hashes. Every `_next/static/chunks/*.js` fails browser integrity verification — producing a blank page on any route needing client JS (e.g. `/sign-in`). Do NOT re-enable. CSP `script-src 'self'` + allowlist covers external script injection.
- **Stripe v21 hold-back** — `stripe` is pinned at `^20.4.1`. v21.0.0 has breaking changes: all `decimal_string` fields changed from `string` to `Stripe.Decimal` (affects checkout, invoicing, pricing APIs), dropped Node 16, stricter webhook parsing. Our webhook handler uses integer amounts (`charge.amount_refunded`) so likely unaffected, but audit all Stripe type usage before upgrading. See `/changelog-review` skill for details.
- **Clerk `<SignIn>`/`<SignUp>` must be in `'use client'` files** — Importing these from `@clerk/nextjs` in a Server Component causes SSR 500 in production. The barrel export isn't marked as a client module, triggering server-side evaluation of Clerk internals. Always import via a dedicated `'use client'` wrapper (e.g. `SignInClient.tsx`).
- **Duplicate YAML keys in GitHub Actions workflows are silent** — YAML allows duplicate keys but silently drops the first occurrence. Two `env:` blocks on the same step causes the first (with credentials) to vanish, breaking the deploy with a cryptic "workflow file issue" at 0s. Always merge env vars into a single `env:` block. This broke CD for 21+ hours before detection.
- **`replace_all` double-prefix danger** — `Edit` tool's `replace_all` re-matches already-replaced text. Renaming `X` to `PREFIX_X` when some instances are already `PREFIX_X` produces `PREFIX_PREFIX_X`. Always verify the file after `replace_all`.
- **`sanitizeSystemPrompt` truncates at 10k chars** — Not suitable for scene context (can be 50k+). Use inline regex for control-char stripping without length cap. `MAX_INPUT_CHARS` (600k) is the real size guard.
- **`ToolLoopAgent.stream()` has no `onError`** — Use `result.toUIMessageStreamResponse({ onFinish })` and check `finishReason === 'error'` for mid-stream error detection.
- **Never merge PRs** — Claude creates PRs; user reviews and merges. Run review board locally and iterate until unanimous PASS before pushing.
- **Every PR must have `Closes #NNNN`** — Create a GitHub issue first if none exists. Use `gh api repos/.../issues -X POST` when GraphQL is rate-limited.
- **GraphQL rate limit exhaustion** — The GitHub Project board has 8000+ items. Use `gh issue list` (REST) for sync, not `gh project item-list` (GraphQL).
- **Taskboard `localProjectId` drifts** — When DB is recreated, project IDs change. Verify sync config against `curl http://localhost:3010/api/projects`.
- **`aria-controls` requires target in DOM** — Conditionally rendered panels break `aria-controls`. Use `<div hidden={!show}>` instead of `{show && <div>}`.
- **CTE `FOR UPDATE` required for row locking** — Without `FOR UPDATE` in a CTE SELECT, concurrent requests snapshot the same pre-update value and both pass the WHERE guard. Always use `FOR UPDATE` when a CTE feeds an UPDATE's WHERE clause.
- **neonSql.transaction must include ALL related writes** — Never split a claim and its deduction across separate operations. A crash between them commits the claim but not the deduction, and idempotency prevents retry.
- **E2E CI uses `next start` not `next dev`** — `next dev` cold-compiles on CI (2-3 min), `next start` boots in <5s. Requires `playwright.ci.config.ts` and `SKIP_ENV_VALIDATION=true`. Tests using `/dev` route must be tagged `@dev` and excluded with `--grep-invert`.
