# web

## 0.2.0

### Minor Changes

- [#8163](https://github.com/Tristan578/project-forge/pull/8163) [`d9e0f22`](https://github.com/Tristan578/project-forge/commit/d9e0f22dddde2b733f0792ffef1077fa6932306b) Thanks [@Tristan578](https://github.com/Tristan578)! - Adopt Changesets for automated versioning, changelog generation, and release management across the monorepo.

- [#8273](https://github.com/Tristan578/project-forge/pull/8273) [`f0207ce`](https://github.com/Tristan578/project-forge/commit/f0207ce25771b9a4cdfb8fb316e36505060a9ba9) Thanks [@Tristan578](https://github.com/Tristan578)! - Add `useAIGeneration` hook for abort/cancel support in AI generation dialogs. All 7 Generate dialogs (Texture, Sprite, Sound, Music, Skybox, Model, PixelArt) now cancel in-flight requests when closed or unmounted, preventing leaked network requests and double-submission. Includes 11 unit tests for the hook.

- [#8262](https://github.com/Tristan578/project-forge/pull/8262) [`6c9c3a1`](https://github.com/Tristan578/project-forge/commit/6c9c3a1dca4a8ac2af9d0bdf34fc4f261b7a04be) Thanks [@Tristan578](https://github.com/Tristan578)! - Make creditTransactions inserts idempotent under retry with unique index and onConflictDoNothing. Add WASM CDN redundancy: fetchWithRetry with exponential backoff, same-origin fallback from Vercel static assets, retry button on InitOverlay error state, and PostHog/Sentry monitoring for CDN fallback events.

- [#8271](https://github.com/Tristan578/project-forge/pull/8271) [`16fce1b`](https://github.com/Tristan578/project-forge/commit/16fce1b56b1390c165ea790cad67565b5d4dbc0e) Thanks [@Tristan578](https://github.com/Tristan578)! - Canvas keyboard shortcuts (W/E/R gizmo modes, Delete, Ctrl+D duplicate, Ctrl+Z/Shift+Z undo/redo, F focus, Escape deselect/stop) are now registered in the keybindings registry and rebindable via the Keyboard Shortcuts panel. Added context field to distinguish canvas-only from global shortcuts. Includes ARIA attributes, focus management, and paused-mode regression fix.

- [#8260](https://github.com/Tristan578/project-forge/pull/8260) [`74125c1`](https://github.com/Tristan578/project-forge/commit/74125c1c15f8f4668cf71c5fd767b4b12a2bd76b) Thanks [@Tristan578](https://github.com/Tristan578)! - Add DB connection resilience infrastructure: wrap all 48+ raw getDb() callsites with queryWithResilience (circuit breaker + retry), add Upstash sliding-window DB rate limiter, 503 graceful degradation handler, client-side 503 toast with auto-retry, health endpoint circuit breaker stats. Fix P1 quick wins: silent Redis fallback now reports to Sentry, tsc OOM on Node 25.x, single-HTML export CDN failure, export scene data completeness.

- [#8268](https://github.com/Tristan578/project-forge/pull/8268) [`0e8ea23`](https://github.com/Tristan578/project-forge/commit/0e8ea23eaf7592e33e5acfa56ac093f463714157) Thanks [@Tristan578](https://github.com/Tristan578)! - 3D viewport is now keyboard-navigable: focusable canvas with ARIA attributes, W/E/R gizmo modes, Delete/Backspace, Ctrl+D duplicate, Ctrl+Z/Ctrl+Shift+Z undo/redo, F focus, Escape deselect/stop. Paused mode now correctly blocks edit shortcuts.

- [#8274](https://github.com/Tristan578/project-forge/pull/8274) [`1b5a3f6`](https://github.com/Tristan578/project-forge/commit/1b5a3f68b37267177578c1374493f45748a84f7f) Thanks [@Tristan578](https://github.com/Tristan578)! - Add tier-based access control for AI generation panels. Hobbyist+ can generate textures, sounds, music, sprites, and pixel art. Creator+ can generate 3D models and skyboxes. Locked panels show a Lock icon with the required tier label.

### Patch Changes

- [#8296](https://github.com/Tristan578/project-forge/pull/8296) [`d584b8f`](https://github.com/Tristan578/project-forge/commit/d584b8faa77e08a7b9b7f328c3dd3adf84339555) Thanks [@Tristan578](https://github.com/Tristan578)! - Thread AbortSignal through export pipeline for reliable cancel support

- [#8272](https://github.com/Tristan578/project-forge/pull/8272) [`eed590c`](https://github.com/Tristan578/project-forge/commit/eed590c189d06227eaf2b1ce23a7294553856c39) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix anti-patterns found during codebase audit: replace `Number() ||` with `Number.isFinite()` guard in save system generator, fix `volume || 1.0` to `volume ?? 1.0` in audio crossfade/fadeIn, correct non-existent `forge.ui` API names in generated scripts, replace invalid `forge.on()` with `onStart` lifecycle.

- [#8168](https://github.com/Tristan578/project-forge/pull/8168) [`4d89c49`](https://github.com/Tristan578/project-forge/commit/4d89c493edb4255c6e7a7ee6ece97c82ef9ce127) Thanks [@Tristan578](https://github.com/Tristan578)! - Standardize API route auth/rate-limit pipeline via withApiMiddleware. Migrate 52 route files from raw authenticateRequest to centralized middleware. Add ESLint enforcement rule.

- [#8165](https://github.com/Tristan578/project-forge/pull/8165) [`25e2b56`](https://github.com/Tristan578/project-forge/commit/25e2b56bd2d499884ee8a4355f491683c52637af) Thanks [@Tristan578](https://github.com/Tristan578)! - Centralize hardcoded constants: migrate remaining timeout, provider, and scope consumers to shared config modules. Adds 7 new timeout constants, wires magic-constants check into pre-push hook, and replaces hardcoded provider strings across 10+ API routes with DB_PROVIDER/DIRECT_CAPABILITY_PROVIDER imports.

- [#8297](https://github.com/Tristan578/project-forge/pull/8297) [`b69c3c4`](https://github.com/Tristan578/project-forge/commit/b69c3c4b0afb1807918d4e0e271f79c5085b6b21) Thanks [@Tristan578](https://github.com/Tristan578)! - Add chat executor integration test covering tool-to-handler-to-store flow

- [#8170](https://github.com/Tristan578/project-forge/pull/8170) [`f3ef640`](https://github.com/Tristan578/project-forge/commit/f3ef640713ece0a3f1ea18ec796cb75d9dd5cf90) Thanks [@Tristan578](https://github.com/Tristan578)! - Use atomic UPDATE...WHERE...RETURNING guards to eliminate TOCTOU race conditions in token deductions. Add CTE-based idempotency guards for refund operations with accurate return semantics. Fix `||` vs `??` for priceTokens default in marketplace route.

- [#8171](https://github.com/Tristan578/project-forge/pull/8171) [`d078cd6`](https://github.com/Tristan578/project-forge/commit/d078cd6f24c654599f7d54e9fa387eac1dc44e19) Thanks [@Tristan578](https://github.com/Tristan578)! - Add ESLint rule `spawnforge/no-hardcoded-primitives` to detect hardcoded Tailwind color scale classes that should use CSS custom property design tokens. Rule is currently set to `off` (~3988 baseline violations); enable per-directory as files are migrated.

- [#8329](https://github.com/Tristan578/project-forge/pull/8329) [`e4748d9`](https://github.com/Tristan578/project-forge/commit/e4748d9dfd30cf476f6c0e9d7b995f56ba0f8c17) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix stale selectedEntityId when AI auto-iteration spawns multiple game-component entities in one batch

- [#8286](https://github.com/Tristan578/project-forge/pull/8286) [`3cd6336`](https://github.com/Tristan578/project-forge/commit/3cd633672c889112add84195ac23cd9107e16c6d) Thanks [@Tristan578](https://github.com/Tristan578)! - Add global focus-visible ring for keyboard navigation accessibility (WCAG 2.4.7)

- [#8328](https://github.com/Tristan578/project-forge/pull/8328) [`afd1665`](https://github.com/Tristan578/project-forge/commit/afd1665b9b5ac6e81e9bd8b791a709f26fdb1a35) Thanks [@Tristan578](https://github.com/Tristan578)! - Add F6/Shift+F6 keyboard navigation to cycle focus between editor regions (Sidebar, Scene Hierarchy, Canvas, Inspector). Standard IDE pattern for panel navigation. Includes WCAG landmark regions and focus-visible indicators.

- [#8326](https://github.com/Tristan578/project-forge/pull/8326) [`cf29d4f`](https://github.com/Tristan578/project-forge/commit/cf29d4f2955f306e0a3fa31834931981b74655c4) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix marketplace purchase test mocks to match withApiMiddleware refactor and correct changeset package names for Release workflow.

- [#8333](https://github.com/Tristan578/project-forge/pull/8333) [`4018e2e`](https://github.com/Tristan578/project-forge/commit/4018e2e5d9cb9c1b3dfc1bcd602b764442903099) Thanks [@Tristan578](https://github.com/Tristan578)! - Bump Next.js minimum from 16.2.2 to 16.2.3 to patch CVE-2026-23869 (high-severity DoS via React Server Components, CVSS 7.5)

- [#8231](https://github.com/Tristan578/project-forge/pull/8231) [`63c9e38`](https://github.com/Tristan578/project-forge/commit/63c9e383763658686115c7630647adbf3b23c769) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix P0 production blockers batch 1: update all AI model references to claude-\*-4-6, consolidate hardcoded token costs into pricing.ts, add leaderboard management API routes (create/list/configure/delete), close leaderboard dedup TOCTOU (already fixed via atomic CTE).

- [#8267](https://github.com/Tristan578/project-forge/pull/8267) [`a350093`](https://github.com/Tristan578/project-forge/commit/a350093e3d2635657fd040880e1496c5470ab39a) Thanks [@Tristan578](https://github.com/Tristan578)! - DB circuit breaker now emits Sentry breadcrumbs and alerts on state transitions (open/half-open/closed) for incident response observability

- [#8264](https://github.com/Tristan578/project-forge/pull/8264) [`162045e`](https://github.com/Tristan578/project-forge/commit/162045e03dce5fd75552001834c4deef9bae9e8c) Thanks [@Tristan578](https://github.com/Tristan578)! - Add Sentry alerting on circuit breaker state transitions ([#8244](https://github.com/Tristan578/project-forge/issues/8244)), document DB resilience and CDN fallback patterns in gotchas.md ([#8245](https://github.com/Tristan578/project-forge/issues/8245), [#8251](https://github.com/Tristan578/project-forge/issues/8251))

- [#8263](https://github.com/Tristan578/project-forge/pull/8263) [`da783c0`](https://github.com/Tristan578/project-forge/commit/da783c03f4916341e75913aa5585723c0063cdfe) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix P1 issues: add Sentry alerting on Upstash rate limit fallback ([#8210](https://github.com/Tristan578/project-forge/issues/8210)), throw user-visible error when WASM files unavailable for single-HTML export ([#8186](https://github.com/Tristan578/project-forge/issues/8186)), reject export with clear error on engine timeout instead of producing unplayable shell ([#8185](https://github.com/Tristan578/project-forge/issues/8185))

- [#8232](https://github.com/Tristan578/project-forge/pull/8232) [`966958e`](https://github.com/Tristan578/project-forge/commit/966958e3b93d257b0edd16515a86a66a40a6ec6f) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix Stripe refund TOCTOU race condition, add server-side AI tier gate, improve chat/editor UX

  - Eliminate double-credit race in token refund deduction using CTE-based atomic SQL
  - Add server-side starter tier block on /api/chat (was client-only)
  - Show upgrade prompt for free-tier users in chat panel
  - Add retry button on chat errors
  - Hide canvas black rectangle during engine initialization
  - Show browser/GPU requirements on WASM load failure
  - Show 'Empty scene' guidance for first-time users
  - Fix sprite-sheet status route for client-side imports

- [#8265](https://github.com/Tristan578/project-forge/pull/8265) [`c5d276f`](https://github.com/Tristan578/project-forge/commit/c5d276fb9e4c66394d5f83e00b4de259f10a0b46) Thanks [@Tristan578](https://github.com/Tristan578)! - UX fixes: Export dialog cancel button works during export, WelcomeModal tutorial validates data before starting, CanvasArea init appearance improved, InitOverlay adds Retry button on errors and ARIA alerts, Inspector shows loading hint during WASM init

- [#8276](https://github.com/Tristan578/project-forge/pull/8276) [`ec0dbb7`](https://github.com/Tristan578/project-forge/commit/ec0dbb7ca09e6ba2668e5c4cc2059eb82c34f947) Thanks [@Tristan578](https://github.com/Tristan578)! - Thread AbortSignal through export pipeline for reliable cancel. Warn when procedural animation uses default humanoid bone names on non-humanoid models. Bump @anthropic-ai/sdk to ^0.82.0 (Dependabot [#46](https://github.com/Tristan578/project-forge/issues/46)). Fix marketplace review route test.

- [#8277](https://github.com/Tristan578/project-forge/pull/8277) [`2ea615f`](https://github.com/Tristan578/project-forge/commit/2ea615f0353e50bc207345a7c8f1c39712b6501a) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix autoIteration spawn_entity payloads to use correct engine entityType format. Wire multiplayer async channel with stub methods and clear error message. Add global prefers-reduced-motion CSS support for all animations/transitions.

- [#8278](https://github.com/Tristan578/project-forge/pull/8278) [`afc3e35`](https://github.com/Tristan578/project-forge/commit/afc3e35261250f4ee9c3a82c43dd427e0e818a75) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix set_export_preset MCP command to persist preset to store ([#8209](https://github.com/Tristan578/project-forge/issues/8209)), AutoIterationPanel now reads entities from scene graph ([#8205](https://github.com/Tristan578/project-forge/issues/8205)), and global focus-visible indicators for keyboard navigation ([#8214](https://github.com/Tristan578/project-forge/issues/8214))

- [#8279](https://github.com/Tristan578/project-forge/pull/8279) [`3e64a6f`](https://github.com/Tristan578/project-forge/commit/3e64a6fe382e7acfdca93e544f6bc95b74095c82) Thanks [@Tristan578](https://github.com/Tristan578)! - fix: wire AccessibilityPanel toggles to engine and add tests for 9 untested lib files

  - AccessibilityPanel: colorblind simulation now applies CSS filter to game canvas,
    screen reader/input remapping settings persist to Zustand store, input remappings
    dispatch set_input_binding to engine ([#8207](https://github.com/Tristan578/project-forge/issues/8207))
  - Tests: cloudSave, userMessages, chat/search, constants, perf/baselines,
    wasm/preloadHint, pacingAnalyzer, executor shared helpers, sandboxGlobals ([#8218](https://github.com/Tristan578/project-forge/issues/8218))

- [#8275](https://github.com/Tristan578/project-forge/pull/8275) [`c74c8eb`](https://github.com/Tristan578/project-forge/commit/c74c8ebf7b69e188f149677ec624699a63c9c3c6) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix set_export_preset MCP command to return success with preset details instead of unconditional failure. Fix AutoIterationPanel crash iterating sceneGraph shape. Fix applyFixes dispatch format to match engine's expected `{ entityId, componentType, properties }` payload. Add WelcomeModal private-browsing resilience test.

- [#8283](https://github.com/Tristan578/project-forge/pull/8283) [`dd0d694`](https://github.com/Tristan578/project-forge/commit/dd0d6940120c287c05d8cf3a391fb8075e8e7347) Thanks [@Tristan578](https://github.com/Tristan578)! - P3 quick wins: timing-safe cron auth, remove unused fast-xml-parser, ADMIN_USER_IDS startup validation, fix dangling TODO reference

- [#8298](https://github.com/Tristan578/project-forge/pull/8298) [`8b3b59c`](https://github.com/Tristan578/project-forge/commit/8b3b59c34391df71b6948f6f20d41a2cab58a64d) Thanks [@Tristan578](https://github.com/Tristan578)! - Add custom bone input and default bone warning to procedural animation panel. Users can now paste bone names for GLTF models instead of being locked to hardcoded humanoid defaults.

- [#8285](https://github.com/Tristan578/project-forge/pull/8285) [`caaebaa`](https://github.com/Tristan578/project-forge/commit/caaebaa101641a857af907f14cf3c877d39f0859) Thanks [@Tristan578](https://github.com/Tristan578)! - Add global prefers-reduced-motion support — disables all animations and transitions for users with OS motion preference enabled

- [#8257](https://github.com/Tristan578/project-forge/pull/8257) [`aff4651`](https://github.com/Tristan578/project-forge/commit/aff4651a49b9ede802f7be9e4b27a139ee1857b2) Thanks [@Tristan578](https://github.com/Tristan578)! - Regression tests for Copilot/Sentry findings and PR metadata enforcement hook

- [#8292](https://github.com/Tristan578/project-forge/pull/8292) [`837daea`](https://github.com/Tristan578/project-forge/commit/837daeab7d95217f5862e244fbaf1440bdc350c9) Thanks [@Tristan578](https://github.com/Tristan578)! - Replace window.confirm() with accessible ConfirmDialog across 7 editor components

- [#8334](https://github.com/Tristan578/project-forge/pull/8334) [`393aaab`](https://github.com/Tristan578/project-forge/commit/393aaabd2c15799198f4a2304bb29ccdf9ed9a32) Thanks [@Tristan578](https://github.com/Tristan578)! - Bump Clerk 7.0.12, Sentry 10.48.0, PostHog 1.367.0, AI SDK 6.0.156/React 3.0.158/Anthropic 3.0.68/Gateway 3.0.95, Vitest 4.1.4

- [#8280](https://github.com/Tristan578/project-forge/pull/8280) [`7ddfa24`](https://github.com/Tristan578/project-forge/commit/7ddfa248b501333ded9ee731fb949c84a2ee09b5) Thanks [@Tristan578](https://github.com/Tristan578)! - Add explicit return types to DB client functions and replace Record<string, unknown> with typed SceneSettings interface

- [#8287](https://github.com/Tristan578/project-forge/pull/8287) [`c47b3e7`](https://github.com/Tristan578/project-forge/commit/c47b3e7c871619cf99b26682e9103e6ab395c47e) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix WelcomeModal crash in private browsing by wrapping localStorage access in try/catch

- [#8335](https://github.com/Tristan578/project-forge/pull/8335) [`cf2beda`](https://github.com/Tristan578/project-forge/commit/cf2bedaea8327388f8f4601a53d426fda3924439) Thanks [@Tristan578](https://github.com/Tristan578)! - Migrate API routes to Zod validation via `withApiMiddleware(validate: schema)`. Replaces manual `parseJsonBody`/`requireString`/`requireObject` helpers in 8 routes (feedback, publish, projects/[id] PUT, marketplace/seller POST+PATCH, community comment, keys/[provider] PUT, user/profile PUT). Validation failures now return 422 `VALIDATION_ERROR` (standards-compliant) instead of 400. JSON parse errors remain 400. Lenient legacy behavior preserved in publish route (thumbnail/tags accept junk values via `z.unknown()` for backward compat).

- Updated dependencies [[`d9e0f22`](https://github.com/Tristan578/project-forge/commit/d9e0f22dddde2b733f0792ffef1077fa6932306b), [`bf3bc88`](https://github.com/Tristan578/project-forge/commit/bf3bc889f97d10ed00567d060acc96b869e73d13), [`93caaa9`](https://github.com/Tristan578/project-forge/commit/93caaa9519a8c9ace393baf3b4d6f088e4a02016), [`0b87885`](https://github.com/Tristan578/project-forge/commit/0b878859a7ed59a399aa14c23d783c2e3bd5e9aa), [`b17dfbc`](https://github.com/Tristan578/project-forge/commit/b17dfbcacdf5ab08abf00991fe30449ee6dd7af7)]:
  - @spawnforge/ui@0.2.0
