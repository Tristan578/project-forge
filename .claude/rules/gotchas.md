# Extended Gotchas Reference

These are lower-frequency gotchas moved from CLAUDE.md. The most common ones remain in CLAUDE.md; these apply in specific contexts.

## Build & CI
- **Verify npm package names with `npm view`** — Hallucinated package names cause silent startup failures.
- **vitest --coverage needs `--coverage.reporter=json-summary`** — Without it, `coverage-summary.json` is never created.
- **Node 25.x segfaults** — intermittent V8 JIT crashes in hooks. Investigate, don't bypass with `--no-verify`.
- **`vercel build` in CI** — can't find npm. Use `vercel deploy` (remote build) instead.
- **Artifact versions** — `upload-artifact` and `download-artifact` MUST use same major version (`@v4`).
- **Reusable workflow permissions** — `quality-gates.yml` must use `permissions: contents: read`. Never `write`.
- **Full vitest in worktrees kills M2** — use `npx vitest run <specific-file>` or `npm run test:changed`.
- **Cherry-pick + lockfile** — Always regenerate `package-lock.json` after cherry-picks that touch dependencies.
- **`nodeVersion` is invalid in `vercel.json`** — Configure Node version in Vercel project settings instead.
- **`lhci collect` flags differ from Lighthouse CLI** — Use `--outputDir`, `--numberOfRuns`, `--settings.chromeFlags`.
- **`.lighthouserc.js` auto-detected by lhci** — `startServerCommand` overrides manually-started servers.
- **`next start` requires env vars** — Set `SKIP_ENV_VALIDATION=true` in CI for production mode without full env.
- **Duplicate YAML keys in GitHub Actions are silent** — Two `env:` blocks: first vanishes. Always merge into single block.
- **E2E CI uses `next start` not `next dev`** — `next dev` cold-compiles 2-3 min. Requires `playwright.ci.config.ts`.
- **Sentry/Copilot re-review on every push** — Fix ALL issues in ONE commit, run `security-reviewer` BEFORE pushing.
- **Vitest 4.x jest-dom matcher registration** — Use explicit `expect.extend(matchers)` in vitest.setup.ts.
- **Storybook build target is `es2022`** — `apps/design/vite.config.ts` sets `build.target: 'es2022'`. Do NOT use `esnext` (not a real target) or legacy targets like `safari14` (esbuild 0.28 can't transform destructuring for it). No legacy browser support for internal tooling.
- **`secrets` context forbidden in workflow_call step `if:`** — Use an env var in a prior step and check step outputs instead. GitHub Actions only allows `env`, `github`, `inputs`, `steps` etc. in step conditions inside reusable workflows.

## Database
- **`onConflictDoUpdate` field completeness** — List EVERY mutable field in `.set()`. Missing fields keep original values.
- **Delete children before insert on upsert** — `db.delete(childTable).where(eq(parentId))` before inserting.
- **ZADD member uniqueness** — `Date.now()` collides in same ms. Use `` `${Date.now()}:${Math.random().toString(36).slice(2,8)}` ``.
- **CTE `FOR UPDATE` required for row locking** — Without it, concurrent requests snapshot the same pre-update value.
- **neonSql.transaction must include ALL related writes** — Never split claim and deduction across separate operations.
- **neon-http tagged template returns `Row[]`** — Use `.length` to check results, not `.rowCount`.

## API & Security
- **usageId in generate route responses** — NEVER remove. Client needs it for async job refunds.
- **`refundTokens()` idempotency** — Check `metadata->>'refundedUsageId'` before crediting.
- **`sanitizePrompt().filtered` without `.safe` check** — Always check `.safe` first.
- **Never spread LLM objects into engine commands** — Allowlist fields with `Number.isFinite()` guards.
- **`VERCEL_ENV` includes `'development'`** — Use explicit `=== 'production' || === 'preview'`.
- **`sanitizeSystemPrompt` truncates at 10k chars** — Use inline regex for scene context (can be 50k+).
- **`ToolLoopAgent.stream()` has no `onError`** — Use `result.toUIMessageStreamResponse({ onFinish })`.
- **Dynamic route `[name]` params need validation** — If POST validates name characters, PATCH/DELETE on `[name]` must validate too. Malformed percent-encoding (`%E0%A4%A`) passes Next.js decoding but should return 400 before DB queries.

## UI & Frontend
- **Dockview CSS class** — `.dv-dockview` (NOT `.dv-dockview-container`).
- **`aria-controls` requires target in DOM** — Use `<div hidden={!show}>` instead of conditional rendering.
- **SHADOWED_GLOBALS shared module** — `sandboxGlobals.ts` is single source of truth. Import, never duplicate.
- **Clerk `<SignIn>`/`<SignUp>` must be in `'use client'` files** — Server Component barrel export triggers SSR 500.
- **R2 engine CDN requires manual upload** — WASM files gitignored, use `wrangler r2 object put`.

## Claude Code Config
- **`.claude/prompts/` ≠ `.claude/skills/`** — Prompts are template files only accessible from the prompt bar UI. Skills (in `.claude/skills/<name>/skill.md`) are invocable via `/name` from the CLI and via the `Skill` tool. If it should be callable as `/foo`, it MUST be a skill, not a prompt. Never create automation in `.claude/prompts/`.

## Infrastructure
- **Vercel account scope** — ALWAYS use `--scope tnolan`. Never `nolantj-livecoms-projects`.
- **Worktree branch loss** — Nested worktrees lose branches. Never nest. Always rebase onto main first.
- **Schema changes need migrations** — `db:push` works in dev but production needs `ALTER TABLE`.
- **IV/crypto changes need migration path** — Changing parameters breaks existing stored data.
- **`experimental.sri` is incompatible with Vercel CDN** — Do NOT re-enable.
- **Stripe v21 hold-back** — Pinned at `^20.4.1`. Breaking changes to `decimal_string` fields.
- **Max 5-7 fixes per builder dispatch** — Agents rushing through 25+ lists introduce anti-patterns.
- **GraphQL rate limit exhaustion** — Use `gh issue list` (REST) for sync, not `gh project item-list` (GraphQL).
- **Taskboard `localProjectId` drifts** — Verify sync config against `curl http://localhost:3010/api/projects`.
