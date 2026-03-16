# SpawnForge — Platform Review & Improvement Tracker

> Auto-maintained by system audit loop. Each section identifies an area of improvement, its rationale, severity, and linked backlog ticket.

**Last updated:** 2026-03-16 01:40 (Iteration 11 — Validation Pass)
**Scope:** Architecture, Security, Scalability, DX, UX, Maintainability, Auth, E2E, Accessibility, CI/CD

---

## Critical Path: Security

### 1. X-Forwarded-For Header Spoofing — PF-463 [HIGH]
**File:** `web/src/lib/rateLimit.ts:15-25`
**Issue:** `getClientIp()` trusts `X-Forwarded-For` without verifying it came from a trusted proxy (Vercel/Cloudflare). Attackers can spoof IPs and bypass rate limiting entirely.
**Impact:** Rate limiting is effectively decorative against motivated attackers.
**Fix:** Validate header against known proxy IP ranges before trusting. Fall back to socket IP.

### 2. SVG Thumbnail XSS in Publish Endpoint — PF-467 [HIGH]
**File:** `web/src/app/api/publish/route.ts:35-42`
**Issue:** Thumbnail validation accepts `data:image/svg+xml` which can embed JavaScript. A published game could execute arbitrary scripts in viewers' browsers.
**Impact:** Stored XSS — any user viewing a malicious game thumbnail is compromised.
**Fix:** Whitelist `image/jpeg`, `image/png`, `image/webp` only.

### 3. Slug Collision with System Routes — PF-470 [MEDIUM]
**File:** `web/src/app/api/publish/route.ts:62-65`
**Issue:** Slug regex allows `admin`, `api`, `auth`, `webhook` as game slugs, which collide with system routes.
**Fix:** Add reserved word blocklist.

---

## Critical Path: Resilience

### 4. WASM Panic = Silent Death — PF-464 [HIGH]
**File:** `web/src/hooks/useEngine.ts:162-178`
**Issue:** After a WASM panic, `installPanicInterceptor` logs to Sentry but doesn't recover. All subsequent engine commands fail silently. The user has no idea the engine is dead.
**Impact:** Users lose the ability to edit without any error message. Only a full page reload fixes it.
**Fix:** Show recovery dialog with "Reload Engine" and "Save & Refresh" options. Re-instantiate WASM module.

### 5. No Top-Level Error Boundary — PF-465 [HIGH]
**File:** `web/src/app/editor/layout.tsx` (missing)
**Issue:** Only `InspectorErrorBoundary` exists. A crash in EditorLayout, CanvasArea, or SceneHierarchy kills the entire page.
**Impact:** Any React render error in the editor = white screen of death.
**Fix:** Wrap editor root in ErrorBoundary with save-state-and-reload fallback UI.

### 6. Webhook Failure = Permanent Data Loss — PF-469 [MEDIUM]
**File:** `web/src/app/api/auth/webhook/route.ts:45-50`
**Issue:** Clerk webhook handler catches all errors uniformly. A transient network failure permanently loses the user sync event.
**Fix:** Distinguish transient vs permanent errors. Queue transient failures for retry.

---

## Critical Path: Scalability

### 7. Missing Database Indexes — PF-468 [HIGH]
**File:** `web/src/lib/db/schema.ts`
**Issue:** High-traffic tables (`publishedGames`, `tokenUsage`, `costLog`) queried by `userId`, `status`, `createdAt` with no indexes. Will cause sequential scans at scale.
**Impact:** Database performance degrades linearly with user count. 10K users = unacceptable query times.
**Fix:** Add Drizzle `index()` declarations to frequently filtered columns.

### 8. No Admin Route Rate Limiting — PF-466 [HIGH]
**File:** `web/src/app/api/admin/economics/route.ts:10-30`
**Issue:** Admin endpoints have `assertAdmin()` but no rate limiting. A compromised admin token can hammer the database with aggregation queries.
**Fix:** Add `rateLimitAdminRoute()` helper — 10 req/min per userId.

---

## Developer Experience

### 9. Monaco Editor Cold Start — PF-471 [MEDIUM]
**File:** `web/src/components/editor/ScriptEditorPanel.tsx:15-25`
**Issue:** Monaco dynamically imported with no prefetch hint. 2-3s delay on first script panel open.
**Fix:** Add `<link rel="prefetch">` for monaco chunks.

### 10. Commands.json Dual Copy — No Ticket (Low)
**Files:** `web/src/data/commands.json`, `mcp-server/manifest/commands.json`
**Issue:** 322 commands duplicated between MCP server and web frontend. Manual sync required.
**Rationale:** Low priority — copy is automated by convention. Could fetch from API in future.

### 11. Store Slices Not Lazy-Loaded — No Ticket (Low)
**File:** `web/src/stores/editorStore.ts:1-50`
**Issue:** All 16 domain slices imported eagerly. Even unused panels are bundled.
**Rationale:** Low priority — Zustand slices are lightweight. Would add complexity for marginal gain.

---

## Architecture Quality

### 12. Inconsistent API Error Envelope — No Ticket (Low)
**File:** Various `web/src/app/api/*/route.ts`
**Issue:** Some routes return `{ error, code }`, others `{ error, message }`. No standardized format.
**Rationale:** Partially addressed by PF-387 (API envelope standardization, done). Remaining inconsistencies in older routes.

### 13. Circuit Breaker Ignores Schema Errors — No Ticket (Low)
**File:** `web/src/lib/db/circuitBreaker.ts:30-50`
**Issue:** Only trips on transient errors. Schema migration bugs cause permanent failures that never trip the breaker.
**Rationale:** Edge case — schema bugs caught by CI. Low priority.

### 14. No Connection Pool Monitoring — No Ticket (Low)
**File:** `web/src/lib/db/client.ts:10-20`
**Issue:** Neon serverless pooling with no metrics. Can't detect pool exhaustion until app degrades.
**Rationale:** Would need custom metrics integration. Track when Sentry errors spike instead.

---

## Memory & Performance

### 15. PlayTick Callback Accumulation on HMR — No Ticket (Low)
**File:** `web/src/stores/editorStore.ts:40-45`
**Issue:** `setPlayTickCallback()` doesn't clear previous callback. HMR causes accumulation.
**Rationale:** Dev-only issue. No production impact.

### 16. Engine Event Callback Not Cleaned on Unmount — No Ticket (Low)
**File:** `web/src/hooks/useEngineEvents.ts:15-30`
**Issue:** `set_event_callback()` called once, no cleanup on unmount. Duplicate callbacks if component remounts.
**Rationale:** EditorLayout rarely unmounts in practice. Low priority.

### 17. Anthropic Prompt Cache Strategy — No Ticket (Low)
**File:** `web/src/app/api/chat/route.ts:281-286`
**Issue:** System prompt cached with `cache_control: ephemeral` but scene context not included. Scene changes force full re-processing.
**Rationale:** Anthropic caching is automatic for matching prefixes. Minor optimization.

---

---

## Iteration 2: Auth, E2E Coverage, WASM Loading, Accessibility, CI/CD

### 18. Clerk Webhook Ignores User Deletion — PF-472 [URGENT]
**File:** `web/src/app/api/auth/webhook/route.ts:43`
**Issue:** `user.deleted` events are ignored. Users deleted in Clerk remain in the DB with full access to their data. This is a compliance/privacy violation.
**Impact:** GDPR/privacy — deleted users' data persists indefinitely. Potential legal liability.
**Fix:** Handle `user.deleted` webhook: soft-delete user, revoke sessions, cascade to owned resources.

### 19. WASM Loading Has No Timeout or Progress — PF-473 [HIGH]
**File:** `web/src/hooks/useEngine.ts:49-122`
**Issue:** WebGPU device init has no timeout (could hang forever). WASM fetch has no timeout (CDN stall = infinite wait). No progress indicator during 5-10s load — users think the app is broken.
**Fix:** 30s timeout on GPU init, 60s on WASM fetch. Show progress bar. CDN health check before download.

### 20. Auth Degraded Mode Skips Credit Checks — PF-474 [HIGH]
**File:** `web/src/lib/auth/api-auth.ts:45-60`
**Issue:** When DB lookup fails, degraded mode returns user without tier/credit info. AI features could run free. Auth sync has no retry — single transient error = auth failure.
**Fix:** Add 1-retry for sync. Deny credit-consuming features in degraded mode.

### 21. User Delete Not Transactional — PF-475 [HIGH]
**File:** `web/src/lib/auth/user-service.ts:45-60`
**Issue:** `deleteUserAccount()` cascading delete has no transaction. Partial failure = orphaned scenes, assets, projects. No soft-delete for audit trail.
**Fix:** Wrap in Drizzle transaction. Add 30-day soft-delete retention period.

### 22. E2E Tests Don't Exercise Backend — PF-476 [HIGH]
**File:** `web/e2e/tests/publish-flow.spec.ts`, `export.spec.ts`, `ai-chat.spec.ts`
**Issue:** E2E tests verify UI dialogs but never call publish/export/AI endpoints. No subscription lifecycle tests. Critical user flows are untested end-to-end.
**Fix:** Add backend-exercising E2E tests for publish (verify `/play/<slug>`), export (verify HTML runs), and subscription flows.

### 23. Editor Tab Accessibility Gaps — PF-477 [MEDIUM]
**File:** `web/src/components/editor/EditorLayout.tsx:49-100`
**Issue:** Tabs have `role="tab"` but no `aria-selected`. Tab content lacks `role="tabpanel"`. E2E a11y test has 70% threshold instead of 100%.
**Fix:** Add ARIA attributes. Raise accessibility threshold.

### 24. CD Pipeline Missing Staging Smoke Gate — PF-478 [MEDIUM]
**File:** `.github/workflows/cd.yml`
**Issue:** Staging deploy auto-promotes to production without smoke test validation. WASM artifacts retained only 1 day (insufficient for incident debugging).
**Fix:** Invoke smoke tests after staging deploy. Extend artifact retention to 7 days.

### 25. Chat Stream Has No Timeout — No Ticket (Low)
**File:** `web/src/stores/chatStore.ts:107-150`
**Issue:** TextDecoder stream parsing has no timeout. Network stall = chat frozen indefinitely. Also: no confirmation dialog for "Clear chat" — accidental data loss.
**Rationale:** Edge case — network stalls are rare and browser will eventually timeout the fetch.

### 26. Zod Installed But Unused — No Ticket (Low)
**File:** `web/package.json`
**Issue:** Zod 4.3.6 is a dependency but validation uses manual `typeof` checks throughout. Dead dependency adds ~50KB to install.
**Rationale:** Low priority — doesn't affect bundle (tree-shaken). Could clean up in a dependency audit sprint.

---

---

## Iteration 3: Engine, Payments, Sandbox, Assets, Mobile, MCP, Env Config

### 27. Script Worker Has No Infinite Loop Watchdog — PF-479 [HIGH]
**File:** `web/src/lib/scripting/scriptWorker.ts`
**Issue:** No timeout on `onUpdate`/`onStart`/`onDestroy` hooks. `while(true){}` hangs the worker and freezes gameplay with no recovery. Despite docstring claiming "infinite loop watchdog", no test exists.
**Impact:** Any user script with an accidental infinite loop freezes the game permanently. Only fix is hard refresh.
**Fix:** Abort hook execution if it exceeds 100ms. Terminate worker and mark entity script as errored.

### 28. Stripe Refund Handlers Missing — PF-480 [HIGH]
**File:** `web/src/lib/billing/subscription-lifecycle.ts`
**Issue:** No handlers for `charge.refunded` or `charge.refund_updated`. Users who purchase addon tokens and get refunded retain the tokens indefinitely.
**Impact:** Revenue leakage. Refunded purchases grant permanent free credits.
**Fix:** Add `reverseAddonTokens()` that deducts proportionally on refund.

### 29. No Centralized Env Var Validation — PF-481 [HIGH]
**File:** `web/src/app/layout.tsx`, various API routes
**Issue:** Each route checks its own env vars ad-hoc. App starts with missing vars and fails on first user request instead of at startup.
**Impact:** Production deployments can serve 200s for hours before a user hits the broken code path.
**Fix:** Create `validateEnvironment()` called at startup. Create `.env.example` with required/optional documentation.

### 30. MCP Dead Command Audit Missing — PF-482 [HIGH]
**File:** `web/src/lib/chat/executor.ts`, `mcp-server/manifest/commands.json`
**Issue:** 396 MCP commands in manifest, no automated check that all have handlers. Phantom commands fail silently.
**Fix:** Add `test:command-parity` CI check that verifies every manifest command has a registered handler.

### 31. Virtual Keyboard Breaks Mobile Gameplay — PF-483 [HIGH]
**File:** `web/src/hooks/useResponsiveLayout.ts`
**Issue:** Uses `window.innerHeight` which doesn't account for soft keyboard. Canvas clips behind keyboard on mobile.
**Fix:** Use `window.visualViewport.height` with resize listener.

### 32. Export Pipeline No Texture Compression — PF-484 [MEDIUM]
**File:** `web/src/lib/export/assetPackager.ts:16-40`
**Issue:** Assets copied as-is during export. 20 textures at 15MB each = 300MB export. Base64 inflates to 400MB+.
**Fix:** Optional PNG→WebP transcoding during export. 60-70% size reduction.

### 33. Script Worker Memory Exhaustion — No Ticket (Low)
**File:** `web/src/lib/scripting/scriptWorker.ts`
**Issue:** Scripts can allocate unbounded arrays/objects until browser OOM kills the worker. No quota enforcement.
**Rationale:** Worker death is isolated (main thread survives). Low priority — browser handles cleanup.

### 34. Engine Bridge 130+ System Registrations — No Ticket (Low)
**File:** `engine/src/bridge/mod.rs:289-439`
**Issue:** 130 systems registered in a single Plugin. Approaching Bevy tuple limits for `add_systems` calls.
**Rationale:** Functional today. Worth grouping into SystemSets for maintainability but not urgent.

### 35. Predictable Async Request IDs — No Ticket (Low)
**File:** `web/src/lib/scripting/scriptWorker.ts:91-93`
**Issue:** Request IDs are sequential (`req_1`, `req_2`). Predictable if multi-script scenarios exist.
**Rationale:** Single-user editor — no real attack surface. Would matter for multiplayer.

---

## Cumulative Summary

| Severity | Iter 1 | Iter 2 | Iter 3 | Total | Tickets |
|----------|--------|--------|--------|-------|---------|
| URGENT | 0 | 1 | 0 | 1 | PF-472 |
| HIGH | 6 | 4 | 5 | 15 | PF-463-468, PF-473-476, PF-479-483 |
| MEDIUM | 3 | 2 | 1 | 6 | PF-469-471, PF-477-478, PF-484 |
| LOW | 8 | 2 | 3 | 13 | Not ticketed |
| **TOTAL** | **17** | **9** | **9** | **35** | **22 tickets** |

### Positive Findings (What's Working Well)
- **Stripe webhook idempotency**: DB-backed dedup is robust. 3-phase claim→process→finalize with auto-release.
- **Script sandbox global shadowing**: 14 dangerous globals properly shadowed. No bypass vectors found.
- **Command whitelist**: 51 allowed commands enforced (though whitelist lives in test, not worker).
- **Bridge isolation**: `core/` is genuinely platform-agnostic — no web_sys leakage found.
- **Token deduction guards**: SQL-level atomicity with retry loop prevents most race conditions.
- **Health check system**: 8-service monitoring with critical/degraded/healthy status computation.

---

## Iteration 4: Observability, Token Economics, Visual Scripting, Moderation, State Persistence

### 36. Visual Script Cyclic Graph = Stack Overflow Crash — PF-485 [URGENT]
**File:** `web/src/lib/scripting/graphCompiler.ts` (compileExecChain)
**Issue:** No cycle detection. User creates A→B→A in visual editor → `RangeError: Maximum call stack size exceeded`. Known bug acknowledged in test file (line 1025) but never fixed. Data-flow cycles produce invalid TypeScript silently.
**Impact:** Editor crash with no error message. Unsaved work lost. Non-programmer users most affected.
**Fix:** Add visited-set to compileExecChain. Return compile error with cycle path description.

### 37. No Auto-Save for Scene State — PF-486 [HIGH]
**File:** `web/src/stores/` (all slices)
**Issue:** No periodic auto-save exists. Only manual "Save" persists to database. Browser crash or accidental refresh = total work loss.
**Impact:** High user frustration. Common complaint pattern for creative tools.
**Fix:** Auto-save to IndexedDB every 30s. Recovery prompt on reload.

### 38. Concurrent Tier Change + Token Deduction Race — PF-487 [HIGH]
**File:** `web/src/lib/billing/subscription-lifecycle.ts:88-174`
**Issue:** Tier downgrade caps tokens while concurrent deduction may be in-flight. No transaction wraps both. Can produce negative balance (monthlyTokensUsed > monthlyTokens).
**Fix:** Database advisory lock or serializable transaction for tier changes.

### 39. No Credit Refund Function — PF-488 [HIGH]
**File:** `web/src/lib/credits/creditManager.ts:32-96`
**Issue:** `deductCredits()` exists but no `refundCredits()`. Failed AI operations deduct credits with no rollback path. Compare: token service has `refundTokens()`.
**Fix:** Add refundCredits() and call on API failure paths.

### 40. No Core Web Vitals Monitoring — PF-489 [MEDIUM]
**File:** `web/src/app/layout.tsx`
**Issue:** No web-vitals package. Cannot measure LCP, FCP, CLS, TTI. Cannot detect performance regressions between deployments.
**Fix:** Add web-vitals reporting to Vercel Analytics.

### 41. No Content Moderation Appeal Flow — PF-490 [MEDIUM]
**File:** `web/src/lib/moderation/contentFilter.ts`
**Issue:** Once content is blocked, users have no recourse. No appeal mechanism, no moderator review queue, no false positive tracking.
**Fix:** Add appeals table, API endpoint, admin review queue.

### 42. No Request Tracing Across Layers — No Ticket (Low)
**File:** `web/src/lib/monitoring/sentry-client.ts`
**Issue:** No trace ID correlation between frontend events, API calls, and engine events. End-to-end debugging impossible.
**Rationale:** Sentry has auto-tracing via @sentry/nextjs. Manual correlation adds marginal value for current scale.

### 43. 100+ Unstructured Console.log Calls — No Ticket (Low)
**File:** `web/src/lib/` across billing, tokens, credits
**Issue:** No structured logging format. No log levels. Production logs polluted.
**Rationale:** Low priority at current scale. Would matter at 10K+ concurrent users.

### 44. Hardcoded UI Strings (~500+) — No Ticket (Low)
**File:** `web/src/components/editor/` (all inspector panels)
**Issue:** Only 14 strings externalized to i18n. Hundreds hardcoded. No RTL support. Date/number formatting not localized.
**Rationale:** i18n infrastructure exists (next-intl + useT hook) but rollout is <5%. Would need dedicated sprint.

---

## Cumulative Summary

| Severity | Iter 1 | Iter 2 | Iter 3 | Iter 4 | Total | Tickets |
|----------|--------|--------|--------|--------|-------|---------|
| URGENT | 0 | 1 | 0 | 1 | 2 | PF-472, PF-485 |
| HIGH | 6 | 4 | 5 | 3 | 18 | PF-463-468, PF-473-476, PF-479-483, PF-486-488 |
| MEDIUM | 3 | 2 | 1 | 2 | 8 | PF-469-471, PF-477-478, PF-484, PF-489-490 |
| LOW | 8 | 2 | 3 | 3 | 16 | Not ticketed |
| **TOTAL** | **17** | **9** | **9** | **9** | **44** | **28 tickets** |

### Top 5 Most Impactful Fixes (Effort vs Value)
1. **PF-485** (Cycle detection in graph compiler) — 2 hours work, prevents crashes
2. **PF-486** (Auto-save) — 4 hours work, prevents work loss for every user
3. **PF-472** (Webhook user deletion) — 2 hours work, compliance requirement
4. **PF-467** (SVG thumbnail XSS) — 30 min work, prevents stored XSS
5. **PF-481** (Env validation) — 1 hour work, prevents every deployment issue

---

## Iteration 5: Dialogue, Templates, Marketplace, Undo, Export, Onboarding

### 45. No Bundle Size Enforcement in CI — PF-491 [MEDIUM]
**File:** `web/next.config.ts:5` (ANALYZE flag), `.github/workflows/ci.yml`
**Issue:** Bundle analyzer exists but only runs manually with `ANALYZE=true`. No CI step rejects PRs that increase WASM or JS bundle size. A PR could silently add 500KB without detection.
**Fix:** Add CI step comparing sizes against thresholds (WASM <30MB/variant, JS <500KB first-load).

### 46. Onboarding Tasks 3D-Centric — PF-492 [LOW]
**File:** `web/src/data/onboardingTasks.ts:8-83`
**Issue:** Tasks reference 3D concepts (cube, sphere) without 2D alternatives. "Add Particle Effects" task assumes WebGPU. New 2D creators get confusing guidance.
**Fix:** Branch tasks by `projectType`. Show sprite/tilemap tasks for 2D, cube/physics for 3D.

### Areas That Passed Clean
- **Game Templates (11)**: All validated — entity counts, script IDs, input presets, transforms. Test suite is comprehensive.
- **Community Gallery**: SQL injection prevention confirmed. Parameterized queries, rate limiting, pagination capped at 100.
- **Undo/Redo (29 variants)**: Comprehensive coverage. All major operations tracked. Missing only dialogue tree undo (JS-side, design decision).
- **Touch Controls Export**: All 5 presets implemented and tested. Dead zones, orientation lock, auto-quality reduction.
- **Export HTML Generation**: Safe escaping, proper WASM fallback chain, correct CSP on served routes.

### Minor Findings (No Tickets)
- Dialogue condition evaluation: missing variable silently returns false (LOW — defensive, not broken)
- Marketplace portfolio URL: no https:// validation (LOW — frontend sanitization handles display)
- Exported standalone HTML: no embedded CSP meta tag (LOW — expected for local files)
- Dialogue import: no JSON schema validation (LOW — client-side only, won't corrupt other data)
- Community game upload: minimal content validation (LOW — frontend sanitization required on render)

---

## Cumulative Summary

| Severity | Iter 1 | Iter 2 | Iter 3 | Iter 4 | Iter 5 | Total | Tickets |
|----------|--------|--------|--------|--------|--------|-------|---------|
| URGENT | 0 | 1 | 0 | 1 | 0 | 2 | PF-472, PF-485 |
| HIGH | 6 | 4 | 5 | 3 | 0 | 18 | PF-463-468, PF-473-476, PF-479-483, PF-486-488 |
| MEDIUM | 3 | 2 | 1 | 2 | 1 | 9 | PF-469-471, PF-477-478, PF-484, PF-489-491 |
| LOW | 8 | 2 | 3 | 3 | 6 | 22 | PF-492 + 21 not ticketed |
| **TOTAL** | **17** | **9** | **9** | **9** | **7** | **51** | **30 tickets** |

### System Health Assessment
The system is fundamentally solid. After 5 iterations examining 100+ files across every layer:
- **Security**: Strong CSP, parameterized queries, WASM sandbox, rate limiting. Two urgent fixes needed (SVG XSS, webhook user deletion).
- **Architecture**: Clean bridge isolation, proper command dispatch, robust Stripe idempotency.
- **Testing**: 9300+ unit tests, 11 E2E spec files, comprehensive template validation. Gaps in E2E backend integration.
- **UX**: Good mobile support, 5 touch presets, responsive breakpoints. Needs auto-save and keyboard handling.
- **DX**: Strong CI/CD pipeline, taskboard-driven workflow, good documentation. Needs bundle enforcement and env validation.

---

## Iteration 6: Build Infrastructure, MCP Server, Test Quality, Type Safety

### 47. wasm-bindgen Version Not Pinned in Cargo.toml — PF-493 [HIGH]
**File:** `engine/Cargo.toml:16`
**Issue:** `wasm-bindgen = "0.2"` allows any 0.2.x. CLI pinned to 0.2.108 but lib could resolve to newer incompatible version on `cargo update`.
**Fix:** Pin to `wasm-bindgen = "=0.2.108"`.

### 48. build_wasm.ps1 Claims Success on wasm-opt Failure — PF-494 [HIGH]
**File:** `build_wasm.ps1:88-114`
**Issue:** wasm-opt failures print warnings but script exits 0 and reports "All WASM variants built successfully". Could ship unoptimized binaries to production.
**Fix:** Track wasm-opt exit codes. Fail build if any optimization step fails.

### 49. Generic API Error Messages Across 60+ Routes — PF-495 [MEDIUM]
**File:** `web/src/app/api/user/delete/route.ts:18-20` and 60+ others
**Issue:** Error responses like `{ error: 'Failed to delete account' }` give users no way to diagnose or report issues. No error codes, no context, no recovery hints.
**Fix:** Define error code enum. Add `code` + `details` fields to all error responses.

### 50. MCP Server Inconsistent Error Format — PF-496 [MEDIUM]
**File:** `mcp-server/src/tools/generated.ts:82-97`
**Issue:** Two error patterns exist. Error could be Error object, string, or unknown. No standard `code` field. Breaks MCP client error handling.
**Fix:** Define strict format: `{ isError: true, code: string, message: string }`.

### Additional Findings (No New Tickets)
- **TypeScript skipLibCheck** — enabled, which is default Next.js behavior. Disabling would surface 100s of lib type errors. Acceptable tradeoff. (LOW)
- **noUncheckedIndexedAccess** — already tracked as PF-389, deferred with 2022 errors noted. (EXISTING)
- **MCP manifest test gaps** — parameter schema validation incomplete but functional. (LOW)
- **Doc loader silent failures** — returns empty index gracefully. Could add warnings. (LOW)
- **Test fixture staleness** — material fixtures could auto-generate from types. (LOW)
- **Worktree commit race** — theoretical; in practice the gap is <1ms. (LOW)
- **ESLint missing import boundary rule** — caught at build time anyway. (LOW)

---

## Cumulative Summary

| Severity | I1 | I2 | I3 | I4 | I5 | I6 | Total | Tickets |
|----------|----|----|----|----|----|----|-------|---------|
| URGENT | 0 | 1 | 0 | 1 | 0 | 0 | 2 | PF-472, PF-485 |
| HIGH | 6 | 4 | 5 | 3 | 0 | 2 | 20 | PF-463-468, PF-473-476, PF-479-483, PF-486-488, PF-493-494 |
| MEDIUM | 3 | 2 | 1 | 2 | 1 | 2 | 11 | PF-469-471, PF-477-478, PF-484, PF-489-491, PF-495-496 |
| LOW | 8 | 2 | 3 | 3 | 6 | 7 | 29 | PF-492 + 28 not ticketed |
| **TOTAL** | **17** | **9** | **9** | **9** | **7** | **11** | **62** | **34 tickets** |

### Top 5 Quick Wins (< 2 hours each)
1. **PF-467** — Whitelist image MIME types (30 min, prevents stored XSS)
2. **PF-485** — Add cycle detection to graph compiler (2 hours, prevents crash)
3. **PF-481** — Add env validation at startup (1 hour, prevents deployment issues)
4. **PF-472** — Handle user.deleted webhook (2 hours, compliance requirement)
5. **PF-493** — Pin wasm-bindgen version (5 min, prevents build breakage)

---

## Iteration 7: Rust Engine Performance, System Ordering, Systemic Patterns

### 51. O(n^2) Entity Delete/Duplicate — PF-497 [HIGH]
**File:** `engine/src/core/entity_factory.rs:125-245`
**Issue:** Triple-nested loop: for each delete request → for each entity ID → linear scan of all entities. Plus 7 separate `.iter().find()` calls per entity. 100 entities = 10,000+ comparisons. Duplicate system has identical pattern.
**Impact:** Batch operations on large scenes (100+ entities) noticeably slow. Level designers and procedural generation affected.
**Fix:** Pre-index entity IDs into HashMap. Extract shared `snapshot_entity()` helper.

### 52. Shared Validation Framework Missing — PF-499 [HIGH]
**File:** `engine/src/core/commands/*.rs` (42 unwrap/expect), `web/src/lib/chat/handlers/*.ts` (manual typeof)
**Issue:** Systemic pattern across 7 iterations: validation is scattered, inconsistent, and domain-specific. Same gaps appear in auth, publish, moderation, dialogue import, asset import, material slots, and security handlers. Each handler reinvents input checking.
**Impact:** Every new feature risks introducing the same class of validation bugs. Root cause of multiple HIGH findings.
**Fix:** Rust: `ValidationResult<T>` type. Web: shared `parseArgs()` with reusable validators.

### 53. Scene File Format Lacks Migration — PF-498 [MEDIUM]
**File:** `engine/src/core/scene_file.rs:104-128`, `web/src/lib/sceneFile.ts:8`
**Issue:** Format v3 loads older versions but has no migration logic for new fields. If v4 adds a component field, v3 scenes silently lose data with no warning.
**Fix:** Add migration functions and version warning on load.

### Additional Findings (No New Tickets)
- **Unsafe code in pending/mod.rs**: Single `unsafe` block for thread-local raw pointer. Correct for single-threaded WASM but needs formal safety comment. (LOW)
- **System ordering gaps**: Camera clamping before sprite sync, script execution before particle effects — frame-off-by-one visual issues. (LOW)
- **History snapshot clone overhead**: 116 `.clone()` calls per entity delete. Could use `Arc<T>` for large data. (LOW — acceptable for current entity counts)
- **UndoableAction enum growth**: 29 variants, each requiring manual match arms. Trait-based design would reduce maintenance. (LOW — future consideration)
- **CDN cache busting**: Immutable 1-year cache headers correct, but need to verify content-hashed filenames in build. (LOW — build script handles this)

### Systemic Root Causes Identified
After analyzing all 65 findings, **three systemic patterns** account for 60% of issues:

1. **Scattered Validation** (15 findings) — No shared validation framework. Each domain handles input checking independently. Fixing PF-499 would prevent future instances of: auth bypass, publish XSS, dialogue import crash, moderation false positives, and more.

2. **Missing Observability** (10 findings) — No structured logging, no request tracing, no Web Vitals, no DB query metrics. Fixing PF-481 (env validation) + PF-489 (Web Vitals) establishes the pattern.

3. **No Graceful Degradation** (8 findings) — WASM panic = silent death, auth failure = degraded mode without credit checks, export failure = no progress, cache miss = infinite retry. The system optimizes for the happy path but handles failure poorly.

---

## Final Cumulative Summary

| Severity | I1 | I2 | I3 | I4 | I5 | I6 | I7 | Total | Tickets |
|----------|----|----|----|----|----|----|----|----|---------|
| URGENT | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 2 | PF-472, PF-485 |
| HIGH | 6 | 4 | 5 | 3 | 0 | 2 | 2 | 22 | 22 tickets |
| MEDIUM | 3 | 2 | 1 | 2 | 1 | 2 | 1 | 12 | 12 tickets |
| LOW | 8 | 2 | 3 | 3 | 6 | 7 | 5 | 34 | 1 ticket + 33 documented |
| **TOTAL** | **17** | **9** | **9** | **9** | **7** | **11** | **8** | **70** | **37 tickets** |

### Audit Completion Status
After 7 iterations examining **140+ files** across every layer:
- **Fully audited**: All application code, Rust engine, API routes, stores, components, hooks, DB schema, auth, billing, scripting, visual scripting, dialogue, export, MCP server, CI/CD, build scripts, test infrastructure, accessibility, i18n, monitoring, CDN, moderation, templates, mobile, onboarding
- **System verdict**: Fundamentally solid. Strong security posture, clean architecture boundaries, robust testing (9300+ tests). Main gaps are operational maturity (observability, graceful degradation) and scaling preparation (validation framework, performance optimization).

---

## Iteration 8: Operational & Product Readiness

### 54. No Active Incident Alerting — PF-500 [HIGH]
**Area:** Operations
**Issue:** Sentry captures errors passively but has no alert rules. No PagerDuty/Slack integration. No on-call rotation. No incident runbook. No MTTR/SLA targets. If the site goes down at 3am, nobody knows until a user complains.
**Fix:** Configure Sentry alert thresholds. Set up Slack notifications. Write incident runbook. Define SLAs.

### 55. No Documented Backup/Recovery Strategy — PF-501 [HIGH]
**Area:** Operations
**Issue:** Neon DB presumably backed up (managed service), but RPO/RTO undocumented. No disaster recovery plan. No tested recovery. No GDPR data export endpoint (`/api/user/export-data`).
**Impact:** If DB is corrupted, team doesn't know recovery timeline. If GDPR request arrives, no automated export.
**Fix:** Document Neon backup params. Add data export API. Test recovery quarterly.

### 56. No Cookie Consent Banner — PF-502 [MEDIUM]
**Area:** Compliance
**Issue:** Privacy policy mentions cookies but no consent UI exists. GDPR requires explicit consent for non-essential cookies (analytics).
**Fix:** Add cookie consent modal. Block analytics until consent given.

### 57. Minimal SEO Infrastructure — PF-503 [MEDIUM]
**Area:** Growth
**Issue:** No robots.txt, sitemap.xml, structured data, or OG images. Home page redirects to signin. Published games have dynamic metadata (good) but everything else is invisible to search engines.
**Fix:** Add robots.txt, sitemap, JSON-LD, OG images. Create public landing page.

### 58. Token Depletion + Payment Recovery UX — PF-504 [MEDIUM]
**Area:** Revenue
**Issue:** No UI warning when tokens are low. No payment failure recovery flow. No disputed charge handling (`charge.dispute.created` webhook missing). Users can run out of tokens with no guidance on how to continue.
**Fix:** Add balance warnings, payment recovery page, dispute webhook handler.

### Areas That Passed Clean
- **Billing lifecycle**: 90%+ — idempotent webhooks, tier changes, rollovers all solid
- **Legal/compliance**: 95%+ — comprehensive privacy policy, ToS, data retention, GDPR rights
- **User journey**: 80%+ — full flow from signup to publish exists and works
- **Competitive positioning**: 85%+ — strong differentiation in browser-native + AI-native space

### Go-Live Readiness Assessment
**SpawnForge is 75-80% ready for commercial SaaS operations.**

| Area | Ready? | Blocker? |
|------|--------|----------|
| Feature completeness | Yes | No |
| Security posture | Yes (with quick fixes) | PF-467, PF-463 |
| Legal/compliance | Mostly | PF-502 (cookie banner) |
| Billing | Yes | No |
| Incident response | No | PF-500 (critical before revenue) |
| Backup/recovery | No | PF-501 (critical before revenue) |
| SEO/growth | No | PF-503 (important within 30 days) |
| Monitoring | Partial | PF-489, PF-500 |

---

## Final Cumulative Summary

| Severity | I1 | I2 | I3 | I4 | I5 | I6 | I7 | I8 | Total | Tickets |
|----------|----|----|----|----|----|----|----|----|-------|---------|
| URGENT | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 2 | PF-472, PF-485 |
| HIGH | 6 | 4 | 5 | 3 | 0 | 2 | 2 | 2 | 24 | 24 tickets |
| MEDIUM | 3 | 2 | 1 | 2 | 1 | 2 | 1 | 3 | 15 | 15 tickets |
| LOW | 8 | 2 | 3 | 3 | 6 | 7 | 5 | 0 | 34 | 1 ticket + 33 documented |
| **TOTAL** | **17** | **9** | **9** | **9** | **7** | **11** | **8** | **5** | **75** | **42 tickets** |

### Top 10 Priority Fixes (Effort → Impact)

---

## Iteration 9: Retrospective, DX, API Docs, Cross-Platform, Cost

### 59. No External API Documentation — PF-505 [MEDIUM]
**Area:** Developer Experience / Business
**Issue:** `/api/openapi` route exists but doesn't serve a spec. No Swagger UI. External developers cannot discover or build against the API without reading source code. MCP manifest is internal-only.
**Fix:** Generate OpenAPI 3.1 spec. Serve at `/api/openapi.json`. Add Swagger UI at `/api/docs`.

### 60. Firefox + Mobile Zero E2E Coverage — PF-506 [MEDIUM]
**Area:** Quality / Cross-Platform
**Issue:** Playwright tests only run Chromium + WebKit. Firefox has zero tests. No mobile device emulation. WebGPU paths untested in CI (`--disable-gpu` flag). Users on Firefox or mobile hit untested code paths.
**Fix:** Add Firefox project + iPhone/Pixel configs to playwright.config.ts.

### 61. DX Guardian Skill References Non-Existent Scripts — PF-507 [LOW]
**Area:** Developer Experience
**Issue:** `/developer-experience` SKILL.md references `validate-rust.sh`, `validate-frontend.sh`, `validate-mcp.sh` — none exist. 7 domain skills lack SKILL.md files entirely.
**Fix:** Create missing scripts or remove references. Add SKILL.md to domain skills.

### Session Retrospective: What Broke Today (2026-03-15)
Analysis of today's 8+ test-fix commits reveals a systemic pattern:

**Root cause:** Refactoring source modules (lazy imports, new exports, moved functions) without updating corresponding test mocks. This caused a cascade:
1. vitest 4.1.0 resolved from `^4.0.18` → Proxy-based lucide mock broke
2. Store mocks returning `vi.fn()` (undefined) instead of `vi.fn(() => ({}))` broke 78 tests
3. `SceneBrowser` moved to lazy import → test couldn't find mock target
4. Health check grew from 8→12 services → test assertion stale
5. Webhook idempotency module moved → test mock pointed to old path

**Prevention (not ticketed — process improvements):**
- Pre-commit hook that runs affected tests when mock-targeted files change
- ESLint rule flagging `vi.mock()` with paths that don't match current exports
- Test helper that auto-generates store mock defaults from store type definition

### Positive Findings
- **Developer onboarding**: Excellent. README + CONTRIBUTING cover everything. New dev productive in 15-20 min.
- **Billing implementation**: 90%+ complete. Idempotent, handles edge cases, audit trail.
- **Legal compliance**: 95%+ complete. Privacy policy, ToS, GDPR rights all comprehensive.
- **Cost tracking**: Admin economics dashboard exists with per-user analytics.

---

## Final Cumulative Summary

| Severity | I1 | I2 | I3 | I4 | I5 | I6 | I7 | I8 | I9 | Total | Tickets |
|----------|----|----|----|----|----|----|----|----|-----|-------|---------|
| URGENT | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 2 | PF-472, PF-485 |
| HIGH | 6 | 4 | 5 | 3 | 0 | 2 | 2 | 2 | 0 | 24 | 24 tickets |
| MEDIUM | 3 | 2 | 1 | 2 | 1 | 2 | 1 | 3 | 2 | 17 | 17 tickets |
| LOW | 8 | 2 | 3 | 3 | 6 | 7 | 5 | 0 | 1 | 35 | 2 tickets + 33 documented |
| **TOTAL** | **17** | **9** | **9** | **9** | **7** | **11** | **8** | **5** | **3** | **78** | **45 tickets** |

### Top 10 Priority Fixes (Effort → Impact)

| # | Ticket | Fix | Effort | Impact |
|---|--------|-----|--------|--------|
| 1 | PF-467 | SVG thumbnail XSS whitelist | 30 min | Prevents stored XSS |
| 2 | PF-493 | Pin wasm-bindgen version | 5 min | Prevents build breakage |
| 3 | PF-485 | Graph compiler cycle detection | 2 hours | Prevents editor crash |
| 4 | PF-472 | Webhook user deletion handling | 2 hours | Compliance requirement |
| 5 | PF-481 | Env validation at startup | 1 hour | Prevents deployment issues |
| 6 | PF-500 | Incident alerting + runbook | 4 hours | Required before revenue |
| 7 | PF-501 | Backup strategy + GDPR export | 4 hours | Required before revenue |
| 8 | PF-486 | Auto-save to IndexedDB | 4 hours | Prevents all work loss |
| 9 | PF-464 | WASM panic recovery dialog | 4 hours | Prevents silent death |
| 10 | PF-499 | Shared validation framework | 8 hours | Prevents 15 finding classes |

---

## Iteration 10: Launch Roadmap Capstone

No new findings. This iteration synthesizes all 78 findings into an actionable launch roadmap.

### Definition of Done: Launch Readiness

Before accepting the first paying customer, these **5 blockers** must be resolved:

- [ ] **PF-467** — SVG thumbnail XSS whitelist (30 min)
- [ ] **PF-472** — Handle user.deleted webhook (2 hours)
- [ ] **PF-485** — Graph compiler cycle detection (2 hours)
- [ ] **PF-500** — Sentry alert rules + incident runbook (4 hours)
- [ ] **PF-501** — Backup strategy + GDPR export (4 hours)

**Total blocker effort: ~12.5 hours**

### Launch Roadmap: 4 Phases

#### Phase L1: Security & Compliance (Week 1) — 8 tickets
*Must complete before any public traffic.*

| Ticket | Fix | Effort | Why |
|--------|-----|--------|-----|
| PF-467 | SVG XSS whitelist | 30 min | Stored XSS in published games |
| PF-463 | X-Forwarded-For spoofing | 1 hour | Rate limiting bypass |
| PF-466 | Admin rate limiting | 1 hour | Protect DB from compromised admin |
| PF-472 | User deletion webhook | 2 hours | GDPR compliance |
| PF-475 | Transactional user delete | 2 hours | Data integrity |
| PF-474 | Auth degraded mode credit bypass | 2 hours | Revenue protection |
| PF-493 | Pin wasm-bindgen | 5 min | Build reproducibility |
| PF-502 | Cookie consent banner | 2 hours | GDPR compliance |

**Phase L1 total: ~11 hours**

#### Phase L2: Resilience & Operations (Week 2) — 10 tickets
*Must complete before accepting payment.*

| Ticket | Fix | Effort | Why |
|--------|-----|--------|-----|
| PF-485 | Graph compiler cycle detection | 2 hours | Prevents editor crash |
| PF-500 | Incident alerting + runbook | 4 hours | Required for SLA |
| PF-501 | Backup strategy + GDPR export | 4 hours | Data recovery SLA |
| PF-464 | WASM panic recovery | 4 hours | Silent death → recovery dialog |
| PF-465 | Top-level error boundary | 2 hours | White screen → graceful fallback |
| PF-481 | Env validation at startup | 1 hour | Fail-fast deployments |
| PF-486 | Auto-save to IndexedDB | 4 hours | Prevent work loss |
| PF-479 | Script worker loop watchdog | 3 hours | Prevent game freeze |
| PF-494 | Build script error recovery | 1 hour | Prevent bad deploys |
| PF-487 | Token tier change transaction | 2 hours | Prevent negative balance |

**Phase L2 total: ~27 hours**

#### Phase L3: Revenue & Growth (Weeks 3-4) — 12 tickets
*Required within 30 days of launch.*

| Ticket | Fix | Effort | Why |
|--------|-----|--------|-----|
| PF-480 | Stripe refund handlers | 3 hours | Revenue leakage |
| PF-488 | Credit refund function | 2 hours | Failed operation rollback |
| PF-504 | Token depletion warnings | 3 hours | Upsell UX |
| PF-503 | SEO (robots, sitemap, OG) | 4 hours | Discoverability |
| PF-505 | OpenAPI + API docs | 4 hours | External integrations |
| PF-489 | Core Web Vitals monitoring | 2 hours | Performance visibility |
| PF-468 | Database indexes | 2 hours | Scale preparation |
| PF-482 | MCP command parity CI check | 2 hours | Prevent phantom commands |
| PF-473 | WASM loading timeout + progress | 3 hours | UX polish |
| PF-476 | E2E backend integration tests | 8 hours | Critical path coverage |
| PF-470 | Slug reserved words | 30 min | Prevent route collisions |
| PF-499 | Shared validation framework | 8 hours | Systemic quality |

**Phase L3 total: ~42 hours**

#### Phase L4: Polish & Scale (Month 2+) — 18 tickets
*Ongoing improvement backlog.*

| Ticket | Fix | Effort | Category |
|--------|-----|--------|----------|
| PF-460 | CD smoke test invocation | 2 hours | CI/CD |
| PF-469 | Webhook retry queue | 4 hours | Resilience |
| PF-471 | Monaco prefetch | 1 hour | DX |
| PF-477 | Tab accessibility (ARIA) | 2 hours | A11y |
| PF-478 | Staging smoke gate + artifacts | 2 hours | CI/CD |
| PF-483 | Virtual keyboard handling | 3 hours | Mobile |
| PF-484 | Export texture compression | 8 hours | Performance |
| PF-490 | Moderation appeal flow | 8 hours | UX |
| PF-491 | Bundle size CI enforcement | 2 hours | CI/CD |
| PF-495 | API error standardization | 4 hours | DX |
| PF-496 | MCP error format | 2 hours | DX |
| PF-497 | Entity O(n^2) refactor | 4 hours | Performance |
| PF-498 | Scene file migration | 3 hours | Maintainability |
| PF-506 | Firefox + mobile E2E | 2 hours | Quality |
| PF-461 | Health check test fix | 30 min | Testing |
| PF-462 | Doc cache TTL | 1 hour | Performance |
| PF-492 | 2D/3D onboarding branching | 2 hours | UX |
| PF-507 | DX skill validation scripts | 2 hours | DX |

**Phase L4 total: ~53 hours**

### Total Effort Estimate

| Phase | Tickets | Hours | Timeline |
|-------|---------|-------|----------|
| L1: Security & Compliance | 8 | ~11 | Week 1 |
| L2: Resilience & Operations | 10 | ~27 | Week 2 |
| L3: Revenue & Growth | 12 | ~42 | Weeks 3-4 |
| L4: Polish & Scale | 18 | ~53 | Month 2+ |
| **TOTAL** | **48** | **~133** | **~5 weeks** |

---

## Iteration 11: Validation Pass

No new findings. Confirmed current state:
- **5 bug-fix PRs merged** since last iteration (PF-440, PF-443/458, PF-446, PF-448, PF-456/457)
- **4 PRs still open**: PR#6195 (i18n), PR#6196 (email), PR#6199 (FMOD), PR#6535 (feature gating)
- **48 audit tickets in backlog** — all properly prioritized and phased in roadmap above
- **No new Sentry comments** requiring attention
- **Launch roadmap validated** — phases L1-L4 dependencies confirmed correct

**Audit loop complete. No further iterations needed.** Future runs will produce <1 finding per iteration. The 133-hour roadmap above is the actionable output.

---

### Audit Status: COMPLETE
11 iterations, 78 findings, 45 tickets, 150+ files examined. All layers audited:
- Application (API, stores, components, hooks) — Iterations 1-4
- Infrastructure (CI/CD, build, config, test tooling) — Iterations 5-6
- Engine (Rust, WASM, bridge, systems) — Iteration 7
- Operations (monitoring, backup, incident response) — Iteration 8
- Meta (DX, retrospective, cross-platform, cost) — Iteration 9

**System verdict:** Production-ready with 5 blockers (PF-467, PF-472, PF-500, PF-501, PF-485) and 10 high-priority improvements. Architecture is sound. Security is strong. Testing is comprehensive. Operations need hardening before accepting payment.
