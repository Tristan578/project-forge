# Backlog Difficulty Ranking — 2026-09-01

_Produced by a 32-agent workflow: 121 eligible open issues scored for difficulty, value and validity against `main`, the top 22 deep-validated with file-level evidence and implementation plans, then ranked. Codex-owned (#9516) and owner-only (MANUAL) tickets were excluded. Plans are a starting point; re-verify each ticket against current `main` before starting it._

# SpawnForge Ticket Ranking — Autonomous Engineer, Hardest × Most Valuable × Still-Valid

## 1. Ranked Table

| Rank | # | Title | Diff | Value | Effort h | Risk | WASM? | CI pins? | One-line why |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 9557 | Nothing exercises the real Upstash integration — rate limiting can fail open unnoticed | 7 | 9 | 7 | med | no | **yes** | Fail-open security control with zero real coverage; the exact class already cost 3.5 months of silently per-instance limits (#9623). **Blocked on owner-only #9556.** |
| 2 | 8860 | AI SDK v7 `toolApproval` gate on destructive chat-agent tools | 9 | 8 | 26 | high | no | no | First server-enforced gate on 260 `:write` tools; validation found the ticket's approve path is provably broken and uncovered a live multi-turn break in the same helper. |
| 3 | 9542 | Mechanize the unconsumed-`mock*Once` guard | 7 | 8 | 9 | med | no | no | Class has **already recurred on main** (5 live leaks); guard proven to catch both #9541 regressions with 0 false positives across 20k tests. |
| 4 | 8354 | E6 UGC moderation — report → auto-hide → admin queue for published games | 6 | 8 | 11 | med | no | no | Legal/acquisition-readiness takedown path; entirely unbuilt, all reuse scaffolding verified present, no external blockers. |
| 5 | 9186 | Translate entity design intent into generated behavior scripts | 6 | 8 | 18 | med | no | no | Golden-path gap: generated enemies have mesh+collider and do nothing; validation shows components already exist, so this is wiring not invention. |
| 6 | 9610 | Cross-browser E2E: firefox/webkit/mobile projects executed by nothing | 7 | 7 | 16 | med | no | **yes** | 4 (really 6) declared Playwright projects run nowhere; durable guard is the half that survives. **Decouple from #9611 — WebKit needs no macOS runner.** |
| 7 | 9611 | Cross-platform CI: every job runs on Linux | 7 | 7 | 16 | med | no | **yes** | 98 jobs, 0 non-Linux; its named prereq (#9606) already landed, so the remaining work is real and clear. Cost premise wrong (repo is public → free runners). |
| 8 | 8700 | Real script isolation boundary (sandboxed origin) replacing global revocation | 9 | 5 | 40 | high | no | **yes** | Genuine security boundary, hardest ticket on the list; blocked-in-practice by a mandatory unbudgeted single-file worker build + a manual CodeQL re-dismissal. |
| 9 | 9550 | Runtime builds queue 2D-joint/gravity2d commands that nothing drains | 7 | 6 | 8 | med | **yes** | no | Unbounded per-frame leak in exported games via script-allowlisted `set_gravity2d`; consuming layer already ships, so un-gating makes it *work*. |
| 10 | 9293 | MCP server has no editor endpoint — `/api/mcp/ws` does not exist | 7 | 6 | 16 | med | no | no | 351 published MCP commands unreachable + docs assert they work + a paid-tier API-key feature that authenticates nothing. Needs an ADR first. |
| 11 | 8892 | Durable QStash-backed generation completion (client hydration half) | 6 | 6 | 6 | med | no | no | Real regression PF-906 introduced, but only live when QStash is on — and it is unset everywhere, so the AC is unverifiable. |
| 12 | 6831 | Onboarding first-5-minutes flow | 6 | 6 | 12 | med | no | no | ~40% already shipped; its central instruction (`engineMode` after `play()`) is unimplementable and needs a product decision on auto-approve. |
| 13 | 9525 | Fix broken cross-workflow WASM artifact reuse | 8 | 4 | 10 | med | no | **yes** | Removes a permanently-green no-op step, but half the ticket already shipped and the real saving is ~6 min/engine-merge, not the claimed $300/mo. |
| 14 | 8859 | Opus 4.8 prompt-cache — mid-conversation system messages | 8 | 4 | 11 | med | no | no | Plausibly a **cost regression** as specced (history has no breakpoint); AC is vacuous; diagnostics half impossible. Needs re-scoping before it's worth doing. |
| 15 | 8887 | Bevy 0.18.1 → 0.19 coordinated migration | 9 | 4 | 32 | high | **yes** | **yes** | Unfreezes Dependabot for bevy/egui, but zero user-visible change, multi-day compile loop, and only ~6% WASM size-budget headroom for a wgpu 27→29 jump. |

**Dropped below the line:** #8983, #8985, #8982 (graph-RAG chain), #7810, #7857, #7579 — see §3.

**Dependency order:**
- `#9556 (owner) → #9623 (merge first) → #9557`
- `#9611 ⟂ #9610` — validation shows **no** dependency (Linux WebKit ships with Playwright); do them in parallel, but sequence the *runner* work so one job isn't built twice. If done together, #9611 lands first (`.gitattributes` eol=lf + the platform contract are prerequisites for any second runner).
- `#8978 → #8979 → #8980 → #8981 → #8982 → #8983 → #8985` — entire graph chain unstarted; all dropped.
- `#9542` before any wide test-isolation work — it is the mechanism the rest lean on.

**PR grouping:** one PR per ticket. The only two that share files are #9610 and #9611 (`ci.yml`, `scripts/__tests__/check-npm-audit.test.sh`) and they are *not* one change — but land them back-to-back, not concurrently, because both must edit the byte-pinned ci.yml job-key enumeration.

---

## 2. Plans (Top 10)

### 1 — #9557 · Upstash integration coverage
**Steps**
1. **Gate:** verify `gh secret list` shows `CI_UPSTASH_REDIS_REST_URL/TOKEN` and no bare `UPSTASH_REDIS_REST_*` (owner ticket #9556). Do not start otherwise.
2. **Sequence:** merge #9623 (`claude/fix-9623-upstash-eval-body-form`, 8fdcbef1) first — the raw-EVAL path is broken on main and would redden a correct new assertion.
3. Rewrite the vacuous `checkRateLimiting()` (`healthChecks.ts:196-216`) to actually `POST ["PING"]` with a bounded timeout; healthy only on `PONG`, non-critical.
4. Add `web/e2e/helpers/upstash.ts`: `syntheticIp()` from `GITHUB_RUN_ID`+attempt+shard, `redisCommand()`, `zcard()`.
5. Spec `rate-limit-upstash.spec.ts` (`@ui`): burst→429 **plus** `ZCARD @spawnforge/ratelimit:public:health:<ip> > 0` **plus** `ZCARD ...health-fanout:<ip> > 0` **plus** health reports Upstash `up`.
6. Wire creds at **step** level on `Build for E2E` + `Run UI-only E2E tests` in `ci.yml` **and** `cd.yml` (tag-routing pins ci/cd parity). Add `E2E_EXPECT_UPSTASH` (false for dependabot/forks).
7. Prove the gate can fail: revoke the token on a scratch branch, record the RED run URL in the PR.

**Files** `ci.yml`, `cd.yml`, `web/e2e/tests/rate-limit-upstash.spec.ts`, `web/e2e/helpers/upstash.ts`, `healthChecks.ts` (+test), `rateLimit/distributed.ts`

**Tests** ZCARD assertions on both backends (the only thing distinguishing live Upstash from the in-memory fallback); negative guard failing when `E2E_EXPECT_UPSTASH=true` but creds absent; full `scripts/__tests__/*.test.sh` re-run after ci.yml edit.

**Blockers** #9556 owner-only. #9623 ordering. The ticket's own headline AC (burst→429) is **vacuous** — in-memory fallback produces identical 429s; must be replaced. Extend `test-e2e-ui`, do **not** add a job (job-key pin at `check-npm-audit.test.sh:2524`).

---

### 2 — #8860 · `toolApproval` gate
**Steps**
1. **STEP 0 — reproduce the adjacent break:** run a real 2-iteration tool turn without mocking `createSpawnforgeAgent`. `{role:'user', content:[{type:'tool_result'...}]}` is invalid against `modelMessageSchema`; if confirmed it is arguably P0 and ships with this.
2. Add `"destructive": true` to genuinely destructive manifest commands (~54), byte-synced to all **three** `commands.json` copies. `:write` alone gates 260/351 → unusable.
3. `getAgentToolApproval()` beside `getAgentTools()`, same predicate, → `toolApproval` on `ToolLoopAgent`. Do **not** set `experimental_toolApprovalSecret`.
4. Widen `buildModelMessages()` to `ToolModelMessage`; pass assistant `tool-call`/`tool-approval-request` parts through verbatim; add a `role:'tool'` branch; fix the pre-existing Anthropic-block shape.
5. chatStore: `'approval-required' | 'denied'` + `approvalId`; buffer `tool-input-available`, drain at `finish`; handle `tool-approval-request`, `tool-approval-response`, and the **undocumented `tool-output-denied`**.
6. `resumeAfterApproval`: on approve, **execute locally first**, then resume with approval-response **plus a real `tool-result`** (SDK's `executeToolCall` returns `undefined` for no-`execute` tools → dangling `tool_use` → Anthropic 400).

**Files** `spawnforgeAgent.ts`, `api/chat/route.ts`, `chatStore.ts`, `ToolCallCard.tsx`, `ChatMessage.tsx`, `streamingTestUtils.ts`, 3× `commands.json`

**Tests** Schema guard feeding every emitted shape through the SDK's own `modelMessageSchema` (nothing does this today — why the invalid shape shipped); approve path asserts tool message is LAST and carries both parts; deny asserts `executeToolCall` never called; out-of-order chunk regression.

**Blockers** Ticket's approve path is provably wrong. Third chunk type missing from spec. Manifest needs a `destructive` field first. Resume is a second billed turn.

---

### 3 — #9542 · `mock*Once` guard
**Steps**
1. `web/vitest.mockOnceGuard.ts` (root, outside `src/**` coverage include). Wrap `vi.fn`/`vi.spyOn`/`vi.mocked`; override the `mockImplementationOnce` **property** (all five `*Once` helpers delegate through it); wrap queued impls in a **Proxy** with `apply`+`construct` traps.
2. Four discrimination rules, each fixture-proven: skip `spyOn` (already restored), skip same-test-id creations, treat `mockReset` as drained, only report queues created during the current test.
3. Trim stack frames inside `node_modules/@vitest`; report the first repo frame.
4. Register **before** the existing `restoreAllMocks` afterEach (`sequence.hooks:'stack'` → first-registered runs last).
5. Fix the **5 live leaks** on main: `subscriptionLifecycle.test.ts:185,186,219,220,227`.
6. Measure overhead: 3 paired full runs of node + jsdom configs, medians.

**Files** `web/vitest.setup.ts`, `web/vitest.mockOnceGuard.ts`, `src/lib/testing/__tests__/mockOnceGuard.test.ts`, `__fixtures__/onceGuard/*`, `subscriptionLifecycle.test.ts`

**Tests** Negative test spawning a **real child `vitest run`** over fixtures (logic-only test = the vacuous trap); delegation self-test pinning the vitest internal; anti-vacuity scan asserting the fixture run produced ≥1 report.

**Blockers** **AC3 is false** — fallout exists today; land report-only or fix in the same PR. Depends on a vitest internal (delegation) → self-test mandatory. 4 `(x as Mock)` cast sites are invisible to a creation-time wrapper → structural scan.

---

### 4 — #8354 · UGC moderation for games
**Steps**
1. Schema: `'flagged'` on `publishStatusEnum`; `reportCount`/`flaggedAt` on `publishedGames`; `gameReports` + `uq_game_reports_reporter_game`.
2. **Two** generated migrations — PGlite execs each file as one transaction and Postgres forbids using a new enum value in the transaction that added it.
3. Verify with `schemaMigrationParity.db.test.ts` before writing route code.
4. `POST /api/community/games/[id]/report` — **one atomic CTE** via `getNeonSql()` (insert ON CONFLICT DO NOTHING + conditional flip + count bump). Two drizzle writes lose the bump on retry.
5. `REPORT_AUTOHIDE_THRESHOLD` constant (default 1) — one report from any account = a one-click takedown weapon; surface to the owner.
6. Extend `/api/admin/moderation` with `?type=game`; `delete` → `status:'unpublished'`, **never** a hard delete (NOT NULL FKs, no cascade).
7. Close the appeal dead end: `appeals/[id]/review/route.ts:85` restores comments only.
8. Add the route to `openapi-internal-routes.json` — **unmentioned hard CI gate**.

**Files** `schema.ts`, 2× `web/drizzle/*.sql`, report route, `admin/moderation/route.ts`, `appeals/[id]/review/route.ts`, `ReportGameDialog.tsx`, `GamePlayer.tsx`, `publishStore.ts`, `openapi-internal-routes.json`

**Tests** `.db.test.ts` against PGlite (the correctness lives in the SQL); duplicate-report idempotency; flagged game 404s on play; admin `delete` asserts `db.delete` never called.

**Blockers** openapi-route-sync gate. Abuse-threshold product decision. No admin UI exists → "reviewed within 24h" AC is API-only.

---

### 5 — #9186 · Entity intent → behavior
**Steps**
1. Prefer **existing game components** over generated scripts: chase→`follower`, patrol→`moving_platform`, idle→no-op, flee→script, projectile_fire→`spawner`.
2. `behaviorVocabulary.ts` with a `Record<Behavior, BehaviorPlan>` so a new entry is a compile error.
3. Add `behavior: zBehavior.optional()` — **singular** (`decomposer.test.ts:520` asserts the prompt never contains `'behaviors'`).
4. **Fix the fictional API first**: `customScriptExecutor.ts:37-55` advertises 10/18 nonexistent methods (`forge.entity.*`, `isKeyDown`, `setText`) — live for 5 unregistered categories today.
5. Parameterize templates (`enemy_patrol` hardcodes `findByName("Player")`); emit in planBuilder Phase 3 after `physics_enable`.
6. **Dedupe against `challenge.ts:289-340`** — `planFollowers` already plans a follower per enemy; two writers is a bug.

**Files** `behaviorVocabulary.ts`, `decomposer.ts`, `types.ts`, `planBuilder.ts`, `systems/challenge.ts`, `customScriptExecutor.ts`, `scriptTemplates.ts`, `crystal-run-3d.json`

**Tests** `forgeApiConformance.test.ts` extracting every `forge.*` from templates + the executor prompt and resolving against `forgeTypes.ts` (**fails on main today** — proof it isn't vacuous); double-writer pin; zero-token-cost pin; E2E observable motion.

**Blockers** Enemy bodies are `fixed`+`isSensor` → `applyForce` is a silent no-op. `scriptTemplates.test.ts:6` pins length 10.

---

### 6 — #9610 · Cross-browser E2E
**Steps**
1. **Correct two premises on the ticket:** drop the #9611/macOS coupling (Playwright ships Linux WebKit; `e2e:install` already pulls it); state that engine SwiftShader flags are Chromium-only so the WebGPU-on-Safari motivation is **out of reach**.
2. Land the **guard first, red**: extend `e2e-tag-routing.test.sh` to enumerate every `name:` in every `playwright*.config.ts` and require a workflow invocation. Verify it names all 5 unexecuted projects before fixing.
3. Explicit allowlist with per-entry reasons; assert allowlisted names still exist; assert enumeration matched ≥1 project.
4. `playwright.crossbrowser.config.ts` with per-project `launchOptions:{args:[]}` (the shared `--disable-gpu --no-sandbox` is Chromium-only).
5. Browser-set segment in the Playwright cache key — otherwise `cache-hit==true` restores chromium-only and skips install.
6. New job non-blocking for one window → then add to `ci-success` needs. Update the job-key pin.

**Files** `e2e-tag-routing.test.sh`, `playwright.crossbrowser.config.ts`, `ci.yml`, `install-playwright-ci.sh` (+ byte-pinned suite), `check-npm-audit.test.sh`

**Blockers** `agent-chromium` goes red day one → policy decision. Unknown-size triage across 385 never-run tests. Job-key pin.

---

### 7 — #9611 · Cross-platform CI
**Steps**
1. Restate cost: repo is **PUBLIC** → windows/macos standard runners free; measure wall-clock/concurrency instead.
2. **Prereq A:** `*.sh text eol=lf` in `.gitattributes` + reject 0x0D in `check-source-encoding.sh:72`. Without it all 47 suites die at the shebang.
3. **Prereq B:** `claude-refs-resolve.test.sh:74` → `git ls-files` (fails on a dev machine today, passes in CI — inverse of AC4).
4. **Prereq C:** one shared `unsupported_on()` contract, exits **non-zero**; migrate the ~20 ad-hoc `skipped` helpers.
5. `hook-tests-windows` on `windows-latest`, `shell: bash`, reusing existing ci-gate outputs. Verify `python3` resolves in Git Bash.
6. Thread through all four anti-tamper mechanisms in one commit.

**Files** `ci.yml`, `.gitattributes`, `check-source-encoding.sh`, `claude-refs-resolve.test.sh`, `check-ci-success.sh`, `check-npm-audit.test.sh`, platform lib

**Blockers** Cost AC unsatisfiable as written. CRLF. `python3` vs `python.exe`. Sequencing with #9610's macOS/WebKit decision.

---

### 8 — #8700 · Real script isolation boundary
**Steps**
1. **Prerequisite (~1 day, unbudgeted in the ticket):** esbuild devDependency + `build-script-worker.mjs` producing a single-file IIFE with zero `import`/`importScripts`/`import.meta` — verified impossible from Turbopack output today.
2. Wire it into `predev`/`prebuild` **and** an explicit step before each of `ci.yml:1218,1317,1499` and `cd.yml:699` (`npx next build` bypasses lifecycle scripts → silent 404 → dead Play mode).
3. `sandboxIframeDocument.ts`: static srcdoc, meta CSP `default-src 'none'; connect-src 'none'`, **classic** inner worker.
4. `sandboxIframeHost.ts`: `sandbox` = `allow-scripts` only; validate `event.source === contentWindow`.
5. Prefer `MessageChannel` port transfer over the ticket's relay (removes two 60Hz structuredClone hops).
6. Rewrite the transport mock in `useScriptRunner.test.ts` (~30 call sites, now async).

**Files** 2 new sandbox modules, `useScriptRunner.ts`, `build-script-worker.mjs`, `ci.yml`, `cd.yml`, `script-sandbox-isolation.spec.ts` (`@engine-ui`, not `@engine`)

**Blockers** Mandatory unbudgeted worker build. E2E must seed a `score` win condition (#8542 gate) or it passes vacuously. `about:srcdoc` under `frame-src 'self'` and WebKit port re-transfer both **unverified**. Requires a **manual owner CodeQL re-dismissal** (editing near the sink re-mints the alert).

---

### 9 — #9550 · Runtime command drains
**Steps**
1. **Owner decision on the record** — recommend Option 2 (register drains in runtime): `Physics2dPlugin`, `sync_gravity2d`, `manage_joint2d_lifecycle`, `HistoryStack` all already ship in runtime builds, so un-gating makes the commands *work*.
2. Un-gate `physics.rs:496,525,553,686,703,715` + `query.rs:475,515`; split `pending_commands`/`PhysicsJoint2d` out of the gated `use` group.
3. Move registrations out of the editor block (`mod.rs:598-777`) — a move, not a reorder; keep off `EditorSystemSet`.
4. **Add the gate that would have caught this:** a core-side fail-closed scan mapping every ungated dispatch arm → its queue → a drain reachable in runtime, with a reasoned waiver list.
5. Fix the cfg-blind `every_deferred_query_variant_is_claimed_by_a_bridge_system` (currently reports 3 unanswerable variants as covered).
6. Add `cargo test --lib --features bevy/x11,runtime` to **quality-gates.yml** (not ci.yml — avoids the byte pins).

**Files** `bridge/physics.rs`, `bridge/query.rs`, `bridge/mod.rs`, `core/pending/query.rs`, `quality-gates.yml`, 3× `commands.json`, `forgeTypes.ts`

**Blockers** Owner decision. WASM rebuild + CD, and **already-exported ZIPs keep the bug forever**. No E2E can reach the runtime binary (`/play` loads the editor build).

---

### 10 — #9293 · MCP editor endpoint
**Steps**
1. **STEP 0 — ADR required, owner-only:** (A) local-only relay, (B) Cloudflare Durable Objects, (C) declare unsupported. Vercel Functions cannot hold a WS; the 351 handlers are browser-bound.
2. Ship the docs fix **first, independently** (~1.5h): correct `mcp-server/README.md` and `mcp-server-setup.md`, and the count drift (322/350/351 vs a manifest of 351).
3. Stop the lie in code: don't default to a dead URL; cap the 5s-forever reconnect; rename the misleading error.
4. Relay on `127.0.0.1:3001/api/mcp/ws`, editor/agent roles, loopback-only, single editor.
5. Editor-side hook, **opt-in only**, calling `executeToolCall` from `chat/executor.ts`.
6. Deliberate allowlist — 351 commands include `export_project_zip` and token-spending generators.
7. Wire or delete the Creator+-gated API keys — nothing reads `apiKeys.keyHash`.

**Files** `mcp-server/src/index.ts`, `transport/websocket.ts`, new `relay/server.ts`, `web/src/lib/mcp/useEditorBridge.ts`, both docs, ADR

**Tests** `websocket.test.ts` (does not exist today); in-process relay integration round-tripping `spawn_entity` — the assertion that would have caught the original defect; a doc-truth test pinning the count (**fails 3× on main**).

**Blockers** ADR. Keep the relay inside `mcp-server/` or ci.yml path filters need editing. Option B needs owner-only Cloudflare DO provisioning.

---

## 3. Dropped

| # | Reason |
|---|---|
| **8983** GRAPH generation dedupe | Five open upstream tickets; `generationJobs.projectId` is **never written** while `graph_nodes.project_id` is NOT NULL → would ship a query returning zero rows forever. |
| **8985** GRAPH chat grounding | Same unbuilt chain; spec's own recursive CTE is **invalid Postgres** (two self-references, reproduced against PGlite); `ORDER BY distance` sinks unembedded structural nodes. |
| **8982** GRAPH eval harness | Public repo → real prompts can't be committed; pre-launch → no traffic to mine; a dozen self-selected pairs scoring 1.00 gates nothing. Needs #8979/#8981 first. |
| **7810** Instant multiplayer / split-screen | Spec is `DRAFT — Awaiting Approval` (constitution hard stop); engine has **one** `Camera3d` and no `EntityType::Camera`, so the second camera it requires cannot be created; title promises networking the body de-scopes. |
| **7857** Player-generated levels | XL, value 3, no UI, no play path, no admin queue — ships an unreachable API plus a permanent UGC moderation obligation. Superseded in priority by #8354, which is the same domain done right. |
| **7579** Aseprite AI agent | Structurally undeployable (shells out to a local binary, writes `$HOME`; returns 503 on Vercel), Aseprite EULA is an **owner/legal** question, and the raster `generate_pixel_art` path already serves the job for 100% of hosted users. Also carries a live arbitrary-file-write defect that should be split out as its own P1. |

**Split-out P1 recommended regardless:** the `outputPath`/`inputPath` arbitrary-file-write in `luaTemplates.ts` (from #7579) — reachable today by any authenticated user, valuable even though the parent ticket is dropped.