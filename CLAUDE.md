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
- `NEXT_PUBLIC_USE_DEEP_GENERATION=true` — route GDD, world builder, and cutscene generators to Opus 5 (`AI_MODEL_DEEP`) instead of Sonnet 5 (`AI_MODEL_PRIMARY`). See `docs/decisions/2026-05-01-opus-deep-tier.md` (including the 2026-09-02 Claude 5 addendum). Any value other than the exact string `"true"` leaves the flag off.
- `QSTASH_TOKEN` + `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY` — Upstash QStash credentials for durable server-side generation callbacks (PF-906). Set all three in Vercel (Production + Preview), plus `NEXT_PUBLIC_APP_URL` to your public origin, to enable. Leave any unset and the feature is fully dormant — the client-side poller remains the only completion path. Runbook: `docs/guides/qstash-setup.md`.
- `POSTHOG_PERSONAL_API_KEY` + `NEXT_PUBLIC_POSTHOG_KEY` — enables the local PostHog flag evaluator (`web/src/lib/flags/posthogFlags.ts`, PF-971 / #8952): a `deep-generation-tier` flag that overrides `NEXT_PUBLIC_USE_DEEP_GENERATION` (see the addendum in `docs/decisions/2026-05-01-opus-deep-tier.md`), and per-provider kill switches named `provider-kill-switch-<provider>` (e.g. `provider-kill-switch-elevenlabs`) that `createGenerationHandler` checks before token deduction. Both vars must be set to activate; omitting either (or both) keeps the evaluator dormant — `getBooleanFlag()` returns the caller's default with zero network I/O. Only a safe subset of PostHog targeting is evaluated locally (full rollout, 0% rollout, or a single `tier` exact-match filter); anything else falls back to the default with a one-time warn log.
- `BILLING_METERS_ENABLED=true` — reports confirmed generation token usage to the Stripe `generation_tokens` billing meter for revenue reconciliation (PF-977/PF-978, #8969/#8970). Requires the meter to exist in Stripe first — run `web/scripts/provision-billing-meter.ts` once per mode (test, then live) before flipping this on in that mode. Any value other than the exact string `"true"` leaves reporting fully dormant — `web/src/lib/billing/meterEvents.ts`'s `isBillingMetersEnabled()` returns `false` and `reportGenerationUsage()` no-ops immediately. Runbook: `docs/guides/billing-meters-setup.md`.
- `NEXT_PUBLIC_MCP_BRIDGE=true` — lets a **production** build attach the editor tab to the local MCP relay (#9293). Outside production the bridge is available without the flag; in either case it is inert until the tab is opened with `?mcp=<token>` AND the person approves the in-tab consent prompt. Any value other than the exact string `"true"` leaves it off in production. The gate is `mcpBridgeEnabled()` in `web/src/lib/mcp/bridgeOptIn.ts`, and it must read `process.env.NEXT_PUBLIC_MCP_BRIDGE` as a **literal member expression** — Next.js only substitutes fully-qualified `process.env.NEXT_PUBLIC_*`, so an aliased or injected `env` object reads `{}` in the browser and the gate fails OPEN. A test pins the source shape because no runtime test can see this.
- `NEXT_PUBLIC_MCP_RELAY_URL` — overrides the relay the editor dials (default `ws://127.0.0.1:3001/api/mcp/ws`). Same literal-member-expression rule.
- `MCP_RELAY_TOKEN` (≥32 chars, required), `MCP_RELAY_PORT`, `MCP_RELAY_EDITOR_ORIGINS` — server-side, read by `npm run relay` in `mcp-server/`. Never set in Vercel: the relay is loopback-only. Setup: `docs/guides/mcp-server-setup.md`.
- `CRON_SECRET` — activates the synthetic health monitor. `isAuthorizedCron()` in `web/src/app/api/cron/health-monitor/route.ts` fails **closed**: with the variable unset every scheduled invocation is answered `401`, which is the state production has been in since the route shipped (#9118). Setting it is an owner-only action with an evidence checklist. Runbook: `docs/guides/health-monitor-cron.md`.

Always-on protections & observability (not env-gated):
- **Vercel BotID (PF-975 / #8948)** — bot detection gates every `/api/generate/*` route (via `createGenerationHandler`) and `/api/billing/checkout`, returning `403` with `code: 'BOT_CHECK'` when a request is classified as a bot. Check level is pinned to `'basic'` in code (enabling Deep Analysis is a separate Vercel Dashboard step that deliberately does NOT change this gate). FAILS OPEN on any `checkBotId()` error so bot detection never becomes a new SPOF. Server gate: `web/src/lib/security/botId.ts`; client-side route registration: `web/src/lib/security/botIdClient.ts`.
- **Sentry user feedback + structured logs (PF-967 / #8956)** — a floating "Report a Bug" widget is registered in `web/instrumentation-client.ts` (`feedbackIntegration`; `enableScreenshot: false` is a security pin — feedback screenshots have no masking pipeline, unlike replays, and could capture plaintext secrets such as a freshly-generated MCP key). Server-side lifecycle logging goes through `sentryLogger` in `web/src/lib/monitoring/sentry-server.ts` (used by `createGenerationHandler`). Config pins are enforced by `web/src/lib/__tests__/sentry-regressions.test.ts`.
- **Sentry profiling + generation business metrics (PF-1053 / #9085)** — continuous CPU profiling runs in the Node (`nodeProfilingIntegration`) and browser (`browserProfilingIntegration` + a `Document-Policy: js-profiling` header) runtimes, never Edge (native `.node` addon). Every prerequisite fails SILENTLY, so all four are pinned by `sentry-regressions.test.ts`: matched `@sentry/nextjs`/`@sentry/profiling-node` versions, `serverExternalPackages`, the header, and a non-zero `profileSessionSampleRate` (it defaults to `0`). Separately, `createGenerationHandler` emits `generation.request` / `generation.duration` / `generation.tokens_charged` via `web/src/lib/monitoring/generationMetrics.ts` — business facets only (runtime health is already covered by `nodeRuntimeMetricsIntegration`), fail-open, response returned by identity. `tokens_charged` is set ONLY where `resolveApiKey` returns a `usageId`, so cache hits and BYOK never inflate it. **Metrics are a THIRD PII pipeline** — `enableMetrics` defaults to `true` and the SDK stamps scope user fields onto every metric before `beforeSendMetric`, so `scrubSentryMetric` must stay wired in all three configs. Outcome values must dodge Sentry's server-side scrubber — see `.claude/rules/gotchas-web.md` → API & Security.

## Key Architecture Rules

- **Bridge isolation**: Only `engine/src/bridge/` may import web_sys/js_sys/wasm_bindgen. `core/` is pure Rust.
- **Command-driven**: All engine ops go through `handle_command()` JSON commands.
- **Event-driven**: Bevy -> bridge -> JS callback -> Zustand store -> React re-render.
- **wasm-bindgen**: Must be 0.2.127 (pinned to Cargo.lock).
- **Import boundary**: `@spawnforge/ui` is the only allowed external import via `transpilePackages`.

## SEC-2 — Script Sandbox Hardening

`web/src/lib/scripting/scriptWorker.ts` compiles user-authored game scripts with
`Function(...)`. CodeQL reports this as `js/code-injection` and **the report is
correct** — do not annotate it as a false positive.

**Trust model.** Script source is untrusted. It is not only self-authored:
`ScriptData.source` is serialized into the exported scene JSON
(`engine/src/bridge/scene_io.rs:150` → `build_scene_file`) and therefore into
`projects.sceneData`, which `/api/play/[userId]/[slug]/remix` copies into a
*different* user's project. That copy now passes through
`quarantineRemixedScripts()` (`web/src/lib/security/remixSanitizer.ts`, #9455),
which forces every `scriptData.enabled` to `false` — the source text is kept so
the remixer can read and adapt it, but nothing compiles until they turn it on
deliberately. **Any new path that moves `sceneData` across a user boundary must
call that function**; it is the only thing standing between a published game's
script and a stranger's `Function(...)`. Playing a published game still runs the
creator's scripts by design — the sandbox below is the only control there.

**Layers that exist today** (defence in depth — NOT a security boundary):

| Layer | Where | Pinned by |
|---|---|---|
| Global shadowing (21 names) | `sandboxGlobals.ts` → `SHADOWED_GLOBALS` | `sandboxGlobals.test.ts`, `scriptSandbox.test.ts` |
| Capability revocation | `revokeNetworkGlobalsIfWorker()` | `revokeNetworkGlobals.test.ts` |
| Command allowlist (main thread) | `scriptAllowlist.ts`, `useScriptRunner.ts` | `scriptSandbox.test.ts`, `scriptSecurity.test.ts` |
| Per-frame command cap | `MAX_COMMANDS_PER_FRAME` | `scriptSecurity.test.ts` |
| Loop watchdog | `loopGuards.ts` | `loopGuards.test.ts`, `loopWatchdog.test.ts` |
| Source size cap (512 KiB) | `MAX_SCRIPT_SOURCE_BYTES` | `scriptWorker.ts` |

There is **no rate limiter**. Earlier comments claimed one; it has never existed.

**Known escape.** Parameter shadowing does not survive the constructor chain:
`(0).constructor.constructor('return fetch')()` still resolves. This is stated
in `sandboxGlobals.ts` and documented (not prevented) by the
"nested Function constructor limitation" test in `scriptSandbox.test.ts`. Real
containment requires a different execution substrate — tracked at #8700.

**Suppression.** GitHub does not honour `// lgtm[...]` or `// codeql[...]`
comments unless the language's `AlertSuppression.ql` runs alongside the analysis
and its SARIF `suppressions` are fed to `advanced-security/dismiss-alerts`
(github/codeql#11427). We do neither. Dismiss code-scanning alerts through the
UI or `PATCH /repos/{owner}/{repo}/code-scanning/alerts/{n}` — never by adding a
comment. Note that editing lines near the sink re-mints the alert number and
drops the prior dismissal.

## Test Conventions

- Vitest workspace splits: `vitest.config.node.ts` (node) and `vitest.config.jsdom.ts` (jsdom)
- Store slices: `sliceTestTemplate.ts` pattern with `createSliceStore()` and `createMockDispatch()`
- Script workers: Stub `self` with mock `postMessage`, use `vi.resetModules()` + dynamic import
- **mock*Once leak guard** (`web/vitest.mockOnceGuard.ts`, loaded by `vitest.setup.ts`): a test that queues `mock*Once` on a mock it did not create — a module-scoped `vi.fn`, a `vi.mock` factory mock (however lazily the factory ran), or a bare automock — and never consumes it FAILS, naming the still-armed queueing line. Consume the value, or build the mock inside the test. `MOCK_ONCE_GUARD=off` disables it for a local run (bisecting); it is ignored under CI. Under CI's `retry: 1`, a transient failure between queueing and consuming shows up on the retry as this guard's error — chase the original failure.

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
- **Three generated-artifact sync gates can break `main` if you edit a source without regenerating** — the root `package-lock.json` (single-root lockfile), gh-aw `*.lock.yml`, and `docs/api/openapi.json`. Full failure modes, detection gates, and the exact fix recipe for each: `.claude/rules/gotchas-build-ci.md` → Build & CI.

See `.claude/rules/gotchas.md` — an index of four path-gated files carrying 40+ additional context-specific gotchas.
