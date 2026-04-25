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
- **Always use `queryWithResilience()`** — Only call `getDb()` inside the `queryWithResilience()` callback, never assign it to a standalone variable. Example: `queryWithResilience(() => getDb().select()...)`. ESLint `no-restricted-syntax` flags the `const db = getDb()` assignment pattern across `src/**`.
- **`onConflictDoUpdate` field completeness** — List EVERY mutable field in `.set()`. Missing fields keep original values.
- **Delete children before insert on upsert** — `db.delete(childTable).where(eq(parentId))` before inserting.
- **ZADD member uniqueness** — `Date.now()` collides in same ms. Use `` `${Date.now()}:${Math.random().toString(36).slice(2,8)}` ``.
- **CTE `FOR UPDATE` required for row locking** — Without it, concurrent requests snapshot the same pre-update value.
- **neonSql.transaction must include ALL related writes** — Never split claim and deduction across separate operations.
- **neon-http tagged template returns `Row[]`** — Use `.length` to check results, not `.rowCount`.
- **Circuit breaker trips at 5 consecutive transient failures** — Stays open for 30s, then half-open (1 probe). Non-transient errors (auth, syntax) don't count. Opening fires a Sentry alert (#8244); half-open/closed transitions are silent.

## API & Security
- **usageId in generate route responses** — NEVER remove. Client needs it for async job refunds.
- **`refundTokens()` idempotency** — Check `metadata->>'refundedUsageId'` before crediting.
- **`sanitizePrompt().filtered` without `.safe` check** — Always check `.safe` first.
- **Never spread LLM objects into engine commands** — Allowlist fields with `Number.isFinite()` guards.
- **`VERCEL_ENV` includes `'development'`** — Use explicit `=== 'production' || === 'preview'`.
- **`sanitizeSystemPrompt` truncates at 10k chars** — Use inline regex for scene context (can be 50k+).
- **`ToolLoopAgent.stream()` has no `onError`** — Use `result.toUIMessageStreamResponse({ onFinish })`.
- **Dynamic route `[name]` params need validation** — If POST validates name characters, PATCH/DELETE on `[name]` must validate too. Malformed percent-encoding (`%E0%A4%A`) passes Next.js decoding but should return 400 before DB queries.
- **`InstructionBlock[]` cache controls only fire on direct backend** — `createSpawnforgeAgent({ instructions: InstructionBlock[] })` joins blocks into a flat string when `isDirectBackend` is false. Adding `tier: 'long'` does nothing on the gateway/OpenRouter path. Per-user content (e.g. scene context) must include a per-user nonce inside the block text — Anthropic's prompt cache is keyed at the org level, so two users on the same Anthropic key share a cache namespace.

## WASM / CDN
- **WASM CDN same-origin fallback** — JS glue (`forge_engine.js`) and WASM binary (`forge_engine_bg.wasm`) are a coupled pair. Both MUST load from the same origin. Cannot load JS from CDN and WASM from same-origin. `getWasmBasePaths()` handles this.
- **`fetchWithRetry` 4xx handling** — The throw on 4xx is inside the try-catch loop. Must rethrow permanent errors explicitly or they get caught and retried as transient failures.
- **Same-origin WASM in production** — Requires CD pipeline to copy WASM artifacts to `web/public/` before `next build`. Already done in `cd.yml` lines 400-409.

## UI & Frontend
- **Dockview CSS class** — `.dv-dockview` (NOT `.dv-dockview-container`).
- **`aria-controls` requires target in DOM** — Use `<div hidden={!show}>` instead of conditional rendering.
- **SHADOWED_GLOBALS shared module** — `sandboxGlobals.ts` is single source of truth. Import, never duplicate.
- **Clerk `<SignIn>`/`<SignUp>` must be in `'use client'` files** — Server Component barrel export triggers SSR 500.
- **R2 engine CDN requires manual upload** — WASM files gitignored, use `wrangler r2 object put`.

## Claude Code Config
- **`.claude/prompts/` ≠ `.claude/skills/`** — Prompts are template files only accessible from the prompt bar UI. Skills (in `.claude/skills/<name>/SKILL.md`) are invocable via `/name` from the CLI and via the `Skill` tool. If it should be callable as `/foo`, it MUST be a skill, not a prompt. Never create automation in `.claude/prompts/`.
- **Hook input: two patterns, not interchangeable** — Edit/Write hooks get `TOOL_INPUT_<field>` env vars (e.g. `TOOL_INPUT_file_path`). Bash hooks get stdin JSON parsed with `jq -r '.tool_input.command'`. Using the wrong pattern = silent no-op. For Bash hooks, source `.claude/hooks/hook-utils.sh` and call `get_bash_command()`. See `check-pr-metadata.sh` for the canonical Bash hook pattern.

## Infrastructure
- **WASM CDN fallback — same-origin requires JS glue + WASM from same origin** — `useEngine.ts` tries CDN first, falls back to `/engine-pkg-*/`. Both JS glue and WASM binary must come from the same origin (CDN or same-origin) due to wasm-bindgen import path coupling. To force same-origin: unset `NEXT_PUBLIC_ENGINE_CDN_URL`. AbortError from navigation is suppressed in the `useEngine` `.catch` handler (not inside `loadWasm` itself) so it doesn't surface as a user-visible error.
- **Vercel account scope** — ALWAYS use `--scope tnolan`. Never `nolantj-livecoms-projects`.
- **Worktree branch loss** — Nested worktrees lose branches. Never nest. Always rebase onto main first.
- **Schema changes need migrations** — `db:push` works in dev but production needs `ALTER TABLE`.
- **IV/crypto changes need migration path** — Changing parameters breaks existing stored data.
- **`experimental.sri` is incompatible with Vercel CDN** — Do NOT re-enable.
- **Stripe v22 API version** — Upgraded to `22.0.1`, API version `2026-03-25.dahlia`. No `decimal_string` fields used — all amounts are integer cents.
- **Max 5-7 fixes per builder dispatch** — Agents rushing through 25+ lists introduce anti-patterns.
- **GraphQL rate limit exhaustion** — Use `gh issue list` (REST) for sync, not `gh project item-list` (GraphQL).
- **Taskboard `localProjectId` drifts** — Verify sync config against `curl http://localhost:3010/api/projects`.

## Enforcement Hooks
- **`block-deferred-fixes.sh` fails closed** — If body extraction fails, the hook BLOCKS (exit 2), not allows (exit 0). Previous behavior silently let unparseable replies through.
- **Subagent hook inheritance gap** — `.claude/settings.json` PreToolUse hooks do NOT fire for subagents. The `block-deferred-fixes.sh` hook only catches the main agent. Subagents must self-enforce via the banned-phrase list embedded in `/resolve-pr-comments` SKILL.md.
- **Bare SHA is not enough** — A reply must contain BOTH a commit SHA AND an action verb ("Fixed in", "Addressed in"). A reply like "Good catch abc1234" is blocked — it has a SHA but no action verb, so it's likely deferred-fix language with an unrelated hex string.
- **`#NNNN` ticket reference is acceptable** — A deferred reply with a real GitHub issue number (#8307) is allowed. The rule is "fix it or track it", not "fix it or die".
- **60+ deferred-fix phrases** — The hook checks for phrases like "known limitation", "out of scope", "low-priority", "acceptable tradeoff", "future refactor" in addition to the obvious "will fix later" family. Full list in `.claude/hooks/block-deferred-fixes.sh`.
