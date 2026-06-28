# web

## 0.3.0

### Minor Changes

- [#8862](https://github.com/Tristan578/project-forge/pull/8862) [`c35c8c2`](https://github.com/Tristan578/project-forge/commit/c35c8c2769e3ffc1b6217deb5a9e028dbc40a250) Thanks [@Tristan578](https://github.com/Tristan578)! - ai: bump the premium/deep model tier from Opus 4.7 to Opus 4.8.

  `AI_MODEL_PREMIUM` / `GATEWAY_MODEL_PREMIUM` (and the `AI_MODEL_DEEP` / `GATEWAY_MODEL_DEEP` aliases that follow them) now resolve to `claude-opus-4-8`, so the premium chat path and the deep-generation tier (GDD, world builder, cutscene — gated behind `NEXT_PUBLIC_USE_DEEP_GENERATION`) route to Opus 4.8. Same `$5/$25` per-1M pricing and 1M context as 4.7; no API or env changes.

  Also updates the Vercel AI Gateway `MODEL_MAP` key so the gateway premium lookup resolves the new id (a stale key would have silently downgraded the premium path to Sonnet _after_ billing at the premium tier).

### Patch Changes

- [#8850](https://github.com/Tristan578/project-forge/pull/8850) [`3a09639`](https://github.com/Tristan578/project-forge/commit/3a096391230e07aef59532510e7c8bacb6ba65da) Thanks [@Tristan578](https://github.com/Tristan578)! - ci: retry `changeset version` in the Release workflow so a transient GitHub GraphQL flake no longer fires a spurious "Run Failed" notification.

  The changelog generator (`@changesets/changelog-github`) fetches PR/author info from the GitHub GraphQL API per changeset; under load that request intermittently fails with `Invalid response body ... Premature close`, aborting the Version Packages job even though the release itself is unaffected. The `changeset:version` npm script now runs `scripts/changeset-version.sh`, which retries `changeset version` (changesets applies no files on that error, so a re-run is idempotent) before relocking — keeping the changelog's PR links while making the step resilient to the flake. Complements the per-job concurrency fix in [#8849](https://github.com/Tristan578/project-forge/issues/8849).

- [#8849](https://github.com/Tristan578/project-forge/pull/8849) [`f710a53`](https://github.com/Tristan578/project-forge/commit/f710a5328e606c84daf68f39b0c3334c69a584d9) Thanks [@Tristan578](https://github.com/Tristan578)! - ci: scope the Release workflow's concurrency per-job so a rapid batch-merge no longer fires transient "Run Failed" notifications.

  The `Version Packages` job now uses `cancel-in-progress: true` (it is idempotent — it only recreates `changeset-release/main` from current main — so only the latest run is needed), while `Tag and Release` keeps `cancel-in-progress: false` so a version's git tag / GitHub Release is never cancelled mid-publish. Previously a single workflow-level `cancel-in-progress: false` ran every push in a batch to completion, multiplying the chance of the benign "No commits between main and changeset-release/main" error (when a version PR merges with no newer changesets) and `@changesets/get-github-info` GraphQL flakes.

## 0.2.1

### Patch Changes

- [#8841](https://github.com/Tristan578/project-forge/pull/8841) [`de56112`](https://github.com/Tristan578/project-forge/commit/de5611213ff359e62215e5c557f1ecf0a5cb3fdf) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix WASM `unreachable` editor crash: guard LOD mesh-simplify against out-of-range / non-multiple-of-3 index buffers from imported meshes ([#8462](https://github.com/Tristan578/project-forge/issues/8462))

- [#8844](https://github.com/Tristan578/project-forge/pull/8844) [`7917dcc`](https://github.com/Tristan578/project-forge/commit/7917dcc4ac8cce166afe867334e172310f66b337) Thanks [@Tristan578](https://github.com/Tristan578)! - Add the `setup_game_from_description` compound chat tool that deterministically scaffolds a complete, immediately-playable game (project type, environment, player with controller + health, enemies, collectible coins, a goal with a win condition, ground, input preset, and camera-follow script) from a plain-text description, with optional parallel asset generation ([#8541](https://github.com/Tristan578/project-forge/issues/8541)).

- [#8842](https://github.com/Tristan578/project-forge/pull/8842) [`408cc1f`](https://github.com/Tristan578/project-forge/commit/408cc1fc332a31baeef6429affde17831f7c7402) Thanks [@Tristan578](https://github.com/Tristan578)! - import_gltf now accepts an optional targetEntityId to replace an existing entity's model in place (preserving its id, transform, name, and selection) instead of always spawning a new entity; generated 3D models now land on their placeholder ([#8545](https://github.com/Tristan578/project-forge/issues/8545))

- [#8843](https://github.com/Tristan578/project-forge/pull/8843) [`5b6a5fd`](https://github.com/Tristan578/project-forge/commit/5b6a5fdacc02da8d4a2e4f27088f6bba5fbe39ba) Thanks [@Tristan578](https://github.com/Tristan578)! - Steer the chat agent to orchestrate the AI generation tools (generate_3d_model / generate_texture / generate_music / generate_skybox) in the correct game-creation order — idea, generate assets, spawn, script, win condition, playtest — so character-led prompts queue real generated assets instead of bare primitives ([#8546](https://github.com/Tristan578/project-forge/issues/8546))

## 0.2.0

### Minor Changes

- [#8163](https://github.com/Tristan578/project-forge/pull/8163) [`d9e0f22`](https://github.com/Tristan578/project-forge/commit/d9e0f22dddde2b733f0792ffef1077fa6932306b) Thanks [@Tristan578](https://github.com/Tristan578)! - Adopt Changesets for automated versioning, changelog generation, and release management across the monorepo.

- [#8273](https://github.com/Tristan578/project-forge/pull/8273) [`f0207ce`](https://github.com/Tristan578/project-forge/commit/f0207ce25771b9a4cdfb8fb316e36505060a9ba9) Thanks [@Tristan578](https://github.com/Tristan578)! - Add `useAIGeneration` hook for abort/cancel support in AI generation dialogs. All 7 Generate dialogs (Texture, Sprite, Sound, Music, Skybox, Model, PixelArt) now cancel in-flight requests when closed or unmounted, preventing leaked network requests and double-submission. Includes 11 unit tests for the hook.

- [#8499](https://github.com/Tristan578/project-forge/pull/8499) [`854869d`](https://github.com/Tristan578/project-forge/commit/854869d233a2865592ece775e379d7885e61ca96) Thanks [@Tristan578](https://github.com/Tristan578)! - Add Opus 4.7 deep-generation tier behind `NEXT_PUBLIC_USE_DEEP_GENERATION` flag. When enabled, GDD, world-builder, and cutscene generators route to `claude-opus-4-7` for higher-fidelity output. Default off. Every call emits `ai_deep_generation_eval` to PostHog for A/B analysis. Decision memo: `docs/decisions/2026-05-01-opus-deep-tier.md`.

- [#8835](https://github.com/Tristan578/project-forge/pull/8835) [`fc74d5c`](https://github.com/Tristan578/project-forge/commit/fc74d5c6d07840e2503ef918e1b9aae809383b16) Thanks [@Tristan578](https://github.com/Tristan578)! - Add an AI SDK MCP client (`@ai-sdk/mcp`) and a tool-parity guard. The flag/env-guarded client (`MCP_HTTP_URL` + `MCP_HTTP_TOKEN`) connects to the SpawnForge MCP server's Streamable HTTP transport and is used out-of-band — chiefly to verify the bundled command manifest stays in sync with the tools a live server actually serves. The chat agent intentionally keeps its static, browser-forwarded tool source (no hot-path network dependency, no change to the execution model). See `docs/decisions/2026-06-23-mcp-client-tool-source.md`.

- [#8364](https://github.com/Tristan578/project-forge/pull/8364) [`aa6e79e`](https://github.com/Tristan578/project-forge/commit/aa6e79e53dbf01aa91e82e047fedc47a26d138e9) Thanks [@Tristan578](https://github.com/Tristan578)! - Upgrade @anthropic-ai/sdk from 0.82.0 to 0.88.0 and @ai-sdk/anthropic to 3.0.69

  New capabilities available:

  - Managed Agents API (v0.86+) for server-side agent orchestration
  - AbortSignal support for tool runner cancellation (v0.84+)
  - Beta advisor tool (v0.87+)
  - Vertex EU region support (v0.88+)

- [#8834](https://github.com/Tristan578/project-forge/pull/8834) [`507722f`](https://github.com/Tristan578/project-forge/commit/507722f574bf7864f47c6f880f3ee2bbbe7e0a41) Thanks [@Tristan578](https://github.com/Tristan578)! - Add server-side step-up re-verification enforcement for sensitive routes (PF-910). A new `requireStepUp()` guard (`web/src/lib/auth/step-up.ts`) demands a recent Clerk re-verification (via `auth().has({ reverification })`) before account deletion, BYOK key writes, and billing checkout/portal actions, returning a 403 with a `REVERIFICATION_REQUIRED` hint otherwise. The per-route policy and the expected Clerk Dashboard protections (MFA/passkeys/bot-protection) are declared as code in `web/src/lib/auth/security-policy.ts`, with an operator runbook at `docs/security/clerk-account-protection.md`. The guard no-ops when Clerk keys are absent, so CI/dev/E2E are unaffected.

- [#8262](https://github.com/Tristan578/project-forge/pull/8262) [`6c9c3a1`](https://github.com/Tristan578/project-forge/commit/6c9c3a1dca4a8ac2af9d0bdf34fc4f261b7a04be) Thanks [@Tristan578](https://github.com/Tristan578)! - Make creditTransactions inserts idempotent under retry with unique index and onConflictDoNothing. Add WASM CDN redundancy: fetchWithRetry with exponential backoff, same-origin fallback from Vercel static assets, retry button on InitOverlay error state, and PostHog/Sentry monitoring for CDN fallback events.

- [#8367](https://github.com/Tristan578/project-forge/pull/8367) [`8c3ee07`](https://github.com/Tristan578/project-forge/commit/8c3ee07fc306839fdbb20d6622c3376df00bdead) Thanks [@Tristan578](https://github.com/Tristan578)! - Add community & viral growth features (E2): dynamic OG images for published games, social sharing buttons (X, Reddit, copy link), "Made with SpawnForge" branding in exported games, and "Remix this game" button with auth gate.

- [#8500](https://github.com/Tristan578/project-forge/pull/8500) [`b53bbb1`](https://github.com/Tristan578/project-forge/commit/b53bbb15e558dcbd2aa295e0f82eb60684db65d3) Thanks [@Tristan578](https://github.com/Tristan578)! - Enable the Anthropic 1h extended prompt cache TTL on `POST /api/chat`.

  The base system prompt and engine scene context are now tagged for the
  1-hour ephemeral cache via the `extended-cache-ttl-2025-04-11` beta. Chat
  sessions that idle longer than 5 minutes (canvas editing, preview runs,
  long pauses) no longer re-ingest the full ~15k–60k token prefix on the
  next turn — they read from cache at ~0.1× input price.

  Doc context and per-turn user content stay on the default 5-minute TTL.

  Adds an `ai_cache_hit_rate` server analytics event with `cacheReadTokens`
  and `cacheWriteTokens` so we can measure impact in PostHog/Vercel
  Analytics over the 7 days post-merge.

  **Backwards compatible.** The change applies only to the direct Anthropic
  backend; the gateway / OpenRouter / GitHub Models paths still receive a
  flat string and are unchanged. Existing callers passing `instructions` as
  a plain string keep working — the new `InstructionBlock[]` shape is
  opt-in.

- [#8436](https://github.com/Tristan578/project-forge/pull/8436) [`fa9ad23`](https://github.com/Tristan578/project-forge/commit/fa9ad23814720767f73322f85b6ce0edbd7fc924) Thanks [@Tristan578](https://github.com/Tristan578)! - Add llms.txt and llms-full.txt static files for AI search engine discoverability (LLM indexing standard)

- [#8438](https://github.com/Tristan578/project-forge/pull/8438) [`3aea46e`](https://github.com/Tristan578/project-forge/commit/3aea46e7e02712c9474218de125801fb575be74d) Thanks [@Tristan578](https://github.com/Tristan578)! - Dynamic sitemap now includes all published games from the database alongside static pages, enabling search engines to discover `/play/[userId]/[slug]` URLs

- [#8508](https://github.com/Tristan578/project-forge/pull/8508) [`1a78a3f`](https://github.com/Tristan578/project-forge/commit/1a78a3fc41204088c80297058e6960a12fe7a720) Thanks [@Tristan578](https://github.com/Tristan578)! - Add Opus 4.7 as the premium chat model, gated behind the Pro tier. New constants `AI_MODEL_PREMIUM`, `GATEWAY_MODEL_PREMIUM`, and `AI_MODELS.premium` / `AI_MODELS.gatewayPremium` expose the model id and its gateway-format equivalent. A new `isPremiumModel(model)` helper recognises both bare and gateway-format ids without substring matching, so future Opus revisions must be opted in explicitly.

  The chat route rejects premium model requests from non-Pro tiers with a 403 _before_ token deduction, so a misconfigured client cannot accidentally burn the user's balance. The chat-input model picker shows the option to all users but disables it for non-Pro accounts so they get a clear UX signal instead of a silent server error.

- [#8271](https://github.com/Tristan578/project-forge/pull/8271) [`16fce1b`](https://github.com/Tristan578/project-forge/commit/16fce1b56b1390c165ea790cad67565b5d4dbc0e) Thanks [@Tristan578](https://github.com/Tristan578)! - Canvas keyboard shortcuts (W/E/R gizmo modes, Delete, Ctrl+D duplicate, Ctrl+Z/Shift+Z undo/redo, F focus, Escape deselect/stop) are now registered in the keybindings registry and rebindable via the Keyboard Shortcuts panel. Added context field to distinguish canvas-only from global shortcuts. Includes ARIA attributes, focus management, and paused-mode regression fix.

- [#8260](https://github.com/Tristan578/project-forge/pull/8260) [`74125c1`](https://github.com/Tristan578/project-forge/commit/74125c1c15f8f4668cf71c5fd767b4b12a2bd76b) Thanks [@Tristan578](https://github.com/Tristan578)! - Add DB connection resilience infrastructure: wrap all 48+ raw getDb() callsites with queryWithResilience (circuit breaker + retry), add Upstash sliding-window DB rate limiter, 503 graceful degradation handler, client-side 503 toast with auto-retry, health endpoint circuit breaker stats. Fix P1 quick wins: silent Redis fallback now reports to Sentry, tsc OOM on Node 25.x, single-HTML export CDN failure, export scene data completeness.

- [#8268](https://github.com/Tristan578/project-forge/pull/8268) [`0e8ea23`](https://github.com/Tristan578/project-forge/commit/0e8ea23eaf7592e33e5acfa56ac093f463714157) Thanks [@Tristan578](https://github.com/Tristan578)! - 3D viewport is now keyboard-navigable: focusable canvas with ARIA attributes, W/E/R gizmo modes, Delete/Backspace, Ctrl+D duplicate, Ctrl+Z/Ctrl+Shift+Z undo/redo, F focus, Escape deselect/stop. Paused mode now correctly blocks edit shortcuts.

- [#8772](https://github.com/Tristan578/project-forge/pull/8772) [`1be26d4`](https://github.com/Tristan578/project-forge/commit/1be26d422cccf55cd980d7205e3f765a277d3906) Thanks [@Tristan578](https://github.com/Tristan578)! - Add a pre-play winnability gate. Before entering Play — from both the Play button and the AI `play` tool — the scene is validated to confirm it is actually winnable (a reachable goal with a player, a non-empty collectible set with a win rule, or a positive score target). When it isn't, the AI receives a specific, actionable reason as a tool result and the user sees the same guidance as a chat notice, so an unwinnable generated game is fixed instead of silently entered.

- [#8511](https://github.com/Tristan578/project-forge/pull/8511) [`7f361f6`](https://github.com/Tristan578/project-forge/commit/7f361f6248f52aabb201d55ae315cc7014a9d36d) Thanks [@Tristan578](https://github.com/Tristan578)! - Raise the chat conversation size limit from ~150k tokens to ~500k tokens to
  leverage Sonnet 4.6's 1M-token context window. Body limit goes from 1MB to 4MB
  to fit the new content budget plus image data and tool results. Long
  game-design conversations no longer hit a premature 413 wall mid-session.

- [#8345](https://github.com/Tristan578/project-forge/pull/8345) [`a716738`](https://github.com/Tristan578/project-forge/commit/a716738a24df2590b94b73946df0566392dc8045) Thanks [@Tristan578](https://github.com/Tristan578)! - Add shared `RouteErrorBoundary` primitive and wire it across the editor, dashboard, settings, admin, community, and play routes. Each boundary now reports to Sentry with a `route` tag and `digest`, exposes an accessible `alert` live region, and masks raw error messages in production while appending them in development.

- [#8449](https://github.com/Tristan578/project-forge/pull/8449) [`6c961c4`](https://github.com/Tristan578/project-forge/commit/6c961c4b6f487012ca96dbd4e795d0cec42d5247) Thanks [@Tristan578](https://github.com/Tristan578)! - Add blog infrastructure with index page, per-post pages with BlogPosting JSON-LD, RSS feed, and 2 initial posts

- [#8443](https://github.com/Tristan578/project-forge/pull/8443) [`281b99b`](https://github.com/Tristan578/project-forge/commit/281b99ba64ff6f262f56b3a30da2848eb73260c4) Thanks [@Tristan578](https://github.com/Tristan578)! - Add reusable Breadcrumbs component with BreadcrumbList JSON-LD schema and apply to pricing, community, and play pages

- [#8445](https://github.com/Tristan578/project-forge/pull/8445) [`35864b6`](https://github.com/Tristan578/project-forge/commit/35864b648bf465c2c53f28cd378c655084937b5c) Thanks [@Tristan578](https://github.com/Tristan578)! - Add public changelog page at /changelog rendering CHANGELOG.md content with styled release cards

- [#8441](https://github.com/Tristan578/project-forge/pull/8441) [`2af9e27`](https://github.com/Tristan578/project-forge/commit/2af9e27344a6849e659ec87cc81f51065084229c) Thanks [@Tristan578](https://github.com/Tristan578)! - Add standalone comparison pages (SpawnForge vs Unity, Godot, GameMaker, Rosebud AI) with feature tables, JSON-LD WebPage schema, and static generation

- [#8439](https://github.com/Tristan578/project-forge/pull/8439) [`212185d`](https://github.com/Tristan578/project-forge/commit/212185d9d78928ab2d9fbfd0a8840daacaefe72a) Thanks [@Tristan578](https://github.com/Tristan578)! - Add FAQ page with FAQPage JSON-LD schema and About page with product statistics, architecture overview, and entity establishment data

- [#8434](https://github.com/Tristan578/project-forge/pull/8434) [`434de39`](https://github.com/Tristan578/project-forge/commit/434de3994c14b080455ebc08a78694aa0b36ae66) Thanks [@Tristan578](https://github.com/Tristan578)! - Add SEO foundation: metadataBase for canonical URL resolution, SoftwareApplication + Organization JSON-LD schema with pricing tiers, canonical URLs on all public pages, and AI crawler directives in robots.txt

- [#8447](https://github.com/Tristan578/project-forge/pull/8447) [`dbc09d1`](https://github.com/Tristan578/project-forge/commit/dbc09d100c733def70c96d573cd6604689d43df0) Thanks [@Tristan578](https://github.com/Tristan578)! - Add per-page OpenGraph images for pricing and community pages using next/og ImageResponse

- [#8440](https://github.com/Tristan578/project-forge/pull/8440) [`5491b01`](https://github.com/Tristan578/project-forge/commit/5491b01b331854a47eb795e829567afa127fb38c) Thanks [@Tristan578](https://github.com/Tristan578)! - Add VideoGame JSON-LD schema to published game pages and SoftwareApplication pricing structured data with all 4 tiers

- [#8444](https://github.com/Tristan578/project-forge/pull/8444) [`5484cc3`](https://github.com/Tristan578/project-forge/commit/5484cc3da5ffb1ff8b7ccd2167bbf6bca1023c04) Thanks [@Tristan578](https://github.com/Tristan578)! - Add use-case showcase pages (platformer, RPG, puzzle, game jam, education) with feature highlights, JSON-LD schema, and static generation

- [#8831](https://github.com/Tristan578/project-forge/pull/8831) [`b819661`](https://github.com/Tristan578/project-forge/commit/b819661e756267973e79e69a6a1fc54904e31546) Thanks [@Tristan578](https://github.com/Tristan578)! - Adopt the Stripe Entitlements API for product capability gating. The
  `entitlements.active_entitlement_summary.updated` webhook now persists each
  customer's active feature lookup_keys to `users.active_features`, and the web
  client maps those features onto `canUseAI` / `canUseMCP` / `canPublish`. When no
  entitlement summary has been synced (or Entitlements is not configured in the
  Stripe dashboard), gating falls back to the existing tier-derived defaults, so
  the change is purely additive and never strips access from an existing user.

- [#8830](https://github.com/Tristan578/project-forge/pull/8830) [`515dbae`](https://github.com/Tristan578/project-forge/commit/515dbaec5340efc90373f7cc4352e63b3ba6b4d9) Thanks [@Tristan578](https://github.com/Tristan578)! - Deepen the Stripe Customer Portal billing route: support pinning a portal
  configuration via `STRIPE_PORTAL_CONFIGURATION_ID` (plan switching across the
  4 tiers, payment-method update, cancellation retention coupon) and a
  `?flow=cancel` deep-link into the cancellation/retention flow. All additions
  are env- and subscription-guarded, so the portal keeps working against the
  Stripe Dashboard default configuration with no provisioning.

- [#8832](https://github.com/Tristan578/project-forge/pull/8832) [`203297f`](https://github.com/Tristan578/project-forge/commit/203297fcf2ce3dc14c02d98e5b1287f356b7dea6) Thanks [@Tristan578](https://github.com/Tristan578)! - Add Stripe Radar fraud-review handling for token-pack purchases. When Radar flags a one-time token-pack payment for manual review, the token credit grant is now held until the review clears: tokens are released only when Stripe closes the review as approved, and a refunded/fraud close or a dispute grants nothing (and reverses any credit that did land). Gated behind the `STRIPE_RADAR_REVIEW_HOLD` env flag — inert (credit-immediately, pre-existing behaviour) until enabled and the Dashboard Radar rules are provisioned.

- [#8829](https://github.com/Tristan578/project-forge/pull/8829) [`6114f25`](https://github.com/Tristan578/project-forge/commit/6114f2527e4eaf9a14c88116eac21173e87569b6) Thanks [@Tristan578](https://github.com/Tristan578)! - Enable Stripe Tax on subscription Checkout. When `STRIPE_TAX_ENABLED=true`, the
  billing checkout route turns on `automatic_tax`, collects the customer's billing
  address (and an optional tax ID), and persists the address back onto the Stripe
  customer. The integration is guarded so it stays inert until Stripe Tax and the
  relevant tax registrations are provisioned in the dashboard — keeping CI, prod,
  and existing checkout behaviour unchanged when the flag is off.

- [#8274](https://github.com/Tristan578/project-forge/pull/8274) [`1b5a3f6`](https://github.com/Tristan578/project-forge/commit/1b5a3f68b37267177578c1374493f45748a84f7f) Thanks [@Tristan578](https://github.com/Tristan578)! - Add tier-based access control for AI generation panels. Hobbyist+ can generate textures, sounds, music, sprites, and pixel art. Creator+ can generate 3D models and skyboxes. Locked panels show a Lock icon with the required tier label.

- [#8743](https://github.com/Tristan578/project-forge/pull/8743) [`7b7d1fe`](https://github.com/Tristan578/project-forge/commit/7b7d1fe7acf0194621e10ac3b1457fda9f40e35c) Thanks [@Tristan578](https://github.com/Tristan578)! - Deliver the waitlist that every marketing CTA promises: /sign-up now renders an accessible email-capture form (idle/submitting/success/error states, aria-live status region, hidden honeypot) instead of a mailto dead end, backed by a new public POST /api/waitlist route (IP rate limited, strict server-side email validation with trim+lowercase normalization, honeypot short-circuit, and duplicate-safe inserts via onConflictDoNothing on the new waitlist_signups table's unique email index — migration 0007). Sign-ups themselves remain disabled; this is lead capture only.

- [#8347](https://github.com/Tristan578/project-forge/pull/8347) [`0ad7f0f`](https://github.com/Tristan578/project-forge/commit/0ad7f0fc3b569d646e8fbb9f6384b9c6f563f005) Thanks [@Tristan578](https://github.com/Tristan578)! - Expose WASM command batching to JS: `sendCommandBatch` on useEngine hook, `dispatchCommandBatch` on store/context interfaces. Migrated entitySetupExecutor and autoPolishExecutor to batch dispatch with sequential fallback.

- [#8771](https://github.com/Tristan578/project-forge/pull/8771) [`bf6ba33`](https://github.com/Tristan578/project-forge/commit/bf6ba336aaf9b649bd3675fe9c54ef16dafbe142) Thanks [@Tristan578](https://github.com/Tristan578)! - Wire the game win condition end-to-end. The engine now resolves `ReachGoal` (a CharacterController touching the goal target) and `CollectAll` (full collectible set) natively, sets the win state once, and queues a `game_win` event that the bridge drains to JS. A new `GAME_EVENT` handler flips the `gameWon` store flag, which paints a "You Win!" overlay in Play/Paused. Adds the `forge.game.win()/setScore()/getScore()/onWin()` script API (loop-guarded against the worker re-broadcast) so scripts can declare and observe a win. Requires a WASM rebuild to take effect in production.

### Patch Changes

- [#8296](https://github.com/Tristan578/project-forge/pull/8296) [`d584b8f`](https://github.com/Tristan578/project-forge/commit/d584b8faa77e08a7b9b7f328c3dd3adf84339555) Thanks [@Tristan578](https://github.com/Tristan578)! - Thread AbortSignal through export pipeline for reliable cancel support

- [#8383](https://github.com/Tristan578/project-forge/pull/8383) [`da2f006`](https://github.com/Tristan578/project-forge/commit/da2f006d9bf8baf4d314f3d0afff39deba643273) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix AccessibilityPanel keybinding cleanup to use ref-based tracking instead of closure values, ensuring stale bindings are always removed when profiles are regenerated

- [#8745](https://github.com/Tristan578/project-forge/pull/8745) [`f484c3c`](https://github.com/Tristan578/project-forge/commit/f484c3ce4048544c5df3beebf8e87d404bed3f4d) Thanks [@Tristan578](https://github.com/Tristan578)! - Grant the new tier's full monthly token allocation (and write a credit_transactions audit row) when an admin changes a user's tier via PATCH /api/admin/users/[id]. Previously a comped paid tier wrote the tier column alone with no tokens, leaving the user with a zero balance and blocked at every AI generation route — the paid-only alpha core journey never started.

- [#8507](https://github.com/Tristan578/project-forge/pull/8507) [`b77a1a6`](https://github.com/Tristan578/project-forge/commit/b77a1a63944560afabe930753b2d3c17963187ac) Thanks [@Tristan578](https://github.com/Tristan578)! - Add `effort: 'low' | 'medium' | 'high'` parameter to `createSpawnforgeAgent` and the `/api/chat` body, mirroring the Anthropic provider's reasoning-effort hint. Non-chat generators (`gameReviewer`, `tutorialGenerator`, `gddGenerator`) now opt in to `effort: 'medium'` instead of passing `thinking: false`, letting the SDK pick a sensible reasoning budget instead of guessing token counts.

  The chat route gates `effort` behind the same creator/pro tier check used for `thinking` mode and rejects unknown values with a 400. Both fields are emitted independently into `providerOptions.anthropic` and only on the direct backend; gateway routes ignore them.

- [#8408](https://github.com/Tristan578/project-forge/pull/8408) [`9d25730`](https://github.com/Tristan578/project-forge/commit/9d25730042d8f9c5c2da4158bc5f3ca892931f12) Thanks [@Tristan578](https://github.com/Tristan578)! - Add AI response caching layer with prompt deduplication. Identical generation requests (SFX, voice, localize) now return cached results instantly without deducting tokens. Uses Upstash Redis in production with in-memory LRU fallback for development.

- [#8365](https://github.com/Tristan578/project-forge/pull/8365) [`7973815`](https://github.com/Tristan578/project-forge/commit/7973815a9307450aa040eb97cd39ca70480b7ca1) Thanks [@Tristan578](https://github.com/Tristan578)! - Upgrade AI SDK from 6.0.156 to 6.0.158 -- fixes Google Vertex streamFunctionCallArguments default, adds Anthropic inference_geo support

- [#8272](https://github.com/Tristan578/project-forge/pull/8272) [`eed590c`](https://github.com/Tristan578/project-forge/commit/eed590c189d06227eaf2b1ce23a7294553856c39) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix anti-patterns found during codebase audit: replace `Number() ||` with `Number.isFinite()` guard in save system generator, fix `volume || 1.0` to `volume ?? 1.0` in audio crossfade/fadeIn, correct non-existent `forge.ui` API names in generated scripts, replace invalid `forge.on()` with `onStart` lifecycle.

- [#8373](https://github.com/Tristan578/project-forge/pull/8373) [`ac82d27`](https://github.com/Tristan578/project-forge/commit/ac82d27d64fda5d5cfe1fd6bcf507539d040f269) Thanks [@Tristan578](https://github.com/Tristan578)! - Add OpenAPI schema validation and auth-gated route contract tests to API test suite (35 total tests)

- [#8168](https://github.com/Tristan578/project-forge/pull/8168) [`4d89c49`](https://github.com/Tristan578/project-forge/commit/4d89c493edb4255c6e7a7ee6ece97c82ef9ce127) Thanks [@Tristan578](https://github.com/Tristan578)! - Standardize API route auth/rate-limit pipeline via withApiMiddleware. Migrate 52 route files from raw authenticateRequest to centralized middleware. Add ESLint enforcement rule.

- [#8392](https://github.com/Tristan578/project-forge/pull/8392) [`e2fb72b`](https://github.com/Tristan578/project-forge/commit/e2fb72bb89700a14234469d1f44116f95ba7a3b6) Thanks [@Tristan578](https://github.com/Tristan578)! - Add test coverage for vitals and capabilities API routes (20 tests)

- [#8653](https://github.com/Tristan578/project-forge/pull/8653) [`e2c264e`](https://github.com/Tristan578/project-forge/commit/e2c264ef82fedfd8edc8204292958a14031a025c) Thanks [@Tristan578](https://github.com/Tristan578)! - Remediate four High-severity findings from the 2026-05-30 security & testing audit:

  - **F01 (CI):** add an aggregating `ci-success` status check so branch protection covers every real gate (eslint/tsc/vitest/coverage, command-parity, build, docs/design gates, e2e) instead of only the no-op `ci-gate` path detector.
  - **F02 (billing):** make add-on token crediting idempotent across Stripe webhook redelivery via a `UNIQUE` index on `token_purchases.stripe_payment_intent` and a single `INSERT ... ON CONFLICT DO NOTHING` + conditional balance `UPDATE` CTE. Redelivered events no longer double-credit users.
  - **F03 (telemetry):** stop sending default PII to Sentry (IPs, cookies, headers, user data) and scrub residual secrets/PII (API keys, JWTs, bearer tokens, emails, IPs) from every event via `beforeSend`/`beforeSendTransaction`.
  - **F04 (telemetry):** stop capturing stack-frame local variables on the server, which could hold decrypted BYOK provider keys and prompts.

- [#8736](https://github.com/Tristan578/project-forge/pull/8736) [`76ff50d`](https://github.com/Tristan578/project-forge/commit/76ff50dff2bd6fac0bd36a388e49aaf61b569dcd) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump `@anthropic-ai/sdk` from 0.102.0 to 0.104.1 (minor-and-patch group). Patch-level dependency update for the web app's AI client; no API surface change.

- [#8781](https://github.com/Tristan578/project-forge/pull/8781) [`9411389`](https://github.com/Tristan578/project-forge/commit/94113890aac6c753ad25fe47437a4e875597215d) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump `dompurify` to `>=3.4.10` (from `>=3.4.1`) via the repo-wide npm `overrides`
  floor, picking up the upstream patch releases for the HTML sanitizer used on
  user-supplied content. The root `package-lock.json` resolves `dompurify` to
  `3.4.10`. Dependency hygiene — applied proactively rather than waiting for a
  breaking advisory.

- [#8788](https://github.com/Tristan578/project-forge/pull/8788) [`5f10219`](https://github.com/Tristan578/project-forge/commit/5f10219f6b09ce4776fbe9bc1aaab7a2911badce) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix primary Button (`variant="default"`) failing WCAG 2.1 AA text contrast across themes ([#8742](https://github.com/Tristan578/project-forge/issues/8742)). The resting CTA now renders `--sf-on-accent` on `--sf-accent-hover` and steps to a new `--sf-accent-active` token on hover — white-on-accent themes darken, dark-on-accent themes brighten, so the label clears the 4.5:1 floor in both states for all 7 themes. The `leaf` theme's white on-accent (which failed even at hover) is swapped to a dark on-accent like its bright-accent siblings. Adds a per-theme regression test asserting `--sf-on-accent` contrast against the button's resting and hover backgrounds so this can't regress silently, and removes the interim AA override on the waitlist CTA.

- [#8504](https://github.com/Tristan578/project-forge/pull/8504) [`3c6baa6`](https://github.com/Tristan578/project-forge/commit/3c6baa639db653a7cd7fcce12a8b9f7f23d02ee3) Thanks [@Tristan578](https://github.com/Tristan578)! - Bump engine Rust transitives to clear Dependabot alerts:

  - `grid` 1.0.0 → 1.0.1 (medium): integer overflow in `Grid::expand_rows()` could trigger UB via the safe `get()` API
  - `rand` 0.8.5 → 0.8.6 (low): soundness issue with custom logger + `rand::rng()`
  - `rand` 0.9.2 → 0.9.4 (low): same soundness backport on the 0.9 line

  `cargo check --target wasm32-unknown-unknown --features webgl2` passes after the bump.

- [#8521](https://github.com/Tristan578/project-forge/pull/8521) [`8c5be0a`](https://github.com/Tristan578/project-forge/commit/8c5be0a4b675f3347f0a31b09fd9406daa13f882) Thanks [@Tristan578](https://github.com/Tristan578)! - ci(cd): add pre-flight production domain attachment check

  Asserts that `spawnforge.ai` and `www.spawnforge.ai` are attached to the
  target Vercel project (in the configured team scope) before the production
  deploy step runs. Fails loud at deploy time with an actionable error message
  instead of letting the deploy succeed silently while traffic continues to
  serve a stale build (the failure mode in [#8518](https://github.com/Tristan578/project-forge/issues/8518)).

- [#8165](https://github.com/Tristan578/project-forge/pull/8165) [`25e2b56`](https://github.com/Tristan578/project-forge/commit/25e2b56bd2d499884ee8a4355f491683c52637af) Thanks [@Tristan578](https://github.com/Tristan578)! - Centralize hardcoded constants: migrate remaining timeout, provider, and scope consumers to shared config modules. Adds 7 new timeout constants, wires magic-constants check into pre-push hook, and replaces hardcoded provider strings across 10+ API routes with DB_PROVIDER/DIRECT_CAPABILITY_PROVIDER imports.

- [#8297](https://github.com/Tristan578/project-forge/pull/8297) [`b69c3c4`](https://github.com/Tristan578/project-forge/commit/b69c3c4b0afb1807918d4e0e271f79c5085b6b21) Thanks [@Tristan578](https://github.com/Tristan578)! - Add chat executor integration test covering tool-to-handler-to-store flow

- [#8384](https://github.com/Tristan578/project-forge/pull/8384) [`23c338d`](https://github.com/Tristan578/project-forge/commit/23c338dcf68a41a4bb96aed75d11c19e33af0479) Thanks [@Tristan578](https://github.com/Tristan578)! - Debounce chatStore.saveConversation localStorage writes to prevent main thread blocking during streaming

- [#8530](https://github.com/Tristan578/project-forge/pull/8530) [`b81e629`](https://github.com/Tristan578/project-forge/commit/b81e6290b56bbb2bc676505a7eed8ec2a0cb63e5) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix protected routes (`/dashboard`, `/dev`, `/settings`, `/editor`, etc.) returning hard 404 to signed-out browser visitors. Clerk v3+ middleware made `auth.protect()` rewrite to `/404` by default (route-enumeration mitigation), which left users with no recovery path. The proxy now calls `redirectToSignIn({ returnBackUrl })` for browser nav and returns 401 JSON for `/api/*` requests, restoring the original UX and unblocking the production smoke test. Resolves [#8529](https://github.com/Tristan578/project-forge/issues/8529).

- [#8170](https://github.com/Tristan578/project-forge/pull/8170) [`f3ef640`](https://github.com/Tristan578/project-forge/commit/f3ef640713ece0a3f1ea18ec796cb75d9dd5cf90) Thanks [@Tristan578](https://github.com/Tristan578)! - Use atomic UPDATE...WHERE...RETURNING guards to eliminate TOCTOU race conditions in token deductions. Add CTE-based idempotency guards for refund operations with accurate return semantics. Fix `||` vs `??` for priceTokens default in marketplace route.

- [#8774](https://github.com/Tristan578/project-forge/pull/8774) [`e5faac7`](https://github.com/Tristan578/project-forge/commit/e5faac7de91ff554f9055e0c2c622fa67250a26d) Thanks [@Tristan578](https://github.com/Tristan578)! - Extract the exported-game per-frame loop into a single shared helper (`generateGameLoopFragment`) consumed by both the single-HTML and ZIP exporters, so the two paths can no longer silently drift (the cause of the [#8754](https://github.com/Tristan578/project-forge/issues/8754) touch-input ordering defect re-appearing in the sibling generator).

- [#8382](https://github.com/Tristan578/project-forge/pull/8382) [`70c4f20`](https://github.com/Tristan578/project-forge/commit/70c4f201c74d4e8c01892edee7ca27b08a361738) Thanks [@Tristan578](https://github.com/Tristan578)! - Upgrade egui ecosystem 0.33→0.34 in transform-gizmo fork, bump portless 0.9→0.10, React 19.2.4→19.2.5

- [#8502](https://github.com/Tristan578/project-forge/pull/8502) [`1770046`](https://github.com/Tristan578/project-forge/commit/177004657f0d3f0a788d70ede3d130c398bba2e0) Thanks [@Tristan578](https://github.com/Tristan578)! - Bump npm `overrides` pins to clear 10 medium-severity Dependabot alerts:

  - `dompurify` → `>=3.4.1` (covers 8 XSS bypass alerts; was `>=3.3.2`)
  - `uuid` → `>=14.0.0` (transitive via svix/Storybook; missing buffer bounds check in v3/v5/v6)
  - `fast-xml-parser` → `>=5.7.2` (transitive via @aws-sdk/client-s3; CDATA injection)

  Also pins `stripe` at `~22.0.1` to preserve the existing `2026-03-25.dahlia` API version (avoids accidental minor 22.1.0 bump that ships a newer required API version), and adds `ajv@^6.14.0` as an explicit `web` devDep so `contracts.test.ts` no longer relies on incidental hoisting of a transitive ESLint ajv.

  Test infra fixes carried in this PR (required to keep CI green after the lockfile regen and to clear pre-existing nightly failures):

  - Add `vitest@^4.1.4` to the root devDeps so `@testing-library/jest-dom` (which lives at root and does `import "vitest"`) resolves after the clean install.
  - Add a `next/router` resolve alias + `server.deps.inline: [/@sentry\/nextjs/]` to `web/vitest.config.jsdom.ts`, because `@sentry/nextjs` 10.50 ships `import "next/router"` as a bare specifier without an extension which vitest's strict ESM resolver rejects.
  - Add a `"development"` export condition to `@spawnforge/ui` pointing at TS source, and configure jsdom vitest to honor it. Lets `EditorLayout.test.tsx` and `AppearanceTab.test.tsx` run in clean checkouts where `packages/ui/dist/` has not been built (closes the recurring nightly failures tracked in [#8479](https://github.com/Tristan578/project-forge/issues/8479), [#8469](https://github.com/Tristan578/project-forge/issues/8469), [#8465](https://github.com/Tristan578/project-forge/issues/8465)).
  - Add `storybook@^8.6`, `@storybook/react@^8.6`, and `@storybook/react-vite@^8.6` to the root devDeps. After the lockfile regen, `storybook` was hoisted to root but `@storybook/react-vite` was kept at `apps/design/node_modules/`, so `storybook/dist/proxy.cjs` could no longer resolve `@storybook/react-vite/preset` (`SB_CORE-SERVER_0002 CriticalPresetLoadError`). This broke the Design Internal Gate, Chromatic Visual Regression, and Storybook Internal Leak Gate jobs. Pinning the framework packages at root forces consistent hoisting.

- [#8796](https://github.com/Tristan578/project-forge/pull/8796) [`d2eda3c`](https://github.com/Tristan578/project-forge/commit/d2eda3c88d90aeaf5d4bc124ed938e653036be46) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump dompurify from 3.4.10 to 3.4.11. Patch release of the HTML sanitizer used when rendering user-supplied content; keeps the XSS-sanitization layer current.

- [#8372](https://github.com/Tristan578/project-forge/pull/8372) [`bea8ef1`](https://github.com/Tristan578/project-forge/commit/bea8ef1387f78a7cef044325ee79fd224c6c0a89) Thanks [@Tristan578](https://github.com/Tristan578)! - Replace all inline timeout literals across 11 E2E files with named constants from e2e/constants.ts

- [#8171](https://github.com/Tristan578/project-forge/pull/8171) [`d078cd6`](https://github.com/Tristan578/project-forge/commit/d078cd6f24c654599f7d54e9fa387eac1dc44e19) Thanks [@Tristan578](https://github.com/Tristan578)! - Add ESLint rule `spawnforge/no-hardcoded-primitives` to detect hardcoded Tailwind color scale classes that should use CSS custom property design tokens. Rule is currently set to `off` (~3988 baseline violations); enable per-directory as files are migrated.

- [#8393](https://github.com/Tristan578/project-forge/pull/8393) [`f67f608`](https://github.com/Tristan578/project-forge/commit/f67f6083069c1a08acb07cfb792bbfcc094acb65) Thanks [@Tristan578](https://github.com/Tristan578)! - Add test coverage for 5 game-creation executors and system registry (67 tests)

- [#8754](https://github.com/Tristan578/project-forge/pull/8754) [`5894312`](https://github.com/Tristan578/project-forge/commit/58943122df2e6e8d68f9752a8cc26bdf613a3713) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix exported games receiving no keyboard/mouse input. The event callback embedded in the export bundle was wired to a contract the engine never speaks: a 2-arg `(eventType, eventPayload)` signature with `JSON.parse` (the engine sends a single `{ type, payload }` object), a dead `INPUT_STATE_CHANGED` event (input is delivered inside `PLAY_TICK` as `payload.inputState`), and a transposed action-keyed snake*case read of the input state (the engine emits field-keyed camelCase `pressed`/`justPressed`/`justReleased`/`axes`). All three are now corrected across the single-HTML and ZIP export paths, so exported games respond to input. Also fixes mobile touch controls being dead in exported games: the game loop merged the touch input layer onto `__forgeInputState` \_after* the frame's script read, so the engine's per-frame `PLAY_TICK` overwrite of that object dropped the touch state before any script could see it — the merge now runs before the script read within the same loop tick.

- [#8722](https://github.com/Tristan578/project-forge/pull/8722) [`bf4f812`](https://github.com/Tristan578/project-forge/commit/bf4f812a5bb54d010165cb698595b180b49e12ba) Thanks [@Tristan578](https://github.com/Tristan578)! - Harden charge-refund token reversal with integer-only fallback math and convert reverseAddonTokens tests to a real in-process Postgres (PGlite)

  The fallback (non-purchase) refund path now computes the token clawback entirely in integer SQL. `amountRefunded` and `amountTotal` are bound as `::bigint` params and the deduction is derived in the CTE: the first tranche takes `cur * amountRefunded / amountTotal` (current addon balance scaled by the refund ratio), and a later tranche reconstructs a STABLE original base from the clawback it already recorded — `amountRefunded * prior_clawed / prior_cum_cents − prior_clawed` — so `total` cancels and no floating-point ratio is ever interpolated. The result is clamped `GREATEST(0, LEAST(…, cur))`, so an out-of-order or redelivered refund can never produce a negative deduction or an over-deduction even if the user spends or buys more addon tokens between webhook deliveries. (An earlier iteration cast a JS-computed ratio `::float8` to dodge an `invalid input syntax for type integer` throw — the neon-http driver binds params as untyped text, so a bare fractional ratio resolved against the integer column and threw; that whole float path has since been removed in favour of the integer reconstruction above.) The previous mock-only tests asserted on SQL substrings and bound values and never executed the CTE, so they caught none of this; the converted suite runs the real arithmetic, the `refunded_cents` claim guard, and the `NOT EXISTS`/unique-index idempotency against PGlite and asserts on resulting row state.

  Also fixes an incremental-refund money bug the real-DB suite exposed ([#8706](https://github.com/Tristan578/project-forge/issues/8706)): Stripe fires `charge.refunded` once per refund with a stable `charge.id` and a cumulative `amount_refunded`, but both reversal paths keyed the audit row's `reference_id` on `chargeId` alone. A legitimate incremental partial-then-larger refund of one charge therefore collided on `idx_credit_txn_idempotent` — on the purchase path the duplicate-key error rolled back the whole CTE, permanently lost the second clawback, and 500'd the webhook into an infinite Stripe retry; on the fallback path the second tranche silently no-op'd and under-deducted. The audit `reference_id` is now a per-tranche key (`${chargeId}:${amountRefunded}`), with `ON CONFLICT … DO NOTHING` on the purchase-path INSERT as defence-in-depth, so successive incremental refunds each record their own row while a true redelivery (same cumulative amount) remains an exact no-op.

- [#8724](https://github.com/Tristan578/project-forge/pull/8724) [`7dc2121`](https://github.com/Tristan578/project-forge/commit/7dc21214ad3c1ad4d50e2c698ca62705c8ee55c9) Thanks [@Tristan578](https://github.com/Tristan578)! - test(tokens): prove `creditAddonTokens` add-on top-up against in-process Postgres (F17)

  The previous mock-based tests for the add-on token purchase path only asserted
  that the interpolated SQL string contained `ON CONFLICT` / `DO NOTHING` and that
  the package's token count appeared among the bound values — they never asserted
  that the balance actually moved, that exactly one purchase row was written, or
  that a redelivered Stripe webhook credits nothing. New `creditAddonTokens.db.test.ts`
  runs the real single-CTE statement against PGlite (Postgres-in-WASM) and asserts
  on the resulting rows: exact credited balance per package (spark 1000 / blaze
  5000 / inferno 20000), one purchase row with the correct tokens/amount_cents,
  add-on-to-existing-balance accumulation, sequential re-fire idempotency, distinct
  payment-intent stacking, and per-user isolation. No production code changes.

- [#8722](https://github.com/Tristan578/project-forge/pull/8722) [`bf4f812`](https://github.com/Tristan578/project-forge/commit/bf4f812a5bb54d010165cb698595b180b49e12ba) Thanks [@Tristan578](https://github.com/Tristan578)! - Convert `handleChargeRefunded` tests to real-database behavioural assertions (F18, [#8610](https://github.com/Tristan578/project-forge/issues/8610)). The previous suite mocked `@/lib/db/client` and asserted only on interpolated SQL substrings (`strings.includes('audit')`, `values.toContain('charge_refunded:ch_abc')`) — and its "idempotency" case asserted the refund CTE fired _twice_, the opposite of the property it claimed to prove. The mock never executed one line of SQL, so a query could contain every right substring and still double-deduct or mis-round. The tests now run the real refund SQL against in-process Postgres (PGlite) and assert on resulting row state — `users.addon_tokens`, `token_purchases.refunded_cents`, and `credit_transactions` — across both the fallback and precise reversal paths, proving the wrapper guards (unknown customer / non-positive amount-or-total), proportional and clamped deduction, the zero-balance guard, and idempotency under sequential webhook re-fire (Stripe at-least-once redelivery), including the incremental partial-then-cumulative refund case. It also adds a `refundedCents`-override precise case that independently proves the precise path deducts the incremental _delta_ (not the cumulative total): the prior partial-refund seed plus a high addon balance makes a cumulative-amount regression observable in `addon_tokens`, where the lockstep incremental case would have its clamps mask it. (The [#8706](https://github.com/Tristan578/project-forge/issues/8706) per-tranche refund-key SUT fix these tests exercise ships in [#8608](https://github.com/Tristan578/project-forge/issues/8608), on which this PR is stacked.)

- [#8725](https://github.com/Tristan578/project-forge/pull/8725) [`4c02e27`](https://github.com/Tristan578/project-forge/commit/4c02e274adfb70cfcda7ec4b4f45cb5f2f4a27f0) Thanks [@Tristan578](https://github.com/Tristan578)! - Convert `subscriptionLifecycle.db.test.ts` from a fully-mocked substring suite to real-DB behavioral tests (PGlite, replaying production migrations) and fix the `invoice.paid` rollover double-credit bug it exposed.

  The prior `.db`-named suite mocked the entire DB client and asserted only SQL _shape_ — it could pass while the SQL was semantically wrong. The rewrite drives every `subscription-lifecycle` handler (`findUserByStripeCustomer`, subscription create/update/delete, `handleInvoicePaid`, `handleInvoicePaymentFailed`) against an in-process Postgres and asserts on the resulting `users` / `credit_transactions` rows.

  This surfaced six real money-path bugs across the subscription handlers, all on the Stripe webhook redelivery path (at-least-once delivery). First-fire behavior is unchanged for every fix; redelivery is now a no-op on balance and on the used-counter.

  `handleInvoicePaid`:

  - **Rollover double-credit ([#8708](https://github.com/Tristan578/project-forge/issues/8708)):** the renewal-rollover path re-ran an un-gated `addon_tokens` relative increment, permanently inflating the purchased-token balance while the audit log showed a single rollover row. The rollover audit INSERT and the addon UPDATE are now merged into one data-modifying CTE so the UPDATE credits only what the INSERT actually inserted (`RETURNING amount`, `COALESCE(..., 0)`), matching the codebase's `reverseAddonTokens` idiom.

  - **Monthly-reset over-grant ([#8611](https://github.com/Tristan578/project-forge/issues/8611)):** the cycle-reset UPDATE unconditionally set `monthly_tokens_used = 0`, so a redelivery that landed after the user had spent part of the freshly-granted allocation silently refunded that spend — letting a user burn the monthly allocation twice per cycle for the price of a webhook retry. The reset is now gated on `NOT EXISTS` of the renewal grant row; since the grant INSERT runs after the reset within the same transaction, the first fire still resets while a redelivery is skipped, preserving interleaved spend and not re-stamping `billing_cycle_start`.

  - **Rollover leak on a no-rollover first fire ([#8709](https://github.com/Tristan578/project-forge/issues/8709)):** when the first fire had no remaining tokens (`remaining == 0`), the rollover statement was skipped, so its `renewal_rollover:<tier>` anchor was never written — yet the reset + grant still marked the invoice processed. A redelivery after the user spent part of the fresh allocation then saw `remaining > 0`, re-enabled the rollover, found no anchor to suppress it, and credited a free rollover into `addon_tokens`. The rollover is now gated on the same always-written renewal grant row as the reset, not its own conditionally-written anchor.

  - **Tier-keyed idempotency anchor ([#8710](https://github.com/Tristan578/project-forge/issues/8710)):** all three gates keyed on the tier-specific `renewal:<tier>` source, but `<tier>` is read mutably from `user.tier` at processing time. A tier change between an invoice's original delivery and a redelivery made the redelivery's anchor (`renewal:pro`) differ from the committed one (`renewal:creator`), re-opening every gate → double rollover **and** a duplicate monthly grant (the grant's `ON CONFLICT` keys on source, so the differing source dodged it). All gates now match `source LIKE 'renewal:%'` (tier-independent, and excludes the `renewal_rollover:%` rows because the literal `:` cannot match the `_`), and the grant INSERT gains the same `NOT EXISTS` gate so a cross-tier redelivery cannot write a second grant.

  `handleSubscriptionCreated`:

  - **Unconditional cycle reset ([#8711](https://github.com/Tristan578/project-forge/issues/8711)):** the reset UPDATE set `monthly_tokens_used = 0` with no idempotency gate, so a redelivery after the user spent part of the initial allocation refunded that spend. Both the reset UPDATE and the grant INSERT are now gated on `NOT EXISTS` of the `subscription_created:%` anchor for the subscription id (tier-independent), so a redelivery is a no-op.

  `handleSubscriptionDeleted`:

  - **Re-zero + duplicate audit row ([#8712](https://github.com/Tristan578/project-forge/issues/8712)):** the cancellation reset was unconditional (re-zeroing any post-cancellation starter spend on redelivery) and the audit source embedded `previousTier`, which `findUserByStripeCustomer` re-reads as `starter` on redelivery — so the differing source (`cancellation:starter->starter`) dodged the exact-source `ON CONFLICT` and wrote a bogus duplicate audit row with a phantom amount. The handler is now a single atomic CTE (`WITH audit AS (INSERT … RETURNING id) UPDATE … WHERE EXISTS (SELECT 1 FROM audit)`): the audit INSERT is gated on the tier-independent `cancellation:%` anchor and arbitrates the reset, so on redelivery neither the duplicate row nor the re-zero occurs.

- [#8733](https://github.com/Tristan578/project-forge/pull/8733) [`010d633`](https://github.com/Tristan578/project-forge/commit/010d63377d7df5d33f92e28cc40135cc957b4d3d) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix the fallback refund-clawback path in `reverseAddonTokens` so concurrent redelivery of the same `charge.refunded` webhook degrades to a clean no-op instead of a unique violation. The fallback audit INSERT was guarded only by a snapshot-level `NOT EXISTS` subquery; two concurrent deliveries could both pass it, and the loser then collided with the `idx_credit_txn_idempotent` partial unique index, failing the statement loudly (500/Stripe retry noise). The audit CTE now carries the same `ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING` arbiter the precise path already uses, with `NOT EXISTS` retained as the sequential-redelivery fast path; the dependent balance UPDATE stays suppressed whenever the audit row is swallowed, so no deduction can occur without its audit row. `refundCredits` in `creditManager.ts` carried the same NOT-EXISTS-only pattern on its `credit_refund` audit INSERT and receives the identical arbiter. ([#8729](https://github.com/Tristan578/project-forge/issues/8729))

- [#8329](https://github.com/Tristan578/project-forge/pull/8329) [`e4748d9`](https://github.com/Tristan578/project-forge/commit/e4748d9dfd30cf476f6c0e9d7b995f56ba0f8c17) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix stale selectedEntityId when AI auto-iteration spawns multiple game-component entities in one batch

- [#8787](https://github.com/Tristan578/project-forge/pull/8787) [`e971336`](https://github.com/Tristan578/project-forge/commit/e971336c18463d247b027d6db9f4a0be74052e3e) Thanks [@Tristan578](https://github.com/Tristan578)! - Dependency and changeset hygiene ([#8630](https://github.com/Tristan578/project-forge/issues/8630), [#8626](https://github.com/Tristan578/project-forge/issues/8626), [#8732](https://github.com/Tristan578/project-forge/issues/8732)).

  - Point the npm Dependabot updater at the repo root (`directory: /`) — the only
    location with a `package-lock.json` in this single-root-lockfile monorepo —
    replacing the `/web` and `/mcp-server` entries that edited manifests they could
    not relock and broke `npm ci` on main ([#8655](https://github.com/Tristan578/project-forge/issues/8655), [#8658](https://github.com/Tristan578/project-forge/issues/8658)).
  - Retarget every changeset that named a non-workspace package (the root
    `"spawnforge"`, plus `spawnforge-web` / `@spawnforge/web` / `spawnforge-docs` /
    `@spawnforge/mcp-server` typos) to its real workspace package, so
    `changeset version` no longer throws during release assembly.
  - Add `scripts/check-changeset-packages.sh`, wired into the Changeset Check
    workflow, to validate every changeset's package name against the workspace and
    prevent this class of defect from recurring ([#8325](https://github.com/Tristan578/project-forge/issues/8325), [#8396](https://github.com/Tristan578/project-forge/issues/8396), [#8732](https://github.com/Tristan578/project-forge/issues/8732)).

- [#8747](https://github.com/Tristan578/project-forge/pull/8747) [`57a6c89`](https://github.com/Tristan578/project-forge/commit/57a6c89eaad6a00adb614109b56ddafd9c541556) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix AI chat replies rendering blank and tool calls never executing: the client SSE parser now reads the AI SDK v6 `UIMessageChunk` protocol (hyphenated chunk types, `delta`/`errorText`/`messageMetadata` fields) that `/api/chat` actually emits, instead of a dead underscored protocol. Also closes an approval-mode bug where streamed tool calls auto-executed without user consent — approval mode now always previews and waits.

- [#8783](https://github.com/Tristan578/project-forge/pull/8783) [`ee0c010`](https://github.com/Tristan578/project-forge/commit/ee0c010fa2ac9fdb48dd189c3f0a6265a5058f8a) Thanks [@Tristan578](https://github.com/Tristan578)! - Close two content-safety bypasses in the input-sanitization layer:

  - **Chat route ([#8635](https://github.com/Tristan578/project-forge/issues/8635)):** the per-message prompt-injection screen, 4000-char cap,
    and sanitizer ran only on string `content`. Multimodal messages whose `content`
    is an array of parts (`[{ type: 'text', text }]`) hit a `continue` and skipped
    every guard. The validation loop now normalizes array content, screening and
    sanitizing each `{type:'text'}` block in place while leaving image/tool parts
    untouched.

  - **Generation handler ([#8650](https://github.com/Tristan578/project-forge/issues/8650)):** `createGenerationHandler` ran the content-safety
    filter on exactly one `promptField`. A new `secondaryPromptFields` option screens
    all user-supplied free-text on a route. The 3D model route now registers
    `negativePrompt` + `artStyle` as secondary fields and bounds both to 500 chars in
    its validator, so neither reaches Meshy unscreened or unbounded.

- [#8703](https://github.com/Tristan578/project-forge/pull/8703) [`714cd17`](https://github.com/Tristan578/project-forge/commit/714cd1790497989b7755db9fe94db16fb4e5fdb5) Thanks [@Tristan578](https://github.com/Tristan578)! - Allow Vercel Cron routes (`/api/cron/*`) through the Clerk proxy so the scheduled health-monitor isn't 401'd before its own `CRON_SECRET` check runs ([#8605](https://github.com/Tristan578/project-forge/issues/8605)). The cron routes remain self-protected by their bearer secret.

- [#8785](https://github.com/Tristan578/project-forge/pull/8785) [`1c936c4`](https://github.com/Tristan578/project-forge/commit/1c936c4a1d0035b38355d1a46e0b15d1eaefb3ff) Thanks [@Tristan578](https://github.com/Tristan578)! - Scope `'unsafe-eval'` out of the public content routes' and `/play`'s
  Content-Security-Policy ([#8612](https://github.com/Tristan578/project-forge/issues/8612), [#8634](https://github.com/Tristan578/project-forge/issues/8634)).

  The global `script-src` previously granted `'unsafe-eval'` to every route. It is
  genuinely required only on the editor surface (`/dev`, `/editor/:path*`), where
  the in-editor script sandbox compiles user scripts with the `Function()`
  constructor inside a same-origin worker that inherits the document CSP —
  `'wasm-unsafe-eval'` does not cover `eval`/`Function`. The CSP builder is now
  extracted to `src/lib/security/csp.ts`, and the script-free public content routes
  (`/community`, `/blog`, `/about`, `/pricing`, `/docs`, … — the user-generated
  -content surface the findings call out) plus the published-game surface (`/play`)
  receive tightened, eval-free policies.

  The route scoping had to be corrected to actually take effect. Next.js applies
  every matching `headers()` rule and the **last** writer of a duplicate header key
  wins — it is not a browser-style intersection of multiple CSP headers. The
  tightened overrides were previously listed _before_ the permissive global
  `/:path*` rule, so the global rule silently overrode them and `'unsafe-eval'`
  stayed live on both the content routes and `/play`. The ordered rule list is now
  the single source of truth in `src/lib/security/csp.ts` (global first, overrides
  after) with the ordering + per-route effective policy unit-tested, so a future
  reordering fails CI instead of silently reopening the hole.

  `'unsafe-inline'` is retained on the editor/content routes: it is required by
  Clerk and Next.js inline framework scripts, and a nonce-based migration would
  break this app's statically rendered pages (the same failure mode that forced SRI
  removal). `/play` carries neither `'unsafe-eval'` nor `'unsafe-inline'` since a
  played game runs only first-party code + WASM. Fully dropping `'unsafe-eval'`
  everywhere would require re-architecting the editor script sandbox onto a
  cross-origin/blob worker with its own CSP — tracked separately.

- [#8670](https://github.com/Tristan578/project-forge/pull/8670) [`165f4ca`](https://github.com/Tristan578/project-forge/commit/165f4caae1cdb51e24ea5309328ef980cc5595c0) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(tokens): deductTokens now performs the balance deduction and the usage-record insert in a single atomic CTE. Previously the two ran as separate statements, so a usage INSERT that failed after the balance UPDATE committed would charge a user with no token_usage row and no returned usageId — leaving the failed generation's refund path unable to run. The deduction, the usage row, and the returned usageId are now all-or-nothing (PF-839, [#8663](https://github.com/Tristan578/project-forge/issues/8663)).

- [#8404](https://github.com/Tristan578/project-forge/pull/8404) [`8899d06`](https://github.com/Tristan578/project-forge/commit/8899d06ab445fac93fc7553ba802a680b436b419) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix flaky exportAbortSignal test that intermittently reported unhandled rejection errors in CI by attaching promise rejection handlers before advancing fake timers

- [#8547](https://github.com/Tristan578/project-forge/pull/8547) [`c3a8fc2`](https://github.com/Tristan578/project-forge/commit/c3a8fc21301f48a14fbadfeeb59b757d3d1ca2ef) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix `generate_3d_model` and `generate_3d_from_image` chat handlers always returning HTTP 400. Both omitted the required `mode` field on the request body to `/api/generate/model`. The route's validator hard-requires `mode ∈ {text-to-3d, image-to-3d}`, so every text-to-3D call from chat failed before reaching Meshy. Closes [#8544](https://github.com/Tristan578/project-forge/issues/8544).

- [#8457](https://github.com/Tristan578/project-forge/pull/8457) [`deb1580`](https://github.com/Tristan578/project-forge/commit/deb1580d70558468a7ef8793d75ca087d1529d75) Thanks [@Tristan578](https://github.com/Tristan578)! - fix: suppress network TypeError from Sentry in generationStore.hydrateFromServer

- [#8403](https://github.com/Tristan578/project-forge/pull/8403) [`0fb4ae0`](https://github.com/Tristan578/project-forge/commit/0fb4ae086aa9ee6e7262c7b76e625730da9ef470) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix /api/health and /api/status returning 404 in production by adding them to the Clerk proxy public routes list

- [#8655](https://github.com/Tristan578/project-forge/pull/8655) [`41100a6`](https://github.com/Tristan578/project-forge/commit/41100a6b6b631eedc3930044a8ee9bf757437761) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(deps): resolve a root `package-lock.json` drift that broke frozen `npm ci` repo-wide with EUSAGE (the Vercel preview-deploy job and every Quality Gates job that runs `npm ci` as setup).

  - `@anthropic-ai/sdk`: the lockfile still resolved `0.93.0` while `web/package.json` declared `^0.100.1` — synced the lockfile to `0.100.1` (no `engines` constraint; no runtime code imports it directly, the Anthropic path goes through `@ai-sdk/anthropic`).
  - `portless`: `web/package.json` declares `^0.13.0`, but the root lockfile had drifted — it still pinned the Node-20-era `0.12.0`, which does **not** satisfy `^0.13.0`, so frozen `npm ci` failed with `EUSAGE Missing: portless@0.13.x from lock file`. Regenerated the root lockfile to `portless@0.13.1`, the newest line satisfying `^0.13.0`, which requires Node `>=24`. That is correct for this repo — it targets Node 24 (`.node-version` = `24`, `engines.node` `">=24 <25"`). This is a **forward-fix to match the manifest, not a revert**, and no `dependabot.yml` ignore is involved.

  No source change.

- [#8448](https://github.com/Tristan578/project-forge/pull/8448) [`5ede9b5`](https://github.com/Tristan578/project-forge/commit/5ede9b5aa971ff4aeedfd5d7e564da7f245878ce) Thanks [@Tristan578](https://github.com/Tristan578)! - fix: add missing @testing-library/user-event dependency and fix test imports for nightly quality gate

- [#8672](https://github.com/Tristan578/project-forge/pull/8672) [`a195378`](https://github.com/Tristan578/project-forge/commit/a1953783e5f81b465b16028eb37638743ec98803) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(ci): align the Node runtime version across the whole monorepo on the canonical major 24.

  The Node version was declared in many drifting places — `.node-version` (24, used by Vercel) disagreed with `.nvmrc` (20), with `engines.node` (`>=20 <25`), and with 31 hardcoded `node-version: 20` inputs to `actions/setup-node` across every GitHub workflow. CI therefore ran on Node 20 while Vercel built on Node 24, the "green in CI, broken on Vercel" footgun (PF-841, [#8665](https://github.com/Tristan578/project-forge/issues/8665)).

  - `.node-version` is now the single source of truth; every `actions/setup-node` step reads it via `node-version-file: .node-version` instead of a hardcoded literal, so there is exactly one place to bump.
  - `.nvmrc` and `engines.node` (`>=24 <25`) now agree, and the previously engines-less workspaces (`apps/docs`, `apps/design`, `packages/ui`) declare `engines.node`.
  - Dropped the now-obsolete `dependabot.yml` ignore that blocked `portless >=0.13.1` "until we adopt Node 24" — that condition is satisfied.
  - A node-environment vitest guard (`web/src/lib/config/__tests__/nodeVersionConsistency.test.ts`) fails CI if any of these sources drift apart again.

- [#8481](https://github.com/Tristan578/project-forge/pull/8481) [`66feaf8`](https://github.com/Tristan578/project-forge/commit/66feaf8a96a6dda613abfffbf5b82e99b74e230a) Thanks [@Tristan578](https://github.com/Tristan578)! - fix: pin @clerk/nextjs, @clerk/shared, hono, @hono/node-server, dompurify, protobufjs to patched versions via root overrides to resolve 4 critical + 8 medium dependabot alerts

- [#8704](https://github.com/Tristan578/project-forge/pull/8704) [`9227d70`](https://github.com/Tristan578/project-forge/commit/9227d70d8c8233e129bd5fe1a8bd0ba4bb36ee94) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix account deletion leaving an orphaned Clerk identity. `POST /api/user/delete` purged all DB data but never deleted the Clerk user, so the Clerk session/user survived and the next authenticated request re-synced a fresh empty DB user — silently resurrecting the "deleted" account. The route now deletes the Clerk identity after the DB purge, in its own try/catch: the DB delete is the privacy-critical step and runs first (a failure 500s and keeps the Clerk user intact), while a Clerk-side failure after the DB commit reports success and captures to Sentry for manual cleanup rather than 500ing ([#8606](https://github.com/Tristan578/project-forge/issues/8606)).

- [#8782](https://github.com/Tristan578/project-forge/pull/8782) [`9423432`](https://github.com/Tristan578/project-forge/commit/94234328742d958ecb9af8e06403e3135cf04f66) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix payment-integrity gaps in webhook idempotency and marketplace downloads.

  - Webhook idempotency ([#8637](https://github.com/Tristan578/project-forge/issues/8637)): `claimEvent` now uses `INSERT ... ON CONFLICT DO UPDATE` guarded on row expiry (`setWhere: expiresAt < NOW()`), so a claim left behind by a crash between claim and finalize becomes re-claimable once its 5-minute in-flight TTL lapses — restoring the documented "crash mid-claim auto-expires so Stripe can redeliver" guarantee that the previous `DO NOTHING` conflict silently broke. The health-monitor cron now opportunistically prunes expired claim rows so the table cannot grow unbounded; the prune is best-effort and never fails the cron.
  - Marketplace downloads ([#8636](https://github.com/Tristan578/project-forge/issues/8636)): a paid asset download is now gated on the buyer's completed deduction credit-transaction, not merely the existence of the purchase row. A crash between the purchase-row insert and the balance deduction could otherwise leave an orphan row that handed the buyer the paid asset for free. Free purchases and owners are unaffected.
  - Marketplace purchases ([#8636](https://github.com/Tristan578/project-forge/issues/8636)): the paid-purchase flow (idempotency-gate row + buyer balance deduction + buyer/seller credit-transactions + download-count increment) now runs as ONE atomic `neonSql.transaction([...])` instead of separately-committed statements. A crash mid-flow could previously leave the buyer charged with no deduction row — permanently denying the download gate while the orphan purchase row turned every retry into a 409 (paid, but can never download). The whole charge is gated in SQL on the buyer being solvent right now, so a partial charge is impossible, and a pre-fix orphan purchase row is now recoverable on retry.

- [#8701](https://github.com/Tristan578/project-forge/pull/8701) [`cf766e2`](https://github.com/Tristan578/project-forge/commit/cf766e2136fafa26c0cbfc91e2b54b6f88346084) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix silent token loss when a platform API key is misconfigured. `resolveApiKey` now validates the platform key is present _before_ deducting tokens, so a missing key (server misconfiguration) fails without charging the user for a call that can never run. The non-cached generation path also converts a non-`ApiKeyError` resolution failure into a structured 500 with Sentry capture, instead of re-throwing it as an uninstrumented unhandled rejection. Every 500 from a generation route now returns a single opaque message instead of the raw error text, so server internals (env var names, DB connection strings, provider request IDs) are no longer leaked to the client — the full error is still sent to Sentry ([#8597](https://github.com/Tristan578/project-forge/issues/8597)).

- [#8520](https://github.com/Tristan578/project-forge/pull/8520) [`3cfde95`](https://github.com/Tristan578/project-forge/commit/3cfde95fc86a59c76e70884181d60d2fae22371a) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(seo): filter for status='published' in /play/[userId]/[slug] generateMetadata

  The standalone `generateMetadata` query on `/play/[userId]/[slug]/page.tsx` did not filter for `status = 'published'`, so a request for an unpublished/draft game with a known slug returned the draft's title and description in the HTML `<title>` and `<meta>` tags even though the page body itself was correctly gated. Consolidated `generateMetadata` and the page-level `getGameData` into a single `React.cache`-memoized helper that always filters on published status.

- [#8671](https://github.com/Tristan578/project-forge/pull/8671) [`bbf1a76`](https://github.com/Tristan578/project-forge/commit/bbf1a763cfd3d8de10c4d20c49d08ac20f7e734b) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(observability): rate-limit fail-open/degrade paths are no longer silent. `checkDbRateLimit` previously swallowed every non-`DbRateLimitError` Upstash failure and allowed the query through (fully failing open) with no signal, and `rateLimit()` had an empty catch that silently degraded to per-instance in-memory limiting — so during an Upstash outage both protections vanished or weakened with zero observability. All three fail-open paths (`checkDbRateLimit`, `rateLimit`, and `distributedRateLimit`, which previously used an un-throttled `captureException`) now report the bypass through a new shared `sampledCaptureException` helper that throttles to at most one Sentry event per action per 60s (so a sustained outage can't turn the alert into its own storm) and never lets a Sentry-SDK failure escape and break the fail-open guarantee. The legitimate over-limit path (`DbRateLimitError`) and the healthy Upstash path are unchanged — no new noise on success (PF-840 [#8664](https://github.com/Tristan578/project-forge/issues/8664), PF-842 [#8666](https://github.com/Tristan578/project-forge/issues/8666)).

- [#8669](https://github.com/Tristan578/project-forge/pull/8669) [`cc396c1`](https://github.com/Tristan578/project-forge/commit/cc396c153ed354b68b00be076fd3f5071339a771) Thanks [@Tristan578](https://github.com/Tristan578)! - Make token refunds idempotent under concurrency. `refundTokens` and `refundTokenAmount` guarded their refund INSERT with `WHERE NOT EXISTS`, a READ COMMITTED snapshot check rather than a lock, so two concurrent refunds for the same usage could both credit the user. The refund INSERTs now use a UNIQUE partial index plus `ON CONFLICT DO NOTHING`, so the credit fires exactly once even under concurrent retries.

- [#8673](https://github.com/Tristan578/project-forge/pull/8673) [`5ef60d0`](https://github.com/Tristan578/project-forge/commit/5ef60d0661d084ec638055eb0bbd1a099f663225) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(api): isolate in-flight dedup failures per joiner in the AI generation response cache

  `cachedGenerate()` shares a single in-flight promise across concurrent callers
  with the same cache key. Previously, when that shared promise rejected (a
  transient provider error, or — for a same-user request — an `ApiKeyError`),
  **every** waiting joiner inherited the same rejection and was permanently bound
  to one attempt's failure, even though each could have succeeded independently.

  The joiner path now isolates failures: on rejection it re-checks the cache (so a
  surviving joiner rides a concurrently-populated result instead of redundantly
  regenerating and re-charging) and otherwise falls through to run its own
  independent attempt. Because the failed originator already releases any tokens it
  deducted, a joiner only pays when its own attempt succeeds. The userId-in-key
  invariant that keeps dedup same-user-only is now documented next to the in-flight
  logic and locked by a guard test.

  In-flight cleanup is now identity-guarded: because multiple joiners can run their
  own attempts on the same key concurrently, a settling caller only deletes the
  in-flight entry it actually registered. A blind delete would evict a live sibling
  entry and break dedup for requests arriving before it settles.

- [#8705](https://github.com/Tristan578/project-forge/pull/8705) [`c228310`](https://github.com/Tristan578/project-forge/commit/c2283108f547f73b8bc699b25a432846a5119496) Thanks [@Tristan578](https://github.com/Tristan578)! - Harden the script sandbox against the constructor-chain escape. User scripts run in a Web Worker whose dangerous globals were only _name-shadowed_ (passed as `undefined` parameters), which does not stop `(0).constructor.constructor('return fetch')()` from reaching the real `Function` constructor and resolving `fetch` in global scope. Because the worker is same-origin to the editor, an escaped `fetch` carried the author's session cookies and could exfiltrate via a `no-cors` POST regardless of CORS. The worker now revokes the network/storage capabilities themselves at init. `revokeNetworkGlobals()` locks `fetch`/`XMLHttpRequest`/`WebSocket`/`importScripts`/`EventSource`/`BroadcastChannel`/`indexedDB`/`caches` (plus the nested-worker constructors below) to non-configurable `undefined` **through the whole prototype chain** — per WebIDL these live on `WorkerGlobalScope.prototype`, not as own properties of the global, so an instance-only own-property shadow would hide `globalThis.fetch` yet leave `Object.getPrototypeOf(globalThis).fetch` live and callable (a same-origin credentialed `no-cors` exfil POST that CORS does not block). After the revoke an escaped script has no network capability to abuse, by name _or_ by prototype walk. It also closes two non-`fetch` vectors a constructor-chain escape could otherwise reach: `navigator.sendBeacon` (a credentialed `no-cors` POST) is revoked through the whole prototype chain — in a real worker the method lives on `WorkerNavigator.prototype`, so an instance-only shadow would leave `Object.getPrototypeOf(navigator).sendBeacon` callable — and the `Worker`/`SharedWorker` constructors (plus `WebTransport`) are revoked so an escape cannot spawn a nested same-origin worker with a fresh, network-capable global. The revoke is guarded to run only inside a real `WorkerGlobalScope`, so importing the worker module under a test runner no longer locks the shared global (which crashed jsdom env teardown). Misleading "this is mitigated by shadowing"/"CORS protects us"/"navigator carries no network capability" comments in the sandbox and its tests are corrected to reflect the real boundary ([#8607](https://github.com/Tristan578/project-forge/issues/8607)). A true isolation boundary (sandboxed origin / AST interpreter) is tracked as a follow-up in [#8700](https://github.com/Tristan578/project-forge/issues/8700).

- [#8789](https://github.com/Tristan578/project-forge/pull/8789) [`e8ac515`](https://github.com/Tristan578/project-forge/commit/e8ac51583cd9182367054c53d14c9c6b939a9476) Thanks [@Tristan578](https://github.com/Tristan578)! - Harden secret handling and unauthenticated metadata exposure:

  - **Structured logger redaction ([#8642](https://github.com/Tristan578/project-forge/issues/8642)):** `logger.*` now redacts values under
    sensitive key names (apiKey, token, secret, password, authorization,
    encryptedKey, …) and scrubs secret-shaped substrings (Bearer tokens, Stripe
    `sk_/pk_/whsec_`, OpenAI `sk-`, `forge_`, JWTs) from log messages and nested
    context/Error objects before they reach stdout or aggregation. Depth- and
    cycle-bounded so a pathological context object can never hang the logger.
  - **Encryption master key validation ([#8641](https://github.com/Tristan578/project-forge/issues/8641)):** `ENCRYPTION_MASTER_KEY` is now
    validated as a 64-character hex string both at startup
    (`validateEnvironment()`) and in `getMasterKey()`, surfacing a clear error
    instead of a cryptic "Invalid key length" on the first BYOK encrypt/decrypt
    (`Buffer.from(hex)` silently truncates at the first non-hex char).
  - **Health endpoint metadata ([#8648](https://github.com/Tristan578/project-forge/issues/8648)):** the unauthenticated `/api/health`
    response no longer exposes the git branch ref (`VERCEL_GIT_COMMIT_REF`), which
    leaked internal branch naming and in-flight feature work. The short commit SHA
    is still returned for build identification.

- [#8452](https://github.com/Tristan578/project-forge/pull/8452) [`d935f78`](https://github.com/Tristan578/project-forge/commit/d935f789412a87bab3186f56e6682cf3d5793cee) Thanks [@Tristan578](https://github.com/Tristan578)! - fix: replace useState+useEffect with useSyncExternalStore for navigator.share detection in ShareButtons

- [#8784](https://github.com/Tristan578/project-forge/pull/8784) [`1aa08b0`](https://github.com/Tristan578/project-forge/commit/1aa08b01592f69ac9c9c7a00b555562536180f2c) Thanks [@Tristan578](https://github.com/Tristan578)! - Stop the marketplace asset detail (`/api/marketplace/assets/[id]`) and community game detail (`/api/community/games/[id]`) endpoints from leaking non-public records. Both detail routes fetched by `id` with no status constraint, so draft/pending/rejected/removed assets and processing/unpublished/removed games were exposed to anyone who knew (or guessed) an id — diverging from the list routes, which already filter to `status = 'published'`. The detail queries now apply the same `status = 'published'` filter and return 404 for anything else, so a record's existence is not disclosed.

- [#8508](https://github.com/Tristan578/project-forge/pull/8508) [`1a78a3f`](https://github.com/Tristan578/project-forge/commit/1a78a3fc41204088c80297058e6960a12fe7a720) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix Pro model dropdown disabled for Pro users on first paint. The user's tier
  defaulted to `'starter'` until the profile API resolved, causing the chat input
  to incorrectly disable premium models. Now `EditorLayout` calls `fetchProfile`
  on mount, and the dropdown only enforces the tier gate after `profileLoaded` is
  true.

- [#8366](https://github.com/Tristan578/project-forge/pull/8366) [`c224bba`](https://github.com/Tristan578/project-forge/commit/c224bbac02ea03323ef4e52266fc7f1a889351c7) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix recordStepUsage hardcoding token source as 'monthly' -- now propagates the actual source (monthly/addon/mixed) from the reservation record for accurate audit trails.

- [#8790](https://github.com/Tristan578/project-forge/pull/8790) [`bf2d781`](https://github.com/Tristan578/project-forge/commit/bf2d781631f397bd59314c80c55715e02f04d5a1) Thanks [@Tristan578](https://github.com/Tristan578)! - Harden moderation-appeal authorization and complete the GDPR data export.

  - `POST /api/moderation/appeal` now verifies the authenticated user owns the
    referenced content (comment/game/asset) before filing an appeal, returning
    404 (not 403, to avoid disclosing existence) when they do not. `contentId` is
    now validated as a uuid so malformed ids are rejected with 400 instead of
    surfacing as a 500. ([#8613](https://github.com/Tristan578/project-forge/issues/8613))
  - `POST /api/admin/moderation/appeals/[id]/review` re-confirms the appellant
    authored the comment before clearing its `flagged` state (defense-in-depth).
  - `GET /api/user/export-data` now includes the previously-omitted user-owned
    tables: game comments, ratings, likes, follows, forks, marketplace listings,
    asset purchases, asset reviews, the seller profile, and moderation appeals.
    ([#8639](https://github.com/Tristan578/project-forge/issues/8639))

- [#8458](https://github.com/Tristan578/project-forge/pull/8458) [`ab525f1`](https://github.com/Tristan578/project-forge/commit/ab525f128bc3b58c0e83ab7f10b6756ad72db70c) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix WelcomeModal test broken by missing @testing-library/user-event dependency — replace dynamic userEvent.click with fireEvent.click

- [#8668](https://github.com/Tristan578/project-forge/pull/8668) [`1620392`](https://github.com/Tristan578/project-forge/commit/1620392cff1fb5f1743e31ff8d41f80d6408a2dc) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(engine): resolve the B0002 ECS panic that crashed the engine on entering Play mode in any scene containing a win-condition game component.

  `system_win_condition` declared both `Option<Res<GameComponentRuntime>>` and `Option<ResMut<GameComponentRuntime>>`, registering a read and a write of the same resource in one system. Bevy treats that as the canonical B0002 access conflict and panics the schedule when the system runs (Edit → Play inserts `GameComponentRuntime` and registers the system under `PlaySystemSet`). Merged the two params into a single `Option<ResMut<GameComponentRuntime>>`, reading and writing through it. Added native ECS regression tests (`win_condition_tests`) that run the system in a `Schedule` to assert no access conflict and that the `game_win` event fires exactly once when the score target is met. Requires a WASM rebuild (handled by CD).

- [#8286](https://github.com/Tristan578/project-forge/pull/8286) [`3cd6336`](https://github.com/Tristan578/project-forge/commit/3cd633672c889112add84195ac23cd9107e16c6d) Thanks [@Tristan578](https://github.com/Tristan578)! - Add global focus-visible ring for keyboard navigation accessibility (WCAG 2.4.7)

- [#8833](https://github.com/Tristan578/project-forge/pull/8833) [`d23b4ba`](https://github.com/Tristan578/project-forge/commit/d23b4ba24575aa9323677681645bc5eb060daec9) Thanks [@Tristan578](https://github.com/Tristan578)! - Add a flag-gated generation agent loop (USE_GENERATION_AGENT) that wraps the
  createGenerationHandler provider call with deterministic step + wall-clock
  timeout caps, reducing the single-point-of-failure risk behind all
  /api/generate/\* routes. Default off; response contract (incl. usageId and the
  provider-success-with-no-artifact -> failed mapping) is preserved byte-for-byte.

- [#8786](https://github.com/Tristan578/project-forge/pull/8786) [`cf00a94`](https://github.com/Tristan578/project-forge/commit/cf00a94a3f8b4fc29a8a21acbc965a9268b655e1) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix `get_generation_status` returning a false "Could not find generation job"
  for valid `pixel-art`, `sprite_sheet`, and `tileset` jobs ([#8762](https://github.com/Tristan578/project-forge/issues/8762)). The chat
  tool's hand-maintained type→status-route map had drifted from the auto-poller's
  (`useGenerationPolling`), omitting the three types added since. Both now consume
  a single exported `STATUS_ENDPOINTS` source of truth in
  `@/lib/generation/statusEndpoints`, and a unit test pins the type set so any
  future generation type that is added to one consumer but not the map fails CI.

- [#8442](https://github.com/Tristan578/project-forge/pull/8442) [`cd9d0f5`](https://github.com/Tristan578/project-forge/commit/cd9d0f51166ca46624e78a457a0b14b4fe1b76ff) Thanks [@Tristan578](https://github.com/Tristan578)! - Optimize README with structured product summary, key statistics, and positioning sections for LLM discoverability. Add keywords to package.json files.

- [#8394](https://github.com/Tristan578/project-forge/pull/8394) [`8207f3e`](https://github.com/Tristan578/project-forge/commit/8207f3e63145a737f2a9c5f01827a74c13cd4418) Thanks [@Tristan578](https://github.com/Tristan578)! - Add test coverage for asset handlers, security handlers, and safeLocalStorage (29 tests)

- [#8395](https://github.com/Tristan578/project-forge/pull/8395) [`f828445`](https://github.com/Tristan578/project-forge/commit/f8284459d89ad4587a91009757f3691f8645b5fc) Thanks [@Tristan578](https://github.com/Tristan578)! - Add unit tests for performance, leaderboard, and export chat handlers (48 tests)

- [#8391](https://github.com/Tristan578/project-forge/pull/8391) [`0e547ea`](https://github.com/Tristan578/project-forge/commit/0e547eafad823ed8c11cea3284ccb594fefca360) Thanks [@Tristan578](https://github.com/Tristan578)! - Add test coverage for 5 previously untested modules: leaderboard, performance, and export chat handlers plus verify and physics profile game-creation executors (75 tests)

- [#8532](https://github.com/Tristan578/project-forge/pull/8532) [`8332250`](https://github.com/Tristan578/project-forge/commit/8332250e3746233bc3580ef0ddd205853adde5d4) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix `HistoryStack::push_redo()` to enforce `max_size` and set the `dirty` flag, restoring symmetry with `push()` and `push_undo_only()`. Editor "unsaved changes" indicator now reflects redo-state changes after an undo. The cap was previously bounded only implicitly by the in-flight undo flow; making it an explicit invariant of the type narrows the search space for future state-dependent engine panics. Resolves [#8531](https://github.com/Tristan578/project-forge/issues/8531).

- [#8385](https://github.com/Tristan578/project-forge/pull/8385) [`d621a06`](https://github.com/Tristan578/project-forge/commit/d621a06139a9389475b8f4e87c643ec33852ae38) Thanks [@Tristan578](https://github.com/Tristan578)! - Inspector transform buttons now meet WCAG AA 44px minimum touch target size on mobile

- [#8328](https://github.com/Tristan578/project-forge/pull/8328) [`afd1665`](https://github.com/Tristan578/project-forge/commit/afd1665b9b5ac6e81e9bd8b791a709f26fdb1a35) Thanks [@Tristan578](https://github.com/Tristan578)! - Add F6/Shift+F6 keyboard navigation to cycle focus between editor regions (Sidebar, Scene Hierarchy, Canvas, Inspector). Standard IDE pattern for panel navigation. Includes WCAG landmark regions and focus-visible indicators.

- [#8390](https://github.com/Tristan578/project-forge/pull/8390) [`ce64a63`](https://github.com/Tristan578/project-forge/commit/ce64a63a8bc2d7651c0bc8cd940b57f1ec411a48) Thanks [@Tristan578](https://github.com/Tristan578)! - Add k6 load test scripts for chat API, generation routes, and Stripe webhook storm

- [#8386](https://github.com/Tristan578/project-forge/pull/8386) [`ebaa5a9`](https://github.com/Tristan578/project-forge/commit/ebaa5a97fdc4f98548c4c6e272bc5702ce916032) Thanks [@Tristan578](https://github.com/Tristan578)! - Loop guard injection now uses acorn tokenizer for accurate keyword detection in template literals

- [#8326](https://github.com/Tristan578/project-forge/pull/8326) [`cf29d4f`](https://github.com/Tristan578/project-forge/commit/cf29d4f2955f306e0a3fa31834931981b74655c4) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix marketplace purchase test mocks to match withApiMiddleware refactor and correct changeset package names for Release workflow.

- [#8580](https://github.com/Tristan578/project-forge/pull/8580) [`18ea269`](https://github.com/Tristan578/project-forge/commit/18ea2694f7c0397ff9071d4e716d0e37431001c2) Thanks [@Tristan578](https://github.com/Tristan578)! - May 2026 routine minor/patch dependency updates ([#8576](https://github.com/Tristan578/project-forge/issues/8576)) plus a `bevy_rapier3d` 0.34 compatibility audit ([#8577](https://github.com/Tristan578/project-forge/issues/8577)).

  Bumped within existing semver ranges: `@clerk/nextjs` 7.4.2 (and the root tree-wide override + `apps/docs` floor to match), `@neondatabase/serverless` 1.1.0, `@sentry/nextjs` 10.55.0, `@upstash/redis` 1.38.0, `ai` 6.0.193, `next` 16.2.6, `posthog-js` 1.376.4, `stripe` 22.2.0, `zod` 4.4.3, `zustand` 5.0.14, `@playwright/test` 1.60.0, and `vitest`/`@vitest/coverage-v8` 4.1.7 (kept lockstep at root + web).

  The `stripe` 22.2.0 bump pins the SDK `ApiVersion` literal to `2026-05-27.dahlia`; updated `stripe-client.ts`, the three billing route tests, and the webhook comment to match (tsc would otherwise fail). No source/runtime behavior change beyond the dependency floors.

- [#8753](https://github.com/Tristan578/project-forge/pull/8753) [`f20b950`](https://github.com/Tristan578/project-forge/commit/f20b9502dc76fd4ce1b20b39196aeb3a5da759e1) Thanks [@Tristan578](https://github.com/Tristan578)! - Mount `useScriptRunner` in the editor canvas so user entity scripts actually run when the game enters Play mode. The hook that registers the per-frame play-tick callback was never mounted by any component, so pressing Play rendered the scene but executed none of the user's scripts. The hook self-gates on `engineMode === 'play'`, so it stays inert in Edit mode.

- [#8389](https://github.com/Tristan578/project-forge/pull/8389) [`a874887`](https://github.com/Tristan578/project-forge/commit/a874887ac81acd7b3f431729a2e8baa193f7435c) Thanks [@Tristan578](https://github.com/Tristan578)! - Add comprehensive negative/error case test suite for 4 API routes (52 tests)

- [#8333](https://github.com/Tristan578/project-forge/pull/8333) [`4018e2e`](https://github.com/Tristan578/project-forge/commit/4018e2e5d9cb9c1b3dfc1bcd602b764442903099) Thanks [@Tristan578](https://github.com/Tristan578)! - Bump Next.js minimum from 16.2.2 to 16.2.3 to patch CVE-2026-23869 (high-severity DoS via React Server Components, CVSS 7.5)

- [#8513](https://github.com/Tristan578/project-forge/pull/8513) [`686014d`](https://github.com/Tristan578/project-forge/commit/686014d84c5ccc900754cc5867c18092f5c7f479) Thanks [@Tristan578](https://github.com/Tristan578)! - Stabilize two recurring nightly-quality-gate failures:

  - `AccessibilityPanel` "cleans up keybindings on unmount" was racing the React render cycle under full-suite load. Wrapping the assertion in `vi.waitFor` makes it deterministic without changing component behavior.
  - `EditorLayout` test suite failed end-to-end on a fresh clone because `@spawnforge/ui` exports from `dist/` (gitignored). Extracted the workspace build into a `build:ui` script and wired `pretest`, `pretest:changed`, and `pretest:watch` hooks so every test variant — not just `npm run test` — guarantees the package is built before vitest runs.

- [#8494](https://github.com/Tristan578/project-forge/pull/8494) [`c43080b`](https://github.com/Tristan578/project-forge/commit/c43080b8868d8b3d0b7acf5db3be67ae608f6211) Thanks [@Tristan578](https://github.com/Tristan578)! - Stabilize the nightly quality gate by replacing nested `vi.mock()` calls with `vi.doMock()` in 4 test files. `vi.mock` is statically hoisted to module scope by Vitest, so re-registering inside a function body after `vi.resetModules()` becomes a hard error in newer Vitest versions. The non-hoisted `vi.doMock()` is the correct primitive when re-registering after a module reset.

  Affected test files:

  - `src/app/api/bridges/aseprite/execute/route.test.ts`
  - `src/lib/auth/__tests__/edge-cases.test.ts`
  - `src/lib/bridges/__tests__/bridgeManager.test.ts`
  - `src/lib/rateLimit/__tests__/distributed.test.ts`

  No production behavior changes; tests pass with identical assertions.

- [#8763](https://github.com/Tristan578/project-forge/pull/8763) [`9ca5e28`](https://github.com/Tristan578/project-forge/commit/9ca5e282835b58d750b686f6feea93a15539cb1d) Thanks [@Tristan578](https://github.com/Tristan578)! - Validate the OpenAPI spec in CI and gate route drift; stop `GET /api/openapi` from leaking parse errors.

  A trailing comma in `docs/api/openapi.json` made the public `/api-docs` reference return 500 in production — the spec is `JSON.parse`'d and served verbatim by `GET /api/openapi`. The new `openapi-route-sync` CI gate validates the spec is parseable (turning that prod-500 class into a red PR) and asserts every `web/src/app/api/**/route.ts` is either documented in the spec or allowlisted in `docs/api/openapi-internal-routes.json` (a ratchet — only NEW drift fails the build). The `/api/openapi` 500 branch now routes the raw parse error to Sentry and returns a fixed, generic body instead of leaking parse internals (a `SyntaxError` naming a byte offset in the spec) to unauthenticated callers.

- [#8338](https://github.com/Tristan578/project-forge/pull/8338) [`2c29b00`](https://github.com/Tristan578/project-forge/commit/2c29b006f8e74dea0b329920e7e9d2d6a0477da2) Thanks [@Tristan578](https://github.com/Tristan578)! - Add `orbit_camera` engine command and Arrow-key / `=` / `-` viewport navigation. Keyboard-only users can now orbit and zoom the editor camera without a mouse.

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

- [#8342](https://github.com/Tristan578/project-forge/pull/8342) [`9bec024`](https://github.com/Tristan578/project-forge/commit/9bec024d7962e598f3fcb31eca915730974b895a) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(auth): catch Clerk token throws and enforce banned flag

  - `authenticateRequest` and `authenticateClerkSession` now wrap `auth()` in try/catch so expired/malformed tokens return 401 instead of propagating as 500.
  - Both helpers now reject banned users (`users.banned > 0`) with 403 ACCOUNT_BANNED. Previously the column was unused and banned users could access any authenticated route.
  - `attemptSyncWithRetry` detects Clerk 404 and returns early without retrying — closes a 500ms timing side-channel that distinguished deleted users from DB flakes.
  - Adds a schema-locking test that fails if a future refactor adds `banned` to `syncUserFromClerk`'s `onConflictDoUpdate.set()` block (which would silently unban users on re-sync).

- [#8343](https://github.com/Tristan578/project-forge/pull/8343) [`f0da819`](https://github.com/Tristan578/project-forge/commit/f0da819ea0810b356062cd455b67194b1070d071) Thanks [@Tristan578](https://github.com/Tristan578)! - test(chat): broaden chat executor integration coverage to all 29 handler domains

  - Adds `executorIntegrationBroad.test.ts` with 34 new tests covering every handler domain registered in `executor.ts` (previously only 5 of 29 had integration coverage via `executorIntegration.test.ts`).
  - Uses the real Zustand `useEditorStore` instead of `vi.fn()` stubs, exercising the same dispatch path `chatStore.approveToolCalls` uses in production.
  - Table-driven representative-tool test (`it.each`) plus a structural guard that fails loudly if a new handler domain is added to `executor.ts` without extending this list.
  - End-to-end assertions for `spawn_entity`, `update_transform`, and `get_scene_graph` verify the real store is reached through the executor.

- [#8756](https://github.com/Tristan578/project-forge/pull/8756) [`bd09d1e`](https://github.com/Tristan578/project-forge/commit/bd09d1e849bc5e16f4939eb7d88147a88605de60) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix pixel-art generation hanging for 5 minutes then erroneously refunding. The async poller (`useGenerationPolling`) polls `/api/generate/pixel-art/status`, but that route did not exist — every poll 404'd, so a Replicate (the default SDXL provider) pixel-art job never resolved, hit the 5-minute poll cap, was marked `failed`, and triggered a refund even though the image had actually been generated. Added the missing status route, mirroring the sprite status route: it resolves the platform Replicate key, polls the prediction, and maps Replicate states to the client polling contract (`succeeded`→`completed` with `resultUrl`, `failed`/`canceled`→`failed`, `processing`→`processing`, else `pending`). A `pixel_art` capability was added to the type-safe `DB_PROVIDER` map so the route resolves its key without a cast.

- [#8506](https://github.com/Tristan578/project-forge/pull/8506) [`6380a6e`](https://github.com/Tristan578/project-forge/commit/6380a6e2d511cc103e35740a64517a42eff403cf) Thanks [@Tristan578](https://github.com/Tristan578)! - Add `PostCompact` hook (`.claude/hooks/inject-post-compact.sh`) that re-emits every file under `.claude/rules/` so project rules survive auto-compaction. Claude Code only loads `CLAUDE.md` and `.claude/CLAUDE.md` on `SessionStart`; long sessions (>4hr on the main agent) lose them after compaction, causing agents to drift into deprecated patterns mid-session. The hook runs in ~30ms (well under the 5s timeout), wraps each rules file in `--- BEGIN <path> ---` / `--- END <path> ---` delimiters, and runs alongside the existing `restore-context-hints.sh`. Documented under "Long-Session Rule Persistence" in `.claude/rules/agent-operations.md`.

- [#8526](https://github.com/Tristan578/project-forge/pull/8526) [`d47b46c`](https://github.com/Tristan578/project-forge/commit/d47b46c89106b9e9feec48ae2fa1653ef18a6415) Thanks [@Tristan578](https://github.com/Tristan578)! - Add npm override pinning `postcss >=8.5.10` (top-level + nested under `next`) to mitigate Dependabot alert [#76](https://github.com/Tristan578/project-forge/issues/76) (postcss XSS via unescaped `</style>` in stringify output, GHSA-qx2v-qp2m-jg93). Next 16.2.4 pins postcss at exactly `8.4.31`, so the override needs the nested form to take effect on the transitive dep.

- [#8298](https://github.com/Tristan578/project-forge/pull/8298) [`8b3b59c`](https://github.com/Tristan578/project-forge/commit/8b3b59c34391df71b6948f6f20d41a2cab58a64d) Thanks [@Tristan578](https://github.com/Tristan578)! - Add custom bone input and default bone warning to procedural animation panel. Users can now paste bone names for GLTF models instead of being locked to hardcoded humanoid defaults.

- [#8369](https://github.com/Tristan578/project-forge/pull/8369) [`d1d94fb`](https://github.com/Tristan578/project-forge/commit/d1d94fb3fa87319acae40b9a22f3cbc9a0c62896) Thanks [@Tristan578](https://github.com/Tristan578)! - Replace pipeline+ZREM with atomic Lua EVAL in distributed rate limiter to eliminate phantom entries on deny cleanup failures

- [#8285](https://github.com/Tristan578/project-forge/pull/8285) [`caaebaa`](https://github.com/Tristan578/project-forge/commit/caaebaa101641a857af907f14cf3c877d39f0859) Thanks [@Tristan578](https://github.com/Tristan578)! - Add global prefers-reduced-motion support — disables all animations and transitions for users with OS motion preference enabled

- [#8257](https://github.com/Tristan578/project-forge/pull/8257) [`aff4651`](https://github.com/Tristan578/project-forge/commit/aff4651a49b9ede802f7be9e4b27a139ee1857b2) Thanks [@Tristan578](https://github.com/Tristan578)! - Regression tests for Copilot/Sentry findings and PR metadata enforcement hook

- [#8292](https://github.com/Tristan578/project-forge/pull/8292) [`837daea`](https://github.com/Tristan578/project-forge/commit/837daeab7d95217f5862e244fbaf1440bdc350c9) Thanks [@Tristan578](https://github.com/Tristan578)! - Replace window.confirm() with accessible ConfirmDialog across 7 editor components

- [#8779](https://github.com/Tristan578/project-forge/pull/8779) [`a80d513`](https://github.com/Tristan578/project-forge/commit/a80d51328f9ac21f756fae2df3be61ead0c34b0f) Thanks [@Tristan578](https://github.com/Tristan578)! - Routine minor/patch dependency bumps from the June 2026 changelog review (no breaking changes): `ai` 6.0.193→6.0.205, `stripe` 22.2.0→22.2.1 (ApiVersion literal `2026-05-27.dahlia` unchanged), `posthog-js` 1.376.4→1.386.6, and `vitest`/`@vitest/coverage-v8` 4.1.7→4.1.8 (co-bumped together — they are reciprocal exact peers — in BOTH the root and `web` manifests so the single hoisted copy stays collapsed; bumping only `web` would split 4.1.7 hoisted / 4.1.8 nested). Root `package-lock.json` regenerated and verified idempotent against the Lockfile Sync gate.

  Deferred from this batch (tracked as follow-ups under [#8777](https://github.com/Tristan578/project-forge/issues/8777)):

  - `next` 16.2.6→16.2.9 — held back. The `apps/docs` workspace still pins `next ^16.2.3` and the bump must be regenerated on the repo's Node 24 toolchain; regenerating the single-root lockfile on Node 25 nests `postcss@8.4.31` under `next`, bypassing the root `next.postcss >=8.5.10` override. Bump alongside `apps/docs` on the CI toolchain.
  - `@clerk/nextjs` 7.4.2→7.5.2 — held back. The root `package.json` `overrides` pin `@clerk/nextjs ^7.4.2` / `@clerk/shared ^4.14.0` deliberately, and 7.5.2 pulls `@clerk/shared 4.17.1` which removes `baseTheme` from the `Appearance` type (TS2353 against `web/src/app/layout.tsx`). Requires migrating the Clerk appearance API before the override can lift.

- [#8334](https://github.com/Tristan578/project-forge/pull/8334) [`393aaab`](https://github.com/Tristan578/project-forge/commit/393aaabd2c15799198f4a2304bb29ccdf9ed9a32) Thanks [@Tristan578](https://github.com/Tristan578)! - Bump Clerk 7.0.12, Sentry 10.48.0, PostHog 1.367.0, AI SDK 6.0.156/React 3.0.158/Anthropic 3.0.68/Gateway 3.0.95, Vitest 4.1.4

- [#8368](https://github.com/Tristan578/project-forge/pull/8368) [`7e27d74`](https://github.com/Tristan578/project-forge/commit/7e27d74c481f06007be25db83211c93646712717) Thanks [@Tristan578](https://github.com/Tristan578)! - Expand SceneHierarchy and PlayControls test suites with 35 new tests covering drag-drop, keyboard navigation, context menu, filtering, lifecycle flows, stop validation, and edge cases

- [#8728](https://github.com/Tristan578/project-forge/pull/8728) [`1be8946`](https://github.com/Tristan578/project-forge/commit/1be8946e8425db61d61bd52e39bfba6a6d86b88f) Thanks [@Tristan578](https://github.com/Tristan578)! - Backfill all schema-to-migration drift ([#8707](https://github.com/Tristan578/project-forge/issues/8707)) with migration 0006: `users.banned`, `token_purchases.refunded_cents`, `projects.theme`, `published_games.thumbnail`, the `idx_published_games_slug` index, and the `leaderboards`, `leaderboard_entries`, and `moderation_appeals` tables (plus their enums) now exist in the migration chain, not just via `db:push`. Every statement is idempotent, so the migration is a no-op against production while fully provisioning a fresh database. A new schema-migration parity test checks every schema.ts column and named index against a migrations-only PGlite, failing CI on any future drift; the test harness no longer carries reconciliation patches.

- [#8787](https://github.com/Tristan578/project-forge/pull/8787) [`e971336`](https://github.com/Tristan578/project-forge/commit/e971336c18463d247b027d6db9f4a0be74052e3e) Thanks [@Tristan578](https://github.com/Tristan578)! - Security relock: bump npm `overrides` to clear three newly-published GHSAs that were failing the `Rust Security Audit` (npm-audit) gate on `main` and, by extension, every open PR sharing that gate:

  - `undici` → `^7.28.0` (transitive via `@neondatabase/serverless` / fetch stack)
  - `vite` → `^6.4.3` (transitive dev dep via the design/storybook toolchain)
  - `hono` → `4.12.26` (transitive via `@modelcontextprotocol/sdk`, which ranges `^4.11.4`; the high-severity advisory covers `<=4.12.24`). Pinned exact because `@modelcontextprotocol/sdk` is already at its latest (1.29.0) and an exact override is the only lever — and, critically, npm's _incremental_ `npm install --package-lock-only` (the Lockfile Sync gate's regen) does not honor a _range_ override for an already-pinned transitive, so an exact pin is required for the committed lock to remain a fixpoint of the sync gate.

  Root `package-lock.json` regenerated on the repo's Node 24 toolchain and verified idempotent against the Lockfile Sync gate (a second incremental regen produces no diff) and clean against the npm-audit gate for both `web` and `mcp-server`.

  Also documents a pre-existing OpenAPI drift: `/api/generate/pixel-art/status` shipped to `main` without an `openapi.json` entry or allowlist line. Because the `openapi-route-sync` gate is `pull_request`-only, `main` never tripped it, but every open PR that touches the API surface did. Added to `docs/api/openapi-internal-routes.json` as `async-status` (matching its sibling `sprite-sheet/status` / `tileset-gen/status` polling sub-routes), so this single first-merge clears the OpenAPI gate for the rest of the queue alongside the audit gate.

- [#8780](https://github.com/Tristan578/project-forge/pull/8780) [`94d43b2`](https://github.com/Tristan578/project-forge/commit/94d43b23ecc9b60ed52ce8c8499328155b39b0e5) Thanks [@Tristan578](https://github.com/Tristan578)! - Migrate Sentry off the deprecated `sendDefaultPii: false` to the `dataCollection` framework (bump `@sentry/nextjs` 10.55→10.57; `sendDefaultPii` is `@deprecated` in 10.57 and removed in v11). The replacement object is **exhaustive** in all three configs (server, edge, client) — once any `dataCollection` key is set, Sentry falls back to permissive DEFAULTS for every omitted field, so a partial object would silently re-enable PII. Every field is opted out, which is equivalent-or-stricter than the legacy false path (cookies/queryParams/headers go from PII deny-list to fully off; `stackFrameVariables` goes `true`→`false`, finally expressing the F04 "no stack-frame locals" intent in a first-class control). Preserves the F03/F04 audit posture; `scrubSentryEvent` remains as defence-in-depth.

- [#8435](https://github.com/Tristan578/project-forge/pull/8435) [`07743e1`](https://github.com/Tristan578/project-forge/commit/07743e143cbc0a9c853a2ad5af2a889eca512b76) Thanks [@Tristan578](https://github.com/Tristan578)! - Move authenticated-user redirect from root page to proxy middleware, removing force-dynamic and enabling static caching of the landing page for improved LCP

- [#8371](https://github.com/Tristan578/project-forge/pull/8371) [`5091cee`](https://github.com/Tristan578/project-forge/commit/5091cee7aa9c56ffc84d2478460b5ae608289954) Thanks [@Tristan578](https://github.com/Tristan578)! - Add unit tests for server-side analytics event wrappers (events.server.ts)

- [#8791](https://github.com/Tristan578/project-forge/pull/8791) [`78343a3`](https://github.com/Tristan578/project-forge/commit/78343a31a2f558e6bfb8efe5bef0f5408669f0b7) Thanks [@Tristan578](https://github.com/Tristan578)! - Pin all GitHub Actions in the hand-written workflows to immutable commit SHAs
  (audit finding F35, [#8627](https://github.com/Tristan578/project-forge/issues/8627)). Third-party actions (`chromaui/action`,
  `Swatinem/rust-cache`, `changesets/action`, `dtolnay/rust-toolchain`) and
  first-party `actions/*` were referenced by floating tags — and
  `dtolnay/rust-toolchain@stable` by a mutable _branch_ — so a re-tagged or
  compromised upstream would run in CI with repository-token access. Each `uses:`
  now carries a 40-char SHA plus a `# <version>` comment (Dependabot's
  github-actions updater bumps both forward). The `dtolnay/rust-toolchain` steps
  gained an explicit `toolchain: stable` input so SHA-pinning does not drop the
  channel that the `@stable` ref previously selected. A new
  `scripts/check-actions-pinned.sh` guard runs as the path-gated
  `actions-pin-check` job inside `ci.yml` — wired into the required `CI Success`
  aggregate (and its anti-tamper map) like the other self-defending gates — so
  any future PR that reintroduces a mutable tag fails a required check rather than
  a skippable advisory workflow.

- [#8582](https://github.com/Tristan578/project-forge/pull/8582) [`2351995`](https://github.com/Tristan578/project-forge/commit/235199512ac1fe274888acbf1b40c1f54ee223dd) Thanks [@Tristan578](https://github.com/Tristan578)! - Replace the restricted Clerk `<SignUp>` form at `/sign-up` with a clear "SpawnForge is in development" notice and relabel the marketing/pricing CTAs ("Request Early Access" / "Join the Waitlist"). Sign-in is unaffected — approved users still authenticate at `/sign-in`.

- [#8750](https://github.com/Tristan578/project-forge/pull/8750) [`5084fda`](https://github.com/Tristan578/project-forge/commit/5084fda184a7eb9fc13bd655b1d4404075d1d0f5) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix phantom-success spawns in chat/compound/2D handlers ([#8748](https://github.com/Tristan578/project-forge/issues/8748)). `spawnEntity` now returns the new entity's id synchronously instead of relying on the async `primaryId` selection round-trip, so AI-driven "spawn then transform/material" commands target the entity that was actually created — including on a fresh scene where `primaryId` was `null`. Non-spawnable types and a not-yet-loaded engine now surface a real failure rather than reporting success against an undefined id.

- [#8407](https://github.com/Tristan578/project-forge/pull/8407) [`1ce75a8`](https://github.com/Tristan578/project-forge/commit/1ce75a896bd728ceeffb4ad5ddab5a457e686502) Thanks [@Tristan578](https://github.com/Tristan578)! - Split uiBuilderStore.ts (1522 -> 1004 lines) and audioManager.ts (1671 -> 1387 lines) into focused domain modules

- [#8758](https://github.com/Tristan578/project-forge/pull/8758) [`09ee118`](https://github.com/Tristan578/project-forge/commit/09ee118fcbabd61930aa7f5da9cfd1b0f2851d92) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix sprite generation status route hanging for 5 minutes on an empty Replicate result. When Replicate reports `succeeded` with no output image, the route now returns `failed` with a clear "produced no image" message so the client refunds immediately instead of polling to the timeout cap.

- [#8363](https://github.com/Tristan578/project-forge/pull/8363) [`224e096`](https://github.com/Tristan578/project-forge/commit/224e09696d655bdd567ba5bb55bc1bb04f8d0df9) Thanks [@Tristan578](https://github.com/Tristan578)! - Update test fixtures from deprecated claude-3-5-sonnet to current claude-sonnet-4-6 model IDs

- [#8760](https://github.com/Tristan578/project-forge/pull/8760) [`8bf9719`](https://github.com/Tristan578/project-forge/commit/8bf9719388e868a8c7a7bba4c9a7bdc62bb33d38) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix the "succeeded-with-no-artifact" hang across the remaining six AI generation status routes (sprite-sheet, tileset-gen, model, skybox, texture, music). When a provider reported success but produced no downloadable artifact, the route returned `status: 'completed'` with an empty result field. The client poller then threw an uncaught "No result URL"/"No texture maps", stuck the job in `downloading` for the full 5-minute poll cap, and only refunded with a generic timeout. These routes now report `failed` when the completion field is absent, so the poller refunds immediately with a meaningful error. Result/maps fields are also gated on completion so a partial artifact can't leak while a job is still processing.

  Also hardened the client poller (`useGenerationPolling`) so completion-path failures always refund: a `completed` job whose artifact later fails to download or import (expired URL, empty `{}` texture maps, invalid GLB) now triggers a token refund instead of silently marking the job failed with no refund. (Boy Scout: added the missing `captureException` Sentry hook to the tileset-gen route's 500 handler.)

- [#8387](https://github.com/Tristan578/project-forge/pull/8387) [`079a30e`](https://github.com/Tristan578/project-forge/commit/079a30e215e0bb77c564b1c7fb1457b27ae5108c) Thanks [@Tristan578](https://github.com/Tristan578)! - Asset uploads now stream directly to R2 instead of buffering up to 100MB in memory

- [#8773](https://github.com/Tristan578/project-forge/pull/8773) [`23bdd4b`](https://github.com/Tristan578/project-forge/commit/23bdd4b3c402d5ffa0d09c7a11dbcee83c86a914) Thanks [@Tristan578](https://github.com/Tristan578)! - Add a strict interactive-journey CI gate that proves the core new-user journey (generated scene → entities spawn → Play → winnable → exportable) survives on the real `next build` + `next start` server. Editor/chat store hooks are now exposed on `window` behind a build-time `NEXT_PUBLIC_E2E_HOOKS` flag (defaults off; never set by any real deploy), and a new required `test-e2e-journey` job runs the curated `@journey` spec with `E2E_STRICT_STORES=true` so a broken stage fails the build instead of silently skipping.

- [#8510](https://github.com/Tristan578/project-forge/pull/8510) [`cd4bbd1`](https://github.com/Tristan578/project-forge/commit/cd4bbd146c1051c878d7733cb071411852726527) Thanks [@Tristan578](https://github.com/Tristan578)! - Bump `stripe` from 22.0.1 to 22.1.0 and pin Stripe API version to `2026-04-22.dahlia` (was `2026-03-25.dahlia`).

  The 22.1.0 release adds support for new account capabilities (`app_distribution`, `sunbit_payments`), new account-session components (`balance_report`, `payout_reconciliation_report`), and new `BalanceTransaction.type` enum values (`fee_credit_funding`, `inbound_transfer_reversal`, `inbound_transfer`). None of those surfaces are consumed by SpawnForge today, so the bump is non-breaking for current usage.

  Tests in `web/src/app/api/billing/{checkout,portal,status}/route.test.ts` were updated to assert the new pinned version. The webhook route comment about `invoice.parent` vs `invoice.subscription` was retargeted to the new pin date.

- [#8348](https://github.com/Tristan578/project-forge/pull/8348) [`ec14d6a`](https://github.com/Tristan578/project-forge/commit/ec14d6a76d31d1e234a333da320f6bade6dddf5c) Thanks [@Tristan578](https://github.com/Tristan578)! - Add Stripe v21/v22 upgrade audit document with migration checklist and breaking change analysis.

- [#8349](https://github.com/Tristan578/project-forge/pull/8349) [`b41d428`](https://github.com/Tristan578/project-forge/commit/b41d42885885bb602ee546cfe846e739ec3de7b5) Thanks [@Tristan578](https://github.com/Tristan578)! - Upgrade Stripe SDK from 20.4.1 to 22.0.1 with API version 2026-03-25.dahlia. No code changes required — all monetary amounts already use integer cents, no decimal_string fields accessed.

- [#8505](https://github.com/Tristan578/project-forge/pull/8505) [`b0ce8c3`](https://github.com/Tristan578/project-forge/commit/b0ce8c3e3dce09e30ac9aae4906cb05c19c6cdbf) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix taskboard ticket-count hooks parsing wrong JSON shape. The `/api/board` endpoint returns `{"columns": [{"status": "...", "tickets": [...]}]}`, but three hooks were looking for a top-level `tickets` array, causing every session/prompt to fire a false "Board has 0 tickets — wrong DB path" warning even with 700+ tickets in the DB. Affects `.claude/hooks/on-session-start.sh`, `.claude/hooks/on-prompt-submit.sh`, and `.claude/hooks/taskboard-state.sh`. The fix sums `columns[].tickets` and falls back to the legacy top-level `tickets` shape so the warning fires only on a genuinely empty board.

- [#8337](https://github.com/Tristan578/project-forge/pull/8337) [`5d68b0b`](https://github.com/Tristan578/project-forge/commit/5d68b0b7941aca760236954fbc700a705b72b9db) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix GitHub project sync hook: route all taskboard traffic through Portless HTTPS (urllib's 302 downgrade was silently turning POST into GET), accept legacy project IDs in the import filter, and fall back to the configured team when a parsed `teamId` points at a stale team.

- [#8280](https://github.com/Tristan578/project-forge/pull/8280) [`7ddfa24`](https://github.com/Tristan578/project-forge/commit/7ddfa248b501333ded9ee731fb949c84a2ee09b5) Thanks [@Tristan578](https://github.com/Tristan578)! - Add explicit return types to DB client functions and replace Record<string, unknown> with typed SceneSettings interface

- [#8370](https://github.com/Tristan578/project-forge/pull/8370) [`6d95140`](https://github.com/Tristan578/project-forge/commit/6d95140305231f5368fab7dacf4eaf089c8b11c6) Thanks [@Tristan578](https://github.com/Tristan578)! - Add vi.resetModules() to 81 test files using dynamic imports to prevent module cache contamination between tests

- [#8346](https://github.com/Tristan578/project-forge/pull/8346) [`0e267bd`](https://github.com/Tristan578/project-forge/commit/0e267bd16bf52f678fd7b7e60d5d772d8c134bd1) Thanks [@Tristan578](https://github.com/Tristan578)! - Add WASM manifest version integrity checking between JS glue and WASM binary, populate same-origin fallback in CD pipeline, and add Sentry breadcrumbs for CDN fallback monitoring.

- [#8515](https://github.com/Tristan578/project-forge/pull/8515) [`e57a32e`](https://github.com/Tristan578/project-forge/commit/e57a32e6a33452931eaaa7f6323791fafb276875) Thanks [@Tristan578](https://github.com/Tristan578)! - Enrich WASM panic capture with editor state context. When the engine panics, Sentry now receives entity count, current selection, undo/redo flags, engine mode, and the last 20 dispatched commands alongside the stack trace — enough context to diagnose state-dependent crashes like [#8462](https://github.com/Tristan578/project-forge/issues/8462) from a single report. Each engine command also leaves a Sentry breadcrumb.

- [#8287](https://github.com/Tristan578/project-forge/pull/8287) [`c47b3e7`](https://github.com/Tristan578/project-forge/commit/c47b3e7c871619cf99b26682e9103e6ab395c47e) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix WelcomeModal crash in private browsing by wrapping localStorage access in try/catch

- [#8402](https://github.com/Tristan578/project-forge/pull/8402) [`97ef7f2`](https://github.com/Tristan578/project-forge/commit/97ef7f235c13e6edadb02bc6ca2e30aef969dabf) Thanks [@Tristan578](https://github.com/Tristan578)! - Wire 5 critical automation hooks into settings.json: builder-quality-gate, review-quality-gate, worktree-safety-commit (Stop), cargo-check-wasm (PostToolUse), reject-incomplete-review (SubagentStop). Fix check-arch.sh file permissions.

- [#8339](https://github.com/Tristan578/project-forge/pull/8339) [`436298f`](https://github.com/Tristan578/project-forge/commit/436298f528dc3b6b3b5de6efd584005e5c13b18c) Thanks [@Tristan578](https://github.com/Tristan578)! - Migrate 21 API routes from inline typeof/manual validation to Zod schemas via `withApiMiddleware({ validate: schema })`. Schema validation failures now return HTTP 422 `{ error: 'Validation failed', code: 'VALIDATION_ERROR', details }` instead of ad-hoc 400 messages. Business-logic 400s (conflicting constraints, route-param regex checks, malformed JSON) are unchanged.

- [#8335](https://github.com/Tristan578/project-forge/pull/8335) [`cf2beda`](https://github.com/Tristan578/project-forge/commit/cf2bedaea8327388f8f4601a53d426fda3924439) Thanks [@Tristan578](https://github.com/Tristan578)! - Migrate API routes to Zod validation via `withApiMiddleware(validate: schema)`. Replaces manual `parseJsonBody`/`requireString`/`requireObject` helpers in 8 routes (feedback, publish, projects/[id] PUT, marketplace/seller POST+PATCH, community comment, keys/[provider] PUT, user/profile PUT). Validation failures now return 422 `VALIDATION_ERROR` (standards-compliant) instead of 400. JSON parse errors remain 400. Lenient legacy behavior preserved in publish route (thumbnail/tags accept junk values via `z.unknown()` for backward compat).

- Updated dependencies [[`d9e0f22`](https://github.com/Tristan578/project-forge/commit/d9e0f22dddde2b733f0792ffef1077fa6932306b), [`bf3bc88`](https://github.com/Tristan578/project-forge/commit/bf3bc889f97d10ed00567d060acc96b869e73d13), [`93caaa9`](https://github.com/Tristan578/project-forge/commit/93caaa9519a8c9ace393baf3b4d6f088e4a02016), [`0b87885`](https://github.com/Tristan578/project-forge/commit/0b878859a7ed59a399aa14c23d783c2e3bd5e9aa), [`a195378`](https://github.com/Tristan578/project-forge/commit/a1953783e5f81b465b16028eb37638743ec98803), [`b17dfbc`](https://github.com/Tristan578/project-forge/commit/b17dfbcacdf5ab08abf00991fe30449ee6dd7af7)]:
  - @spawnforge/ui@0.2.0
