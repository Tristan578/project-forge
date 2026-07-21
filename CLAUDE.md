# SpawnForge — Claude Code Instructions

<!-- Compact: When summarizing context, preserve: gotchas, architecture rules, build commands. Drop: phase roadmap details, library versions, file maps. -->

## Project Overview

SpawnForge is an AI-native 2D/3D game engine for the browser. Architecture: React shell (Next.js) -> Bevy engine (Rust/WASM) -> WebGPU/WebGL2 rendering. All engine operations are JSON commands through `handle_command()`.

## Build Commands

```bash
# WASM Engine (required for E2E)
powershell -ExecutionPolicy Bypass -File build_wasm.ps1

# Web Frontend
cd web && npm install && npm run dev
# -> http://spawnforge.localhost:1355 (Portless) | http://spawnforge.localhost:1355/dev (auth bypass)
```

## Test Commands

```bash
# Quick validation (after every change)
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run

# Other suites
cd packages/ui && npx vitest run       # UI library
cd apps/docs && npx vitest run         # Docs scripts
cd mcp-server && npx vitest run        # MCP server
cd web && npx playwright test          # E2E (needs WASM)
```

## Environment Setup

```bash
vercel env pull                        # Pull env vars to .env.local
cd web && npm run db:push              # Push schema to Neon (dev only)
```

Required: `.env.local` with `DATABASE_URL`, `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `UPSTASH_REDIS_REST_URL`.

Optional feature flags (all default off):
- `NEXT_PUBLIC_USE_DEEP_GENERATION=true` — route GDD, world builder, and cutscene generators to Opus 4.8 (`AI_MODEL_DEEP`) instead of Sonnet 4.6. See `docs/decisions/2026-05-01-opus-deep-tier.md`. Any value other than the exact string `"true"` leaves the flag off.
- `QSTASH_TOKEN` + `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY` — Upstash QStash credentials for durable server-side generation callbacks (PF-906). Set all three in Vercel (Production + Preview), plus `NEXT_PUBLIC_APP_URL` to your public origin, to enable. Leave any unset and the feature is fully dormant — the client-side poller remains the only completion path. Runbook: `docs/guides/qstash-setup.md`.
- `POSTHOG_PERSONAL_API_KEY` + `NEXT_PUBLIC_POSTHOG_KEY` — enables the local PostHog flag evaluator (`web/src/lib/flags/posthogFlags.ts`, PF-971 / #8952): a `deep-generation-tier` flag that overrides `NEXT_PUBLIC_USE_DEEP_GENERATION` (see the addendum in `docs/decisions/2026-05-01-opus-deep-tier.md`), and per-provider kill switches named `provider-kill-switch-<provider>` (e.g. `provider-kill-switch-elevenlabs`) that `createGenerationHandler` checks before token deduction. Both vars must be set to activate; omitting either (or both) keeps the evaluator dormant — `getBooleanFlag()` returns the caller's default with zero network I/O. Only a safe subset of PostHog targeting is evaluated locally (full rollout, 0% rollout, or a single `tier` exact-match filter); anything else falls back to the default with a one-time warn log.

Always-on protections & observability (not env-gated):
- **Vercel BotID (PF-975 / #8948)** — bot detection gates every `/api/generate/*` route (via `createGenerationHandler`) and `/api/billing/checkout`, returning `403` with `code: 'BOT_CHECK'` when a request is classified as a bot. Check level is pinned to `'basic'` in code (enabling Deep Analysis is a separate Vercel Dashboard step that deliberately does NOT change this gate). FAILS OPEN on any `checkBotId()` error so bot detection never becomes a new SPOF. Server gate: `web/src/lib/security/botId.ts`; client-side route registration: `web/src/lib/security/botIdClient.ts`.
- **Sentry user feedback + structured logs (PF-967 / #8956)** — a floating "Report a Bug" widget is registered in `web/instrumentation-client.ts` (`feedbackIntegration`; `enableScreenshot: false` is a security pin — feedback screenshots have no masking pipeline, unlike replays, and could capture plaintext secrets such as a freshly-generated MCP key). Server-side lifecycle logging goes through `sentryLogger` in `web/src/lib/monitoring/sentry-server.ts` (used by `createGenerationHandler`). Config pins are enforced by `web/src/lib/__tests__/sentry-regressions.test.ts`.

## Key Architecture Rules

- **Bridge isolation**: Only `engine/src/bridge/` may import web_sys/js_sys/wasm_bindgen. `core/` is pure Rust.
- **Command-driven**: All engine ops go through `handle_command()` JSON commands.
- **Event-driven**: Bevy -> bridge -> JS callback -> Zustand store -> React re-render.
- **wasm-bindgen**: Must be 0.2.108 (pinned to Cargo.lock).
- **Import boundary**: `@spawnforge/ui` is the only allowed external import via `transpilePackages`.

## Test Conventions

- Vitest workspace splits: `vitest.config.node.ts` (node) and `vitest.config.jsdom.ts` (jsdom)
- Store slices: `sliceTestTemplate.ts` pattern with `createSliceStore()` and `createMockDispatch()`
- Script workers: Stub `self` with mock `postMessage`, use `vi.resetModules()` + dynamic import

## Taskboard

All work tracked via taskboard. Use `/kanban` skill for full protocol.

## Working Principles

- **PASS or FAIL** — no "pass with issues." Any issue blocks.
- **Boy Scout Rule** — fix every bug you find, regardless of whose fault.
- **Systems, not genres** — games are compositions of systems, not genre categories.
- **Lessons learned enforced via hooks** — `inject-lessons-learned.sh` fires on every Edit/Write/Bash.

## Gotchas (High-Frequency)

- **`createGenerationHandler` is a single point of failure** — all 12 generate routes use this factory. A bug breaks every `/api/generate/*` route. Always run integration tests after changes.
- **`cd web/` + git diff = double prefix** — `git diff --name-only` returns `web/src/...`. Strip `web/` with `sed 's|^web/||'` before invoking tools inside `web/`.
- **Subagent hooks don't inherit settings.json** — Add critical hooks to every agent's frontmatter PreToolUse.
- **panelRegistry insertion** — #1 agent bug (21 instances). Read 10 lines before AND after insertion point. Run `npx vitest run src/lib/workspace/__tests__/panelRegistry.test.ts` after editing.
- **Missing `await` on rate limiting** — `rateLimitPublicRoute()` is async. Without `await`, rate limits silently bypassed.
- **`||` vs `??` for defaults** — `||` treats `0` as falsy. `Number(undefined)` is `NaN`. Use `Number.isFinite()`.
- **`auth()` crashes without Clerk keys** — Use `safeAuth()` from `@/lib/auth/safe-auth.ts`, not `auth()` from `@clerk/nextjs/server`.
- **neon-http `db.transaction()` throws** — Use `getNeonSql()` -> `neonSql.transaction([...statements])`. INSERT...SELECT before UPDATE.
- **vitest workspace drops coverage thresholds** — CI must use standalone `vitest.config.ts` (auto-ratcheted upward by the coverage-ratchet workflow, which also keeps `vitest.config.node.ts` in lockstep — read the config for live values, never trust a doc snapshot).
- **Never merge PRs** — Claude creates PRs; user reviews and merges. Run review board first.
- **Every PR must have `Closes #NNNN` AND `--milestone`** — GitHub issue number (not PF-XXX), plus a milestone (P0/P1/P2/P3). Hook enforces both on `gh pr create`. Run sync-push first.
- **Every PR needs a changeset** — Run `npx changeset` (from repo root) or create `.changeset/<name>.md`. Use `skip changeset` label for docs/CI-only PRs.
- **Sentry re-reviews every commit** — Reply with commit SHA + evidence, not "already fixed".
- **`replace_all` double-prefix danger** — Renaming `X` to `PREFIX_X` when some are already `PREFIX_X` produces `PREFIX_PREFIX_X`.
- **Route `[name]` param validation** — Next.js decodes route params, but names containing `/%\` or control chars must be rejected early (before DB access) to match POST validation. Tests will pass locally with mocks but fail in production without it.
- **Replicate API `model` vs `version`** — `version: 'owner/name:sha'` is deprecated. Use `model: 'owner/name'` field. Constant: `REPLICATE_MODEL_SDXL` in `models.ts`.
- **Single-root lockfile: bump a `web/package.json` dep → regenerate the ROOT `package-lock.json` or `npm ci` breaks on main.** Only one lockfile exists (repo root). Dependabot's npm updater (`directory: /web`) edits manifests it can't relock → `EUSAGE` drift (broke main twice: #8655, #8658). The `Lockfile Sync` gate catches it pre-merge; fix with `npm install --package-lock-only` from the root. After merging ANY dependency PR, verify `npm ci` against `origin/main`. See `.claude/rules/gotchas.md` → Build & CI.
- **gh-aw: edit a `.github/workflows/*.md` (or a `.github/aw/` action pin) → recompile its `*.lock.yml` or the workflow GitHub runs silently diverges from its source.** The `.lock.yml` is the generated artifact GitHub actually executes (`gh aw compile` injects SHA-pinned actions into it); editing the `.md` without recompiling is the gh-aw analogue of package-lock drift. The `gh-aw Lock Sync` gate (`scripts/check-ghaw-lock-sync.sh`) recompiles from committed sources/pins and fails the PR on any diff. Fix: from the repo root, FIRST pin your local compiler to the gate's version (`ver="$(bash scripts/get-ghaw-compiler-version.sh)"; gh extension remove gh-aw 2>/dev/null || true; gh extension install github/gh-aw --pin "$ver"` — a differently-versioned local gh-aw recompiles to different bytes and fails the gate with an opaque diff; the remove-then-install keeps the pin idempotent, since `gh extension install` errors if it's already present), THEN `gh aw compile --no-check-update --purge` and commit the updated `.github/workflows/*.lock.yml`. See `.claude/rules/gotchas.md` → Build & CI (full idempotent recipe + the compiler-bump caveat there).
- **OpenAPI: a malformed `docs/api/openapi.json` 500s the entire `/api-docs` reference, and a new undocumented `route.ts` rots the published contract.** The spec is `JSON.parse`'d and served by `web/src/app/api/openapi/route.ts`; one trailing comma throws (not ENOENT) → the route 500s in prod (shipped live once). The spec is hand-maintained with no generator, so new routes ship undocumented. The `openapi-route-sync` gate (`scripts/check-openapi-route-sync.sh`) `jq`-validates the spec AND asserts every route is documented or in `docs/api/openapi-internal-routes.json` (a ratchet — only NEW drift fails). Fix: add the path to the spec, or to the allowlist with a category; repair the JSON for a malformed spec. See `.claude/rules/gotchas.md` → Build & CI.

See `.claude/rules/gotchas.md` for 40+ additional context-specific gotchas.
