# web

## 0.8.1

### Patch Changes

- [#9552](https://github.com/Tristan578/project-forge/pull/9552) [`4910b94`](https://github.com/Tristan578/project-forge/commit/4910b9449f29866221bfc7b6b0994e86474f5e38) Thanks [@Tristan578](https://github.com/Tristan578)! - Place right-side workspace panels predictably when the Inspector is absent: fall back to any other open right-dock panel, then to Dockview's default group, instead of docking inside the 3D Viewport group.

- [#9597](https://github.com/Tristan578/project-forge/pull/9597) [`193006c`](https://github.com/Tristan578/project-forge/commit/193006c76abf18f5064e7315b89167802c3e7418) Thanks [@Tristan578](https://github.com/Tristan578)! - Restore the API reference and consented PostHog analytics by admitting their exact external origins in the routes that use them. PostHog needs BOTH of its origins: the ingest host takes the events, and a separate assets host serves every bundle posthog-js loads lazily (session recorder, surveys, exception autocapture, web vitals, remote config), so admitting only the first left those blocked. `posthog.init()` now states `asset_host` explicitly and both it and the policy read one shared constant, so the two cannot drift. Swagger UI assets are version-pinned and its CDN is allowed only on `/api-docs`.

- [#9559](https://github.com/Tristan578/project-forge/pull/9559) [`248b639`](https://github.com/Tristan578/project-forge/commit/248b639a935c01d2836fa7479811d8ff620baaa9) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix a regression from [#9539](https://github.com/Tristan578/project-forge/issues/9539): the Clerk publishable-key guard rejected a working key that carried surrounding whitespace, failing the docs production deploy. Clerk trims, so the value is trimmed before validation and whitespace is now a non-blocking warning instead of a build failure.

- [#9539](https://github.com/Tristan578/project-forge/pull/9539) [`3841130`](https://github.com/Tristan578/project-forge/commit/384113051f9bc5275150347fbdc6f5a642983836) Thanks [@Tristan578](https://github.com/Tristan578)! - Fail the build when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is set to a value that cannot work ([#9044](https://github.com/Tristan578/project-forge/issues/9044)). A missing key still builds fine and degrades to "auth is not configured"; a malformed one — the whole `NAME=value` assignment pasted as the value, a secret key, stray whitespace — now names the specific mistake at build time instead of silently shipping a dead sign-in surface.

- [#9547](https://github.com/Tristan578/project-forge/pull/9547) [`926110e`](https://github.com/Tristan578/project-forge/commit/926110e9657bd968598a84a4fcc44fff48377cfa) Thanks [@Tristan578](https://github.com/Tristan578)! - Fixed internal links that pointed at routes which do not exist.
  
  In the editor, the "You're out of tokens" modal is intentionally non-dismissible, and two of its three exits 404'd: "Buy Token Pack" and "Use Your Own API Key" now open the Billing and API Keys tabs on `/settings` instead of the `/settings/billing` and `/settings/api-keys` pages that were never built. The low-token banner, the failed-payment banner and the locked-panel upgrade prompt pointed at the same missing billing page and now open the Billing tab too. Forking a game from the community gallery landed on a dead `/editor?project=…` URL and now opens the new project in the editor.
  
  The 500 error page now offers a "Go Home" link alongside "Try Again" and "Back to Dashboard", so a signed-out visitor who hits an error has a recovery link that does not lead to a sign-in wall.
  
  On the docs site, every category tile on the MCP command reference linked to a page that did not exist; `/mcp/<category>` is now a real page listing that category's commands with their parameters, scopes and token costs. The homepage no longer links to an API reference that has not shipped.

- [#9587](https://github.com/Tristan578/project-forge/pull/9587) [`b073129`](https://github.com/Tristan578/project-forge/commit/b0731297a01eb01bbe79025466b22296a3d5bbc5) Thanks [@Tristan578](https://github.com/Tristan578)! - Derive the global Clerk CSP host from the deployment publishable key while preserving safe fallback origins.

- [#9590](https://github.com/Tristan578/project-forge/pull/9590) [`a65b1c9`](https://github.com/Tristan578/project-forge/commit/a65b1c99c88ee99768a3162267a0e53f6aff3536) Thanks [@dependabot](https://github.com/apps/dependabot)! - Take the minor/patch dependency group bump (32 packages), and carry the two fixes it needs to be green. Stripe 22.6.0 pins a new `ApiVersion` literal, so the hardcoded `apiVersion` string moves to `2026-08-26.dahlia` at all five sites that must agree (the client, the three billing route tests, and the webhook comment) — a stale literal is a TypeScript error, not a runtime one, so it took the production build and every E2E job down with it. Separately, `@sentry/nextjs` 10.72 began loading its build-time webpack plugin from the runtime server entry, and that plugin picks a browser code path whenever a global `document` exists; under jsdom it hands `fileURLToPath()` an `http:` URL and every one of the 132 test files that reaches Sentry fails at import. The vitest setup now stubs that build-only module, which nothing under `src/` uses.

- [#9563](https://github.com/Tristan578/project-forge/pull/9563) [`237b976`](https://github.com/Tristan578/project-forge/commit/237b976e369cbf6e2b3bc0b32ec31a175be7c629) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix six unhandled-promise defects and enable `@typescript-eslint/no-floating-promises` so they cannot recur ([#8938](https://github.com/Tristan578/project-forge/issues/8938)). Copying the one-time MCP key no longer reports "Copied" when the clipboard write was denied — it previously said so unconditionally, and the key was already dismissed by then. Copying the economy script and the embed snippet now report failure instead of doing nothing. Audio no longer stays muted for the rest of a session when the first resume attempt is rejected: the listeners that retry it were being removed before the resume was known to have succeeded. Pointer lock and four dynamic imports no longer raise unhandled rejections on ordinary paths (an unfocused document, a chunk fetch that fails after a mid-session deploy).

- [#9566](https://github.com/Tristan578/project-forge/pull/9566) [`662c773`](https://github.com/Tristan578/project-forge/commit/662c773c0e2bdd628589d0666d8dcf6695dc07bb) Thanks [@Tristan578](https://github.com/Tristan578)! - Stop silently discarding explicit zeros in numeric defaults ([#8938](https://github.com/Tristan578/project-forge/issues/8938)). A tutorial step declaring `delay: 0` ("advance immediately") waited 500ms instead. Audio and SFX generation requested with `durationSeconds: 0` were quietly rewritten to the 30s/5s defaults, even though the API routes deliberately pass an explicit `0` through — so the two layers disagreed and the caller was billed for an asset of a length they did not ask for. A HUD text element with a zero or negative `fontSize` now falls back to the default rather than emitting invalid CSS the browser discards. `@typescript-eslint/prefer-nullish-coalescing` is enabled so the `||`-treats-0-as-missing pattern cannot come back.

- [#9535](https://github.com/Tristan578/project-forge/pull/9535) [`7ec8489`](https://github.com/Tristan578/project-forge/commit/7ec84892bee6bd2e949769248406d9bcb93441de) Thanks [@Tristan578](https://github.com/Tristan578)! - Return an opaque server error and capture diagnostics when voice batch API-key resolution fails unexpectedly.

- [#9612](https://github.com/Tristan578/project-forge/pull/9612) [`a633288`](https://github.com/Tristan578/project-forge/commit/a633288e6da8fe0ff599d9ec7c8e023ae1921970) Thanks [@Tristan578](https://github.com/Tristan578)! - Preserve caller-supplied asset IDs when importing base64 glTF and audio data, while safely generating a new UUID when an ID is absent or invalid.

- [#9603](https://github.com/Tristan578/project-forge/pull/9603) [`1cd3d65`](https://github.com/Tristan578/project-forge/commit/1cd3d6561f6a32e11fe7996c712b7b8dfd928221) Thanks [@Tristan578](https://github.com/Tristan578)! - Use durable generation callbacks as the primary completion channel when QStash is configured. Durable jobs now perform one immediate status read, recheck when the editor regains focus, and use a 30-second capped safety cadence, while deployments without QStash retain the existing 3-second polling loop and all refund behavior.

- [#9601](https://github.com/Tristan578/project-forge/pull/9601) [`4b387fa`](https://github.com/Tristan578/project-forge/commit/4b387fa30ba9609a12ec689fe6489da7fce2daae) Thanks [@Tristan578](https://github.com/Tristan578)! - Guard every API route against transitive imports of client-only source.

- [#9602](https://github.com/Tristan578/project-forge/pull/9602) [`1f24a75`](https://github.com/Tristan578/project-forge/commit/1f24a75124a1e3cf568ebbd0847f0052a032ff47) Thanks [@Tristan578](https://github.com/Tristan578)! - Run database migration-parity tests against the real pgvector extension.

- [#9537](https://github.com/Tristan578/project-forge/pull/9537) [`fc9e246`](https://github.com/Tristan578/project-forge/commit/fc9e24608d8670b53bf922ea56ebd6814423fc73) Thanks [@Tristan578](https://github.com/Tristan578)! - Reduce the `/api/cron/health-monitor` Vercel cron from every 5 minutes to every 15 minutes ([#9531](https://github.com/Tristan578/project-forge/issues/9531)), cutting ~5,760 function invocations per month. The registry mirror in `cronMonitors.ts` moves in lockstep, and the parity suite now asserts a 4-runs-per-hour ceiling for every declared cron.

- [#9617](https://github.com/Tristan578/project-forge/pull/9617) [`2c6045c`](https://github.com/Tristan578/project-forge/commit/2c6045ccd1b9e1395ef7fe4684a93edf7e859abd) Thanks [@Tristan578](https://github.com/Tristan578)! - Deliver tileset atlas configuration to the engine through an asset-keyed registry so tilemaps can use editor-authored grid, spacing, and margin values.

## 0.8.0

### Minor Changes

- [#9394](https://github.com/Tristan578/project-forge/pull/9394) [`9a1545d`](https://github.com/Tristan578/project-forge/commit/9a1545d8e53fe46d928daa129733f70d76045bbe) Thanks [@Tristan578](https://github.com/Tristan578)! - Add a visible "Make me a game" entry point to the editor. The game-creation
  pipeline was previously reachable only when the AI chat's intent classifier
  happened to route a message to it; there was no control anywhere in the UI that
  started it. A quick-start dialog now runs the pipeline end to end, auto-approving
  only the plan gate (the user already said yes to that by typing a prompt), while
  `gate_assets` and `gate_final` still ask.

- [#9479](https://github.com/Tristan578/project-forge/pull/9479) [`5a1e705`](https://github.com/Tristan578/project-forge/commit/5a1e7058595091ef97984e64c9ed552e86167254) Thanks [@Tristan578](https://github.com/Tristan578)! - Template Gallery and the `load_template` command now actually apply the template. `sceneSlice.loadTemplate` translates the chosen template into an engine scene file, waits for the entities to appear in the scene graph, and attaches the template's scripts, game components, and input preset. A load that cannot happen — an unknown template id, no engine attached, or a scene the engine accepts and never applies — now reports the failure: the chat command returns an error, the gallery stays open and says why, and the TEMPLATE_USED / TEMPLATE_APPLIED events fire only on a real success. The MCP `load_template` schema also accepts the six 2D templates, which it previously rejected.

### Patch Changes

- [#9425](https://github.com/Tristan578/project-forge/pull/9425) [`ff8e56a`](https://github.com/Tristan578/project-forge/commit/ff8e56aeb0ce36002d54bb1f39e58d02375f30e3) Thanks [@Tristan578](https://github.com/Tristan578)! - Announce published-game loading and failure states to assistive technology.

- [#9398](https://github.com/Tristan578/project-forge/pull/9398) [`f8c3d16`](https://github.com/Tristan578/project-forge/commit/f8c3d16db40c6dfd958ca60fd7e24a828fbc5c8f) Thanks [@Tristan578](https://github.com/Tristan578)! - Audio imports now retain their decoded file size in the engine asset registry
  and report that size to the editor. Imported audio previously appeared as zero
  bytes regardless of its actual size, preventing the asset panel from displaying
  accurate metadata or warning about large files.

- [#9400](https://github.com/Tristan578/project-forge/pull/9400) [`d02e55b`](https://github.com/Tristan578/project-forge/commit/d02e55bdf8cc62beaf88627cc1a3abc7870b4619) Thanks [@Tristan578](https://github.com/Tristan578)! - Return one ordered rejection for every command when an engine command batch exceeds the 256-item limit.

- [#9482](https://github.com/Tristan578/project-forge/pull/9482) [`02a14ad`](https://github.com/Tristan578/project-forge/commit/02a14ad12902a35c5f24ac718e3d203b1275b72c) Thanks [@Tristan578](https://github.com/Tristan578)! - Wire the performance benchmark harness to real product code, a committed baseline, and a CI workflow. Previously the comparator had no caller, no baseline, and the only "benchmark" test measured hand-built fixtures.

- [#9428](https://github.com/Tristan578/project-forge/pull/9428) [`13513da`](https://github.com/Tristan578/project-forge/commit/13513dae86c4911558460fb08520a1906c93361b) Thanks [@Tristan578](https://github.com/Tristan578)! - Restrict public route wildcards to path-segment subtrees so prefix-sharing routes remain authenticated.

- [#9426](https://github.com/Tristan578/project-forge/pull/9426) [`5576425`](https://github.com/Tristan578/project-forge/commit/557642556a39a14714bc06041b3bc51088952ccb) Thanks [@Tristan578](https://github.com/Tristan578)! - Make the bundle-size gate fail closed on malformed route manifests and count every client entry associated with a route.

- [#9511](https://github.com/Tristan578/project-forge/pull/9511) [`23f1a5d`](https://github.com/Tristan578/project-forge/commit/23f1a5d61b3851050c807db6ad020bfd6a53d7a7) Thanks [@Tristan578](https://github.com/Tristan578)! - Wait for entity spawns to reach the engine frame before continuing the game-creation pipeline.

- [#9512](https://github.com/Tristan578/project-forge/pull/9512) [`9858cfc`](https://github.com/Tristan578/project-forge/commit/9858cfc6cbb8f83f4245d349dec785183ad0463e) Thanks [@Tristan578](https://github.com/Tristan578)! - Explain when scripts in a remixed game are disabled and how to re-enable trusted scripts.

- [#9463](https://github.com/Tristan578/project-forge/pull/9463) [`67257d1`](https://github.com/Tristan578/project-forge/commit/67257d176198028bd9482775494d1e3a1a4398bf) Thanks [@Tristan578](https://github.com/Tristan578)! - Fail CI closed when the Next.js build, MCP command-parity, or Playwright UI gate is skipped despite its trigger firing, and assert the anti-tamper map covers every job the CI Success aggregate waits on.

- [#9403](https://github.com/Tristan578/project-forge/pull/9403) [`ce4bad4`](https://github.com/Tristan578/project-forge/commit/ce4bad406aeea865824caa7b7209573cd5dd1686) Thanks [@Tristan578](https://github.com/Tristan578)! - Harden CI self-defense tests so comments cannot masquerade as executable security gate wiring.

- [#9399](https://github.com/Tristan578/project-forge/pull/9399) [`e8fca7e`](https://github.com/Tristan578/project-forge/commit/e8fca7e292634a7d9e3357f90341c7711577f8f3) Thanks [@Tristan578](https://github.com/Tristan578)! - Preserve authored cutscene audio volume and pitch as transient playback overrides without changing persisted entity audio settings.

- [#9414](https://github.com/Tristan578/project-forge/pull/9414) [`222696d`](https://github.com/Tristan578/project-forge/commit/222696d27270ac332bbacc7af5c20924ae185d79) Thanks [@Tristan578](https://github.com/Tristan578)! - Document the configurable database operation rate limit and its default.

- [#9405](https://github.com/Tristan578/project-forge/pull/9405) [`51132be`](https://github.com/Tristan578/project-forge/commit/51132be2b28b5bfe66bee49ccfc062299232ea03) Thanks [@Tristan578](https://github.com/Tristan578)! - Fail CI closed when the required internal docs gate is skipped despite docs changes.

- [#9466](https://github.com/Tristan578/project-forge/pull/9466) [`1f3193f`](https://github.com/Tristan578/project-forge/commit/1f3193fbce62533b67ab099f62be1ea0518b92a1) Thanks [@Tristan578](https://github.com/Tristan578)! - Playing and stopping a scene no longer erases a 2D skeletal animation. `snapshot_scene` captured the animation but `restore_scene` never put it back, so any rigged 2D entity lost its animation the moment the user pressed Stop.

- [#9488](https://github.com/Tristan578/project-forge/pull/9488) [`bf170af`](https://github.com/Tristan578/project-forge/commit/bf170af781f48f58ec3544d5fbf2c91e83233cb5) Thanks [@Tristan578](https://github.com/Tristan578)! - Align 71 MCP manifest entries with the Zod schemas their chat handlers actually validate, so the AI is no longer told about parameters the handler rejects (or left unaware of ones it requires). Covers the sprite, sprite_animation, physics2d, scripting and generation categories, and widens the manifest/schema parity test to catch future drift in both directions.

- [#9406](https://github.com/Tristan578/project-forge/pull/9406) [`7b22185`](https://github.com/Tristan578/project-forge/commit/7b2218535c2ab72a76afdc5ce939fe6d94d31b66) Thanks [@Tristan578](https://github.com/Tristan578)! - Add the documented root command for checking MCP manifest synchronization.

- [#9417](https://github.com/Tristan578/project-forge/pull/9417) [`a5a5a07`](https://github.com/Tristan578/project-forge/commit/a5a5a076c1c556ce6ca024b99dfe27c87ab284a3) Thanks [@Tristan578](https://github.com/Tristan578)! - Add live-driver fidelity coverage for the PGlite Neon query adapter.

- [#9461](https://github.com/Tristan578/project-forge/pull/9461) [`9376a60`](https://github.com/Tristan578/project-forge/commit/9376a60740d6e6373f93a43ff4c1d523217c591e) Thanks [@Tristan578](https://github.com/Tristan578)! - Bump Next.js from 16.3.2 to 16.3.3 to pick up the fix for GHSA-2xp9-vwfh-vxw4 (arbitrary code execution via the AVIF path in Image Optimization). `eslint-config-next` and `@next/bundle-analyzer` move in lockstep so the three stay on one Next release.

- [#9388](https://github.com/Tristan578/project-forge/pull/9388) [`0c0be4a`](https://github.com/Tristan578/project-forge/commit/0c0be4a3fd8f4e7968be7d13ae5ebdc4dcda9d09) Thanks [@Tristan578](https://github.com/Tristan578)! - The build panel now shows the whole story when a step is skipped or a build
  finishes with warnings, instead of silently dropping that information. A step
  the runner skipped (because an earlier step made it unnecessary) now renders
  its skip reason next to it rather than looking identical to a step that never
  ran; and warnings attached to the plan as a whole now render alongside the
  per-step ones instead of being invisible.
  
  The remediation copy that walks someone through fixing a stuck level by hand
  now matches what is actually on their screen. A 2D project's Inspector calls
  the immovable body option "Static" and the bounce field "Bounciness"; a 3D
  project's calls them "Fixed" and "Restitution" — the copy previously always
  said the 3D names, so a 2D reader following it was sent looking for an option
  that was not on their screen. It now names the label that matches the project
  type when the copy is written at the moment of the failure, and names both
  spellings where the message is fixed at build time and cannot know which
  project it will end up describing.
  
  Starting a second build while one is still finishing no longer leaves the
  editor in a state only a page reload recovers from. Cancel now reliably stops
  the build that is actually running, rather than sometimes reporting a
  cancellation while the work continued. An approval prompt belonging to a build
  that has already been superseded no longer replaces the prompt for the live
  one, so approving does what the panel says it will. And resetting while a
  build is paused for approval now unwinds that build instead of leaving it
  parked for the rest of the session, holding on to the tokens it had reserved.
  
  Build-panel text and icons are readable in every theme. Several labels sat
  below the contrast floor in at least one theme — worst case just over 4:1 in
  Mech and just over 4:1 again on the elevated surface in Rust and Ice — and the
  callout borders were faint enough to disappear entirely against their own
  tinted interiors. Step-state icons had no text alternative at all, so a screen
  reader announced nothing about whether a step had completed, failed or been
  skipped, and "skipped" was told apart from "pending" by colour alone; the two
  now use distinct glyphs as well.
  
  Editor panels follow the active theme while they load. The panel shell and its
  loading skeleton were painted with fixed colours that ignored the theme
  entirely — in the light theme the skeleton rendered as black text on an
  identical black background, so a panel caught mid-load looked like an empty
  void rather than something loading.

- [#9389](https://github.com/Tristan578/project-forge/pull/9389) [`7bb7be1`](https://github.com/Tristan578/project-forge/commit/7bb7be12994ffdb364a6ac09601340fde0981327) Thanks [@Tristan578](https://github.com/Tristan578)! - Game-creation pipeline steps now report engine rejections instead of silently
  claiming success. Camera setup, 2D character rigs, custom scripts and physics
  profiles route their engine commands through the shared batch dispatcher, and a
  refused command fails the step that sent it rather than showing a green tick.

- [#9395](https://github.com/Tristan578/project-forge/pull/9395) [`c02f7c5`](https://github.com/Tristan578/project-forge/commit/c02f7c5507a4e2dd33f6f552b913a883fc01da57) Thanks [@sentry](https://github.com/apps/sentry)! - Fix a crash on accepting cookie consent in Android WebViews that have DOM storage disabled. `hasConsented()` guarded only against a missing `window`, so a `window` whose `localStorage` is `null` threw `TypeError: Cannot read properties of null (reading 'getItem')` from PostHogProvider's storage listener. It now reads through `safeGetItem()`, which covers both that case and SSR, and denies consent rather than throwing.

- [#9468](https://github.com/Tristan578/project-forge/pull/9468) [`e81e7ae`](https://github.com/Tristan578/project-forge/commit/e81e7aebf54a3e17cd289aad05327a8c369d5284) Thanks [@Tristan578](https://github.com/Tristan578)! - Leaderboard score submissions are now bounds-checked before they reach the database. A score outside the range a Postgres `integer` column can hold, or a `metadata` object that is larger than 4 KiB or nested more than 32 levels deep, comes back as a `400` with a message naming the limit. Previously those requests were accepted by the handler, refused by the database mid-insert, and returned to the player as a generic `500` — which also filed a spurious error report on every attempt, on a route that needs no sign-in.

- [#9470](https://github.com/Tristan578/project-forge/pull/9470) [`f57395a`](https://github.com/Tristan578/project-forge/commit/f57395ad90fbaa87eb6d4443861712e92e3c3454) Thanks [@Tristan578](https://github.com/Tristan578)! - Actually delete R2 objects on account deletion and asset replacement. Nothing in
  production ever deleted an R2 object: `deleteFromR2` was exported and never
  called, so every marketplace preview and asset file uploaded to R2 was orphaned
  forever — a storage-cost leak and a right-to-erasure gap, since a deleted user's
  uploads stayed live and publicly fetchable through the CDN. That dead single-key
  helper is now removed, replaced by a batched `deleteManyFromR2`.
  
  `deleteUserAccount` sweeps the departing user's `assets/{userId}/{assetId}/`
  objects after the deletion transaction commits, and the seller upload route
  removes the object a re-upload supersedes. Both sweeps also remove each object's
  `.status.json` sidecar — the asset post-processing Worker writes one into the
  same bucket for every object it validates, and it is recorded in no database
  row, so nothing else would ever clean it up.
  
  Both paths are best-effort: a storage failure is logged and reported to Sentry
  with the affected keys but never fails the user-facing operation. Sweeps are
  de-duplicated, capped at 5000 keys, and issued as batched `DeleteObjects` calls
  (1000 keys per request) rather than one request per object. The account-deletion
  asset read is capped at 1250 rows to stay inside that ceiling; it reads one row
  past the cap so it can distinguish "exactly at the cap" from "past the cap", and
  reports the latter to Sentry with the prefix to reconcile rather than dropping
  the tail silently. `web/scripts/list-orphaned-r2-keys.ts` lists what is left
  under a prefix for reconciliation (`wrangler` has no object-listing command).
  
  Also fixes an access-control bug found in the same code path: the marketplace
  download route derived its R2 key from the raw `assetFileUrl`, which a seller can
  set to any string via the asset PATCH route, so a seller could point their own
  asset at another seller's key and be issued a signed URL for someone else's paid
  file. The key is now derived through an ownership-checked resolver.

- [#9411](https://github.com/Tristan578/project-forge/pull/9411) [`f91c696`](https://github.com/Tristan578/project-forge/commit/f91c6964056f2a649f528daa9eda453c734c237f) Thanks [@Tristan578](https://github.com/Tristan578)! - Add route-level contract coverage for authenticated pipeline budget actions.

- [#9483](https://github.com/Tristan578/project-forge/pull/9483) [`7e57deb`](https://github.com/Tristan578/project-forge/commit/7e57deb87ebdeb69bac8aa35121d8b49d1096ff4) Thanks [@Tristan578](https://github.com/Tristan578)! - Reject the unsupported OpenAI pixel-art path before API-key resolution or token charging, keeping generation on the Replicate job flow that the editor and MCP clients can retrieve.

- [#9402](https://github.com/Tristan578/project-forge/pull/9402) [`78e9712`](https://github.com/Tristan578/project-forge/commit/78e9712925bd1cceb28f3d21a515420f61bf8cfc) Thanks [@Tristan578](https://github.com/Tristan578)! - Fall back to the WebGL2 engine on published game pages when the browser cannot provide a WebGPU adapter.

- [#9513](https://github.com/Tristan578/project-forge/pull/9513) [`6b1766f`](https://github.com/Tristan578/project-forge/commit/6b1766f46616826315b8206257c24569d9811abe) Thanks [@Tristan578](https://github.com/Tristan578)! - Return only documented publication fields from the publish-list API and document the in-flight processing status.

- [#9493](https://github.com/Tristan578/project-forge/pull/9493) [`35f760b`](https://github.com/Tristan578/project-forge/commit/35f760b8ebc2494df6c43db3305b78d31a8310f4) Thanks [@Tristan578](https://github.com/Tristan578)! - Remove deleted 2D skeleton rigs from the engine, preserve overwritten rigs for undo, and tell the editor when a rig is gone. Deleting a rig — or undoing the creation of one — left the editor still showing a skeleton the engine had already dropped, so the next bone edit was authored against a rig that no longer existed.

- [#9391](https://github.com/Tristan578/project-forge/pull/9391) [`231b3a0`](https://github.com/Tristan578/project-forge/commit/231b3a0f1820c007daef33d23c158a50c3fc26d5) Thanks [@Tristan578](https://github.com/Tristan578)! - Upgrade to eslint-plugin-react-hooks 7.1.1 and fix everything its three new rule
  families found. The user-visible part is the editor Help menu: its arrow-key order
  came from a ref array indexed by a counter mutated during render, so the order was
  correct only by accident and would have silently mis-mapped had any item been
  rendered conditionally. It now follows the menu's real DOM order.

- [#9464](https://github.com/Tristan578/project-forge/pull/9464) [`7b90bf3`](https://github.com/Tristan578/project-forge/commit/7b90bf3cb28e9c4dadc87b024588c9a1ff248d5b) Thanks [@Tristan578](https://github.com/Tristan578)! - Remixing a published game no longer copies the creator's scripts in an enabled state. The source text is preserved so it can be read and adapted, but every script arrives disabled and the remixer chooses when to run it.

- [#9490](https://github.com/Tristan578/project-forge/pull/9490) [`dced86d`](https://github.com/Tristan578/project-forge/commit/dced86d95161f1265703a374f357e045862401c0) Thanks [@Tristan578](https://github.com/Tristan578)! - Make removing a game camera clear the engine camera configuration, active marker, and mode-specific runtime state instead of only clearing the editor store.

- [#9409](https://github.com/Tristan578/project-forge/pull/9409) [`19c2cd7`](https://github.com/Tristan578/project-forge/commit/19c2cd7b5e43065756a08c4202eb1267825c3bf9) Thanks [@Tristan578](https://github.com/Tristan578)! - Add runtime contract coverage between exposed chat tools and their handlers.

- [#9407](https://github.com/Tristan578/project-forge/pull/9407) [`7304f4e`](https://github.com/Tristan578/project-forge/commit/7304f4e5e6e310ebacbba8d90212c55f4a2169cc) Thanks [@Tristan578](https://github.com/Tristan578)! - Strengthen database schema contract tests to detect untracked table additions and removals.

- [#9416](https://github.com/Tristan578/project-forge/pull/9416) [`9e55366`](https://github.com/Tristan578/project-forge/commit/9e5536603337ebbb34f8d7b926dfa61a2658bc35) Thanks [@Tristan578](https://github.com/Tristan578)! - Strip query secrets and path PII from Sentry transaction span URL attributes.

- [#9404](https://github.com/Tristan578/project-forge/pull/9404) [`12009cb`](https://github.com/Tristan578/project-forge/commit/12009cbd446f4300b0dcab2fdbaaf38ad8881b5d) Thanks [@Tristan578](https://github.com/Tristan578)! - Prevent large CI self-defense inputs from inverting comment-strip checks through a pipefail SIGPIPE.

- [#9401](https://github.com/Tristan578/project-forge/pull/9401) [`f2b619c`](https://github.com/Tristan578/project-forge/commit/f2b619c424d05a5a0fce9a19ee42c376e88de5c8) Thanks [@Tristan578](https://github.com/Tristan578)! - Keep the default win-condition score when omitted while allowing an explicit null score target for non-score win conditions.

- [#9510](https://github.com/Tristan578/project-forge/pull/9510) [`20468f0`](https://github.com/Tristan578/project-forge/commit/20468f06c2e0144eb0fccc630038181926b58104) Thanks [@Tristan578](https://github.com/Tristan578)! - Document machine-readable error codes and structured error details in the public OpenAPI contract.

- [#9427](https://github.com/Tristan578/project-forge/pull/9427) [`f2f9135`](https://github.com/Tristan578/project-forge/commit/f2f9135bd6e519176d1c3827c2899be49eab8d1f) Thanks [@Tristan578](https://github.com/Tristan578)! - Remove duplicate query handler registrations so executor ordering cannot silently change behavior.

- [#9410](https://github.com/Tristan578/project-forge/pull/9410) [`ccb70ef`](https://github.com/Tristan578/project-forge/commit/ccb70efcf0c1d0f11583cea83dfdb62d00b58325) Thanks [@Tristan578](https://github.com/Tristan578)! - Add regression coverage for ownership-scoped game unpublishing.

- [#9485](https://github.com/Tristan578/project-forge/pull/9485) [`3d1f047`](https://github.com/Tristan578/project-forge/commit/3d1f047f6ebc9d0bb951884f559ebb1ed17d1560) Thanks [@Tristan578](https://github.com/Tristan578)! - Reject successful sprite, sprite-sheet, tileset, and music provider responses that omit the artifact identifier required to retrieve the generation.

- [#9436](https://github.com/Tristan578/project-forge/pull/9436) [`d6383c1`](https://github.com/Tristan578/project-forge/commit/d6383c19e1e6a52845cabd737895827d81486bea) Thanks [@Tristan578](https://github.com/Tristan578)! - Bump the `wasm-bindgen` pin from `=0.2.108` to `=0.2.127` (PF-DEP / [#9380](https://github.com/Tristan578/project-forge/issues/9380)).
  
  The crate version and the installed `wasm-bindgen-cli` must match exactly — a
  mismatch fails with opaque "missing export" errors that read like engine bugs —
  so this is a coordinated change across `engine/Cargo.toml`, `engine/Cargo.lock`,
  every workflow that runs `cargo install wasm-bindgen-cli`, and every agent
  instruction, skill, and gate script that names the pin. The exact-pin `=` form
  is kept deliberately; a caret range reintroduces the CLI-mismatch class.
  
  `cargo update -p wasm-bindgen` carried `js-sys` 0.3.85 → 0.3.104,
  `wasm-bindgen-futures` 0.4.58 → 0.4.77, and `web-sys` 0.3.85 → 0.3.104 with it.
  
  Bevy 0.19.1's own floor is only `wasm-bindgen ^0.2`, so 0.2.127 satisfies the
  pending Bevy 0.19 upgrade and does not need a second bump when that lands.
  
  All four WASM variants (editor + runtime × WebGL2/WebGPU) build clean on the new
  toolchain. Historical records (`PR.md`, `docs/audits/`) keep the old version.

## 0.7.0

### Minor Changes

- [#9314](https://github.com/Tristan578/project-forge/pull/9314) [`4bbf57a`](https://github.com/Tristan578/project-forge/commit/4bbf57aba665d142684beee9bd0eb18767998f65) Thanks [@Tristan578](https://github.com/Tristan578)! - Generated games are now playable: the pipeline builds a world and a goal
  
  Two gaps meant that nearly every game the pipeline produced could not be
  started at all. A GDD's `world` system described ground, platforms and bounds
  that nothing ever spawned, so the player landed in an empty room; and only a
  `progression` system planned a win condition, which most designs never declare,
  so `validateWinnability` answered `NO_WIN_CONDITION` and the Play button
  refused before dispatching anything.
  
  - `world` now turns `worldConfig` into real geometry — ground, platforms and
    bounds — in both 2D and 3D.
  - Every plan is guaranteed a satisfiable win condition, bound to the player by
    engine id. It defers to a real progression system rather than adding a second
    rule the player was never told about, and where there is nothing in the world
    to carry a goal it says so instead of emitting a component the engine would
    reject.
  - New `progression`, `feedback`, `entities` and `challenge` system definitions
    emit real `add_game_component` steps (win conditions, health, collectibles,
    damage zones) instead of falling through to generated scripts.
  - `verify_all_scenes` now asserts winnability and fails the plan when a game
    cannot be won, rather than reporting a playability it never checked.

### Patch Changes

- [#9276](https://github.com/Tristan578/project-forge/pull/9276) [`b1598da`](https://github.com/Tristan578/project-forge/commit/b1598da0535c09f7ec5af10f045ee55feb00c565) Thanks [@Tristan578](https://github.com/Tristan578)! - 2D physics now reaches the engine, and what the engine does with it comes back.
  Every 2D physics edit made from chat or the editor was being dropped before the
  simulation saw it — the payload was the wrong shape, two of the three commands
  had no engine handler at all, and nothing ever switched the body on. So no
  static platform, sensor trigger, one-way platform or conveyor had ever behaved
  as authored, while the inspector displayed the value that was asked for.
  
  Setting one property no longer resets the others: changing a body type or
  collider shape used to silently reset the thirteen other fields. And the editor
  now reflects what the simulation actually holds, rather than only its own
  optimistic copy.
  
  2D joints now connect. Every joint the editor has ever created was rejected
  before it reached the simulation, so no hinge, slider, rope or spring had ever
  held two sprites together — and a joint the engine reported back was dropped
  without being read, so the inspector never showed the real one. Both directions
  now speak the same vocabulary, and a parameter that belongs to a different joint
  type is no longer sent along to be quietly ignored.
  
  Adding 2D physics to an entity now starts it at the engine's own defaults, so
  the collider shape reads Box rather than Auto.
  
  Configuring an entity's 2D physics in one go — as chat and the generation
  pipeline do — no longer loses the earlier half of the change or leaves two undo
  steps behind where one edit was made.

- [#9328](https://github.com/Tristan578/project-forge/pull/9328) [`cb5ace4`](https://github.com/Tristan578/project-forge/commit/cb5ace43893f13f89228b2a426309bbac9d6d4d4) Thanks [@Tristan578](https://github.com/Tristan578)! - Add admin unpublish endpoint for DMCA/IP-infringement game takedowns.

- [#9249](https://github.com/Tristan578/project-forge/pull/9249) [`a7db9b6`](https://github.com/Tristan578/project-forge/commit/a7db9b68de88ccee9ae4bc7da13ef8df0eae0993) Thanks [@Tristan578](https://github.com/Tristan578)! - Stop the pre-play winnability check from passing a scene whose win condition type it does not recognize. Such a scene reported as winnable and started, but the engine treats an unparseable type as "reach a score" with a target that never accrues, so the game could not actually be won. The check now blocks Play and names the offending value.

- [#9246](https://github.com/Tristan578/project-forge/pull/9246) [`ee8ceae`](https://github.com/Tristan578/project-forge/commit/ee8ceae29a8232939bd555df9e9b0e4310143594) Thanks [@Tristan578](https://github.com/Tristan578)! - Cutscene playback now reaches something, and every track fires once. Dialogue starts through the dialogue store instead of dispatching `start_dialogue`, an engine command no arm has ever handled. A keyframe's `duration` bounds its beat rather than making it re-dispatch on every frame — that restarted audio and animations continuously, and on the camera track it zeroed the shake state and threw away the accumulated orbital angle and first-person look direction every tick. A keyframe payload is picked field-by-field against a per-track-type allowlist instead of being spread through whole, so nothing the generator invented reaches an engine command; audio's `volume` and `pitch` are bounded to the ranges the audio graph can produce, ahead of the entity-audio wiring that will consume them.
  
  A sink that throws now loses only its own beat instead of every later beat in the same tick, and reports to Sentry rather than only the console. Three playback transitions that each worked alone but broke in combination are fixed: seeking a stopped player and then pressing play no longer burst-fires every beat before the seek point, seeking while paused no longer charges the seek for however long the player sat paused, and pausing a player that never played no longer strands it at "playing" with nothing running and no completion.
  
  Ids named after `Object.prototype` members (`__proto__`, `constructor`, `toString`, and friends) are rejected across every reachable cutscene and dialogue surface — the chat handlers, both stores, the script runner, and the tree editor — rather than resolving to the prototype and either throwing mid-scene or handing back an object that passes an existence check.

- [#9246](https://github.com/Tristan578/project-forge/pull/9246) [`ee8ceae`](https://github.com/Tristan578/project-forge/commit/ee8ceae29a8232939bd555df9e9b0e4310143594) Thanks [@Tristan578](https://github.com/Tristan578)! - Cutscenes: keyframe payloads are now read against the track type's own vocabulary instead of being copied through whole, so a generated cutscene no longer carries invented fields into the engine. An animation keyframe with no clip and a dialogue keyframe with no tree now decline to dispatch rather than firing a command that addresses nothing. An animation keyframe that names no crossfade now omits the field entirely, letting the engine apply its own 0.3s blend — previously it was sent as `0`, an instant cut nobody asked for.

- [#9386](https://github.com/Tristan578/project-forge/pull/9386) [`188afe2`](https://github.com/Tristan578/project-forge/commit/188afe2a16dc165885456bb58bcc2e5dec1afe2a) Thanks [@Tristan578](https://github.com/Tristan578)! - Update the AI SDK and PostHog packages to their latest patch releases: `ai` 7.0.78, `@ai-sdk/react` 4.0.81, `@ai-sdk/anthropic` 4.0.41, and `posthog-js` 1.418.14. All four are patch-level bug-fix releases within the ranges already declared, so behaviour is unchanged apart from the fixes they carry.

- [#9330](https://github.com/Tristan578/project-forge/pull/9330) [`c637563`](https://github.com/Tristan578/project-forge/commit/c63756341b5b584669e35e56110dfad87c2aa8f0) Thanks [@Tristan578](https://github.com/Tristan578)! - Add DMCA takedown process to Terms of Service.

- [#9348](https://github.com/Tristan578/project-forge/pull/9348) [`2913958`](https://github.com/Tristan578/project-forge/commit/291395884754f587cb586d7ff42baf1a9b1278d3) Thanks [@Tristan578](https://github.com/Tristan578)! - The engine's command vocabulary now describes what the engine actually does.
  
  Twenty command names were routed to a domain that had no handler for them, so
  anything that called one — chat, a tool, the generation pipeline — got back
  "unknown command" for a name the surface advertised as real. Names with no
  implementation behind them have been removed; the ones worth keeping
  (`get_sprite`, `get_camera_2d`, `get_joint_2d`, `list_joints_2d`) are now
  answered. A test walks the router against every domain's own handlers, so a
  name can no longer be advertised without being reachable, and a name can no
  longer be routed to the wrong domain where a stub shadows a working handler.
  
  The ten tilemap tools now declare the parameters their handlers really read.
  Every one of them documented at least one wrong name — a tileset id, a layer
  index, a fill rectangle — so a model following the tool description supplied
  arguments that were silently discarded and the edit did nothing. The
  descriptions and the validation are now the same list, pinned by a test so they
  cannot drift apart again.
  
  Reading a 3D joint back from the engine works. The reply to a joint list
  request had no listener, so the editor asked and nothing ever arrived.
  
  Painting, erasing or filling a tile at a coordinate far outside the map no
  longer writes to an unrelated cell. On the 32-bit WebAssembly target the
  coordinate arithmetic could wrap back into range, so an out-of-bounds edit
  landed on a real tile somewhere else in the map instead of being skipped.
  
  Two identical `get_tilemap` handlers were registered, and which one ran depended
  on registration order. The remaining one is the one that rejects a malicious
  entity id rather than returning an internal object as tilemap data.

- [#9249](https://github.com/Tristan578/project-forge/pull/9249) [`a7db9b6`](https://github.com/Tristan578/project-forge/commit/a7db9b68de88ccee9ae4bc7da13ef8df0eae0993) Thanks [@Tristan578](https://github.com/Tristan578)! - Game components: numeric properties are now clamped to the same ranges the engine applies, so an out-of-range value from the AI, the MCP tools or the inspector reads back as the number the running game actually uses instead of the one that was requested.

- [#9249](https://github.com/Tristan578/project-forge/pull/9249) [`a7db9b6`](https://github.com/Tristan578/project-forge/commit/a7db9b68de88ccee9ae4bc7da13ef8df0eae0993) Thanks [@Tristan578](https://github.com/Tristan578)! - Game component values authored by the AI are now range-checked against the
  engine's own bounds before they are stored. A speed of a billion, a negative
  gravity scale, a waypoint list of strings, or a loop mode the engine has never
  heard of used to be kept verbatim by the editor while the engine quietly
  simulated something else entirely, and nothing anywhere reported the
  disagreement.
  
  The inspector also reads game components correctly for the first time, and this
  half is the more visible one: the Game Components panel was replaced by a "failed
  to render" message whose Retry button re-rendered the same crash. The engine sends
  each component in its own flat, tagged form, which the editor was casting into a
  differently-shaped type, so every component the engine reported arrived with no
  data bag at all — not an empty one, an absent one — and the panel threw the
  moment it read a field off it. Any add, update or removal
  of a game component put the panel into that state. Attaching a component now shows
  its real values in the inspector.

- [#9345](https://github.com/Tristan578/project-forge/pull/9345) [`2622710`](https://github.com/Tristan578/project-forge/commit/2622710a3569145cb59c92e060525b33d37ad160) Thanks [@Tristan578](https://github.com/Tristan578)! - Generated games can now collide, which is what makes them winnable.
  
  The creation pipeline built a player, a floor and a set of collectibles and then
  never switched physics on for any of them. Rapier only attaches a collider to an
  entity that has been enabled, and collision tracking is built purely from those
  colliders, so nothing in a generated 3D game ever touched anything else: the
  player fell through the ground, collectibles could not be picked up, score never
  moved and the win condition was unreachable however the game was played.
  
  Every gameplay entity is now given a body sized to the shape it was spawned as —
  a rotation-locked dynamic capsule for the player, sensors for pickups so
  collecting one does not knock the player sideways, and solid static bodies for
  the ground, platforms and walls. Cameras and lights are deliberately left alone
  rather than dropping invisible walls into the level.
  
  Enablement also waits for the engine to finish creating the entities before it
  addresses them. Without that pause the commands arrived a frame early, named
  entities that did not exist yet, and were discarded without any error being
  reported — the step looked successful while enabling nothing. The engine now
  also logs a warning when it is asked to enable physics on an entity it cannot
  find, so the same class of mistake cannot be silent again.

- [#9346](https://github.com/Tristan578/project-forge/pull/9346) [`0ecf5b4`](https://github.com/Tristan578/project-forge/commit/0ecf5b4f903a7180927de1c508d6fbe5e6021826) Thanks [@Tristan578](https://github.com/Tristan578)! - The player now stands on the ground. Character movement was raw translation
  added straight onto the transform, so a 3D character had no gravity, no ground
  contact and no collision response: it walked through walls and floors, and a
  jump was a tween that could be held indefinitely. It is now driven through a
  kinematic character controller with gravity, terminal velocity, ground
  snapping, a 45-degree slope limit and 0.3-unit step handling, and it collides
  with the static geometry the scene already has.
  
  Jumping requires ground. A jump is only spent when the character is actually
  standing on something, so the double jump a game grants is the double jump the
  player gets — not an unlimited one.
  
  A jump that meets a ceiling now falls. Rapier stops the character but does not
  touch its upward speed, so the character used to keep asking to rise and slid
  along the underside of the platform for the whole ascent — around 48 frames at
  the default jump height.
  
  A character the pipeline forgot to enable physics on no longer fails silently.
  It still uses the old movement path, because a kinematic controller needs a
  collider, but the engine now warns and names it instead of leaving a player who
  walks through walls in a scene that looks correct.
  
  Scripts can tell a jump from a fall. `forge.physics.isGrounded(entityId)`
  reports the ground contact the engine computed during the character sweep,
  synchronously, so a script no longer has to guess at the top of an arc. It
  answers `false` for an entity with no character controller.
  
  Shipping the engine half of this requires a WASM rebuild.

- [#9354](https://github.com/Tristan578/project-forge/pull/9354) [`9701c74`](https://github.com/Tristan578/project-forge/commit/9701c749e163a9c34f85d6e4712b788d1567fed6) Thanks [@Tristan578](https://github.com/Tristan578)! - Array and Combine now keep everything attached to your objects.
  
  Repeating an object with Array kept its look, lights, physics body, sound and
  particles, but silently threw away its gameplay components (health, damage,
  pickups), animation clips, terrain, joints, camera settings, level-of-detail
  settings and everything 2D — sprites, 2D physics, tilemaps and 2D skeletons. A
  repeated enemy stopped being an enemy.
  
  Combine was worse: the merged object inherited nothing at all from the objects
  that went into it, coming out as a plain grey shape with no material, no
  physics and no behaviour. Undoing a Combine also brought the originals back
  stripped of their physics, lights and source files.
  
  Nothing reported either loss — the objects simply came out inert.
  
  Both now carry the full component set. Sounds that were muted stay muted rather
  than switching themselves on, and a merged object keeps the gameplay behaviour
  of the first object that contributed geometry while dropping the parts that
  only describe a single shape.

- [#9366](https://github.com/Tristan578/project-forge/pull/9366) [`87399dc`](https://github.com/Tristan578/project-forge/commit/87399dcf1babfddb82f410c7441c775d2a927163) Thanks [@Tristan578](https://github.com/Tristan578)! - Add a live-engine CI gate for the game-creation pipeline (PF-1202).
  
  The per-PR `test-e2e-engine-smoke` job now also runs
  `e2e/tests/pipeline-live-engine.spec.ts`, which drives the real game-creation
  pipeline against the real WASM engine under SwiftShader and clicks the real Play
  button, asserting the engine itself reports `engineMode === 'play'`.
  
  What that buys over the existing fake-bridge integration suite is real
  deserialization, real routing through `route_domain`, and a real play
  transition. Because `dispatchCommand` returns `void`, a payload the engine HARD
  rejects leaves its pipeline step reporting `completed` and surfaces only as the
  `Engine rejected command '<name>'` line `editorStore`'s `tracked` wrapper writes
  to the console — so both tests collect console errors and page errors for their
  whole lifetime, and assert that none of those console lines names an engine
  rejection and that no page error occurred. A payload the engine accepts but whose
  keys deserialize to `None` still logs nothing and is still not caught here; that
  remains the job of the pick-based payload builders and their unit pins.
  
  A companion negative test proves an unwinnable design fails verification, that
  Play refuses it by appending the winnability refusal to the chat surface, and
  that the engine is still answering commands afterwards — so a dead engine cannot
  pass it by staying silent.
  
  The 3D "Crystal Run" GDD used by both gates now lives in one shared fixture,
  `web/e2e/fixtures/gdd/crystal-run-3d.json`, so the fast and slow gates cannot
  drift into testing different games.

- [#9353](https://github.com/Tristan578/project-forge/pull/9353) [`77415d9`](https://github.com/Tristan578/project-forge/commit/77415d95749a18cd154299510c88e88e5eb40ea6) Thanks [@Tristan578](https://github.com/Tristan578)! - Physics enablement in the generation pipeline now covers every shape it claims
  to.
  
  The feel pass (`physics_profile`) tunes gravity scale, friction and restitution
  on entities that a `physics_enable` step has already given a body to. It read only
  the first such step, so anything enabled later — the ground, platforms and walls
  planned by the world system — kept a body but never received a profile. It now
  reads every one.
  
  The ground the auto-polish repair drops in is now sized the way the world
  builder sizes it, rather than at a default scale that left a visible seam
  between a repaired floor and an authored one.
  
  The shape catalogue the pipeline spawns from is now shared with the world
  builder instead of being restated, so the two can no longer disagree about what
  is spawnable, and a role whose name collides with a built-in object property no
  longer reads a shape off the prototype chain.
  
  Entity ids are validated the way the engine counts them — raw, in bytes, against
  the full control-character set — so an id the engine would refuse is refused
  here, loudly, instead of being dispatched into silence.

- [#9360](https://github.com/Tristan578/project-forge/pull/9360) [`ee558ec`](https://github.com/Tristan578/project-forge/commit/ee558ecaf293668f36905f6d6dfb352299dd8b0f) Thanks [@Tristan578](https://github.com/Tristan578)! - The generation pipeline's feel pass now runs where it can see the entities it
  profiles, and a step that fails explains itself.
  
  Reading every `physics_enable` step is worthless if the feel pass runs first.
  The planner now orders `physics_profile` after every enable step, so the ground,
  platforms and walls the world system enables actually receive gravity scale,
  friction and restitution rather than being profiled against a set that is still
  empty when the pass runs.
  
  Moving the pass also puts it after the player is rigged, so it now re-tunes the
  player's character controller — the same speed, jump height and gravity the rig
  step chose, merged onto the existing controller so nothing else about it is
  lost.
  
  A failed pipeline step showed as a red icon and nothing else: the message
  explaining what went wrong was recorded and never rendered. The orchestrator
  panel now shows it and announces it to assistive tech.
  
  That message is also followable now. It names the controls as they are labelled
  on screen, and it names the Body Type each kind of entity needs — the previous
  wording would have turned the floor into a falling body, and pointed at a re-run
  that discards the fix it had just asked for.
  
  Step outputs handed to a later step are limited to steps that completed. A
  failed step keeps its diagnostic output on purpose, so a step having output was
  never evidence that it worked.

- [#9359](https://github.com/Tristan578/project-forge/pull/9359) [`e52a13b`](https://github.com/Tristan578/project-forge/commit/e52a13b522ca3580493d2641bcbf06ab968bcbfe) Thanks [@Tristan578](https://github.com/Tristan578)! - A tilemap coordinate past the 32-bit range is now refused instead of wrapping
  into a real cell.
  
  The overflow guard in the engine's tilemap module caught coordinates outside
  the declared map, but the numbers reaching it had already been truncated. The
  layer, x and y of every paint, erase and fill were read by casting a 64-bit
  value straight to a pointer-sized one, which drops the high bits on the 32-bit
  WebAssembly target the engine ships on: an x of 4,294,967,299 arrived as 3,
  looked like an ordinary in-range cell, and painted a tile the caller never
  asked for. The tile index was cast to a fixed 32-bit integer instead, so it
  wrapped everywhere, the 64-bit test host included; the pointer-sized cast is
  the one that reproduces only on wasm32, since the host keeps the high bits.
  All four values are now rejected above the 32-bit maximum. The new native
  tests cover all four, and all four go red on the host the moment any of the
  old casts is put back: they demand that one-past-the-maximum be refused, and
  the old code accepts it on a host where nothing was truncated. What a host
  test could never have shown is the wrap itself -- the coordinate that came
  back as 3 and painted a cell.
  
  A script that passes such a coordinate gets an error naming the field, the
  value and the limit, rather than a command that disappears.
  `forge.tilemap.fillRect` also checks the far edge of the rectangle, not just
  its origin and size -- it is the cells in between that the engine reads -- and
  its error says which axis ran off the end and what it reached.

- [#9362](https://github.com/Tristan578/project-forge/pull/9362) [`a9187ab`](https://github.com/Tristan578/project-forge/commit/a9187abc3554fff92b11f5a350ffcd33f5f73ba5) Thanks [@Tristan578](https://github.com/Tristan578)! - Generated players now jump a distance a person would recognise as a jump.
  
  Every path that tuned a character controller from a physics preset passed the
  preset's unitless `jumpForce` dial straight into `jumpHeight`, which the engine
  reads as a real height in metres. The default preset therefore asked for a
  ten-metre apex with close to three seconds of hang time. The dials are now
  converted to heights through one shared calibration, and the presets that jump
  land between roughly half a second and one and a half seconds of airtime.
  
  `forge.physics.isGrounded` works in an exported game. It was documented and
  typed but the exported runtime never exposed it, so a script that ran in the
  editor threw as soon as the game was published. The event handler both exporters
  install is now generated once rather than written out twice, which is what let
  the two drift apart in the first place.
  
  Ground contact reported before the script worker starts is no longer discarded,
  so a character standing on the floor at the moment play begins is grounded to a
  script immediately instead of only after its next landing.
  
  The kinematic controller gained a coyote window and a jump buffer, carries a
  player standing on a moving platform, bounds upward velocity as well as
  downward, and reports characters it had to skip for having no collider.
  
  A character the engine cannot drive is now something you are told about instead
  of something you discover by walking through a wall. Without physics an entity
  never receives a collider, so the engine never even considers it for a character
  controller — it simply keeps sliding, with no gravity and no collisions, and
  nothing anywhere said so. Pressing Play on such a scene now raises a message
  naming the characters and how to fix them, and building a game reports the same
  thing one step earlier, while it can still be repaired.
  
  Adding a Character Controller by hand now starts from the same calibrated jump
  the generation pipeline uses, and the inspector's jump slider is labelled and
  bounded for the project type — a height in metres in 3D, a rise rate in 2D —
  instead of offering the same unitless range to both.
  
  The physics-feel analysis now converts each character's jump using that
  character's own gravity, rather than the average gravity of everything in the
  scene with a body, so a heavy prop can no longer make the player look like it
  jumps harder than it does.

- [#9287](https://github.com/Tristan578/project-forge/pull/9287) [`65d66f5`](https://github.com/Tristan578/project-forge/commit/65d66f55a0cfd1750c1d835f3432456397c701f1) Thanks [@Tristan578](https://github.com/Tristan578)! - Stop undo from switching 2D physics, tilemap rendering, or 2D skeletal animation
  on for an entity the user disabled.
  
  Three `UndoableAction` variants — `Physics2dChange`, `TilemapChange`,
  `SkeletonChange` — each record a change to their data component and nothing
  else. Enablement lives in a separate marker (`Physics2dEnabled`,
  `TilemapEnabled`, `SkeletonEnabled2d`). All three had undo and redo arms that
  inserted that marker alongside the restored data, so undoing *any* property edit
  started simulating, rendering, or animating an entity that had been deliberately
  switched off. The 3D `PhysicsChange` arm has always got this right: it mutates
  the data in place and never touches `PhysicsEnabled`.
  
  "Data present, marker absent" is a state the engine deliberately round-trips —
  every other restore path reinstates these markers conditionally from a recorded
  bool (`insert_aux_components`, `spawn_from_snapshot`, and the play-mode snapshot
  restore in `engine_mode.rs`). An action that records no enablement must not
  invent one.
  
  Nothing surfaced it. The inspectors read the data, not the marker, so the panels
  looked correct while the body began falling; and because the marker is what the
  lifecycle systems key on, the recovery is not another undo — the user has to
  find and un-toggle a switch they never touched.
  
  All six arms now restore the data only. Each `None` branch still clears the
  marker with the data, because a marker with no data is a state no command can
  produce (the bridge inserts and removes each pair together), and that asymmetry
  is now written down where the arms are. Fifteen native regression tests pin the
  disabled case, the redo mirror, the enabled case in the opposite direction, and
  both `None` branches for each component. Every fixture is deliberately off its
  type's `Default` on the fields it asserts, so a regression inserting a blank
  struct fails instead of coincidentally passing — measured by mutation: reverting
  the data restore reddens the physics tests, and reinstating either unconditional
  marker insert reddens the four "stays disabled" tests.
  
  Merge order: `Physics2dEnabled` has no writer on `main` — the
  `toggle_physics_2d` command that owns it arrives with [#9276](https://github.com/Tristan578/project-forge/issues/9276). This should land
  *after* that PR, or 2D physics is un-enableable in between.

- [#9383](https://github.com/Tristan578/project-forge/pull/9383) [`957a185`](https://github.com/Tristan578/project-forge/commit/957a1854b2db74ebcc4837aa4749a09bb4e727ad) Thanks [@Tristan578](https://github.com/Tristan578)! - Asking for a premium or a fast model now gets you that model. On the OpenRouter
  and Vercel Gateway paths, every current Anthropic model id except Sonnet was
  missing from the translation table, so a request for Opus, Haiku or the deep
  tier silently resolved to the default chat model instead. Nothing failed and
  nothing warned — the reply simply came back from a different model than the one
  that was asked for, at whatever quality that model happens to give.
  
  Two ids that name no real model were removed from the same table at the same
  time. They had been mapping onto retired upstream models.
  
  A coverage test now derives the id list from the model registry and the backend
  list from the provider registry, so a model id added to the app, or a chat
  backend added to the registry, is checked on the day it lands rather than the
  day someone remembers this table exists.

- [#9288](https://github.com/Tristan578/project-forge/pull/9288) [`c73bb7c`](https://github.com/Tristan578/project-forge/commit/c73bb7c24857332f6316fa9ac88d9b1cda717032) Thanks [@Tristan578](https://github.com/Tristan578)! - Reverb zones now actually apply, and survive being duplicated. Authoring a zone dispatched `update_reverb_zone`, a command name the engine has never had a dispatch arm for, and flattened an `enabled` key onto `set_reverb_zone` that serde silently discards — so every reverb zone ever created was configured and never switched on. The store now sends `set_reverb_zone` plus `toggle_reverb_zone`, the inspector's Add button enables the zone it creates (which is what reveals the editing controls, previously unreachable), and inbound engine events route to state-only actions instead of dispatching straight back at the engine.
  
  Separately, duplicating an entity dropped its reverb zone. The engine has two independent restore paths — `spawn_from_snapshot` for undo/redo and `insert_aux_components` for duplication — and reverb was wired into only the first, so Ctrl+D silently discarded a configured zone while undoing a delete kept it. Both fields now restore on the duplicate path, and a source-parity test asserts the two paths agree on every field of `AuxComponentData` so the next one added cannot go missing the same way.

- [#9323](https://github.com/Tristan578/project-forge/pull/9323) [`9056fd3`](https://github.com/Tristan578/project-forge/commit/9056fd3e5655d049cb53082ee47831d2b7bfd78a) Thanks [@sentry](https://github.com/apps/sentry)! - Fix addEL_hook crash by reordering Sentry init before botId protection.

- [#9324](https://github.com/Tristan578/project-forge/pull/9324) [`d168a2f`](https://github.com/Tristan578/project-forge/commit/d168a2f8eb2932e08f1229432b39233f06dc7495) Thanks [@sentry](https://github.com/apps/sentry)! - Guard localStorage access in CookieConsent for WebView environments.

- [#9277](https://github.com/Tristan578/project-forge/pull/9277) [`78a63bf`](https://github.com/Tristan578/project-forge/commit/78a63bfce9dade017a6565ca2e1e056a4f6bee69) Thanks [@Tristan578](https://github.com/Tristan578)! - Four editor actions that appeared to work now actually reach the engine.
  
  Deleting a sprite, changing the 2D camera, editing a reverb zone, and setting a
  2D skeleton each dispatched a command name the engine has never had an arm for.
  The engine returned "unknown command" into a value nobody reads, so the panel
  updated, the undo entry recorded, and the running scene simply ignored it — no
  error, no warning, nothing in the console. All four have working arms under
  different spellings and now use them.
  
  The skeleton case was wrong twice: the engine also expects the skeleton nested
  one level down rather than spread across the payload, so a corrected name on the
  old shape would have replaced the rig with an empty one instead of doing nothing.
  That same mismatch had already broken Apply Rig in the auto-rigging panel, which
  searched for the old command name and therefore never found it — the button had
  been doing nothing at all, and its only test checked that the panel rendered.
  Apply Rig works, and the test now drives the button and checks what the store
  receives.
  
  2D tilemaps and 2D skeletal animation work again. The engine keeps a routing
  table in front of its command handlers, and sixteen sprite commands were missing
  from it — so tile painting, tilemap edits, skin changes, IK chains, auto-weighting
  and sprite animation state machines all had complete, correct handlers that could
  never be reached. Every one of them returned "unknown command" into a value
  nobody reads. Two were worse: they were pointed at the wrong section of the
  table, where an unfinished placeholder answered in place of the real handler.
  Both the tilemap panels and the AI tools that edit tilemaps were affected, as
  were user scripts calling the 2D skeletal API.
  
  Tileset assignment is the one piece still not connected: the engine wants a
  tileset attached to a specific object while the editor tracks tilesets per
  image, and picking a side changes behaviour rather than just wiring. It is
  tracked and now recorded in the code instead of failing quietly.
  
  A new test scans every command name the editor's state layer dispatches and
  fails if one has no working engine arm behind it, so the next one cannot ship
  silently. It covers the store, which is where all of these bugs were; the AI
  tool handlers dispatch a few names of their own and are not scanned yet. Names
  that are genuinely waiting on engine work are listed explicitly with a ticket,
  and the list fails if an entry becomes implemented or stops being used — it
  cannot quietly grow stale.
  
  A second test on the engine side reads the routing table against the handlers it
  points at and fails if any handler is unreachable or pointed at the wrong
  section. That is what found the sixteen, and it covers every command the engine
  has rather than only the ones the editor happens to send. It reads the list of
  handler sections off disk rather than from a list kept by hand, so a section
  added later cannot sit outside the check by not being mentioned in it.
  
  Auto-weighting a 2D skeleton now recomputes vertex weights instead of erasing
  them. The tool never called the engine command that does the work; it re-sent the
  whole rig from the editor's own copy, and that copy carries no weights at all —
  so the one action whose entire job is computing weights was the action that
  cleared them. Its two options are also gone: the engine has only ever had one
  weighting method and ignores the iteration count, so offering a choice between
  them described a control that did not exist. Sending one still works and still
  weights the rig, and the result now says the option had no effect.
  
  IK chains created by the AI now bend. Every one of them pointed at a target
  entity that does not exist, on both sides of the bridge, and the solver skips any
  constraint whose target it cannot find — so an IK chain could be created, listed
  in the inspector, and never move a bone. The engine also built its chain out of
  one bone name repeated, and read the chain length straight from the request as an
  allocation size, which made an oversized number enough to take the engine down
  for the session. Asking for a chain between two bones with no path between them
  used to invent one; it now says so. A cycle in the bone hierarchy used to hang
  the tab.
  
  The target-entity field was published as a number everywhere it was documented —
  in the command reference an assistant reads before composing a call — while the
  engine has only ever held a text id. A model following the documentation
  therefore produced a constraint the solver was always going to skip. It is a
  string on both sides now, and the reference is checked against the code rather
  than kept in step by hand.
  
  The same limits are applied wherever a constraint is built, not only on the AI
  path. Editing a rig in the inspector and importing one from a file both went
  through a builder that had none of them, so a chain long enough to crash the
  engine, a blend weight outside the range the solver understands, or a bend
  direction that is neither left nor right could all still reach it from the
  editor. Importing a rig is also no longer destructive. Storing a rig replaces
  whatever the object had, and anything the importer did not understand — a
  mistyped file, an export from another animation tool, a file that is not a rig at
  all — was quietly turned into an empty rig and reported as a successful import.
  So a bad file replaced a real rig with nothing and said it had worked. A file
  that cannot be read is now refused, the reason names the part of it that is
  wrong, and the rig already on the object is left alone. Formats the importer has
  never been able to read are no longer offered in the first place.

- [#9326](https://github.com/Tristan578/project-forge/pull/9326) [`4437400`](https://github.com/Tristan578/project-forge/commit/4437400f67a78efa4b86d613b067b1846a5db9be) Thanks [@Tristan578](https://github.com/Tristan578)! - Block trademarked IP names in game titles and slugs at publish time.

- [#9321](https://github.com/Tristan578/project-forge/pull/9321) [`9cf908d`](https://github.com/Tristan578/project-forge/commit/9cf908df280d01b39a9a08bf32b0b583e54025af) Thanks [@Tristan578](https://github.com/Tristan578)! - Generated games now get real chasing enemies, moving platforms, spawners and checkpoints instead of a placeholder script that never ran.

## 0.6.0

### Minor Changes

- [#9142](https://github.com/Tristan578/project-forge/pull/9142) [`44a0d8d`](https://github.com/Tristan578/project-forge/commit/44a0d8de114c8e58d1e34e6bd705273631726005) Thanks [@Tristan578](https://github.com/Tristan578)! - Make the game-creation pipeline reachable from the product. The orchestrator panel is now registered with the workspace so it can actually render, and a direct request like "make me a 3D platformer" routes from chat into the creation pipeline instead of the chat tool loop.

- [#9087](https://github.com/Tristan578/project-forge/pull/9087) [`98899bf`](https://github.com/Tristan578/project-forge/commit/98899bf53146f295afd8c6330a5724e33419a33d) Thanks [@Tristan578](https://github.com/Tristan578)! - Add Sentry profiling and business metrics for the generation surface.

  Profiling is wired across the Node server and browser runtimes (`profileLifecycle: 'trace'`, sampled at 10% in production), with the `Document-Policy: js-profiling` header enabling the browser profiler.

  `/api/generate/*` now emits three business metrics through the shared handler factory — request volume faceted by outcome, end-to-end latency, and tokens actually charged on success. All metric emission fails open so observability can never take down the generate routes.

### Patch Changes

- [#9218](https://github.com/Tristan578/project-forge/pull/9218) [`9164e59`](https://github.com/Tristan578/project-forge/commit/9164e59e78b80b737f1c9f73373205b10f62deea) Thanks [@Tristan578](https://github.com/Tristan578)! - Generated 2D games now ship a player that can move. The character rig step gave
  2D players a skeleton and nothing else — a skeleton is an animation rig, not a
  movement component — so the player stood still no matter what the input did.

  The same movement component the 3D path uses is now added for 2D, tuned by the
  same feel directive, and the engine steers it along the screen plane instead of
  into the depth axis the player cannot see.

  Generated games also bind their controls. The engine ships no input bindings by
  default, so every generated player previously had a movement component with
  nothing wired to drive it; the movement style in the design document now picks
  the binding set. And in 3D, moving left works — A and D used to strafe the same
  direction.

- [#9250](https://github.com/Tristan578/project-forge/pull/9250) [`d4c41f4`](https://github.com/Tristan578/project-forge/commit/d4c41f42f47d037bc2f3d89f62dc012bb1e1fa3e) Thanks [@Tristan578](https://github.com/Tristan578)! - Guard the RSC boundary around `lib/chat/handlers/`.

  Most chat handlers value-import a Zustand store. That is safe only because
  nothing in the server graph can reach them — a property nothing checked. A new
  test walks the real import graph outward from every shipped module under `app/`,
  stopping where a module declares `'use client'`, and fails if any of them reaches
  a handler at any depth. The day that stops being true it is a red test rather
  than an opaque `next build` failure on a module that never mentions a store.

  The comment stripper and type-only detector the existing `game-creation` scan
  uses now live in `test/utils/importScanner.ts` and are shared by both, rather
  than existing as two hand-rolled copies of the same subtle logic. The shared
  extractor reads whole statements rather than physical lines, so a Prettier-wrapped
  `await import(…)` — a form this repo already ships — is a module edge the scan
  sees instead of a silent miss.

- [#9255](https://github.com/Tristan578/project-forge/pull/9255) [`6a9130f`](https://github.com/Tristan578/project-forge/commit/6a9130f6f730427b6e011ef9ed5128bdcfe25c4f) Thanks [@Tristan578](https://github.com/Tristan578)! - Reject command payloads that are nested too deeply, or that carry more objects and arrays than the engine can convert, before they cross into WASM. A deeply nested payload previously overflowed the stack during the recursive JS-to-Rust conversion, which on wasm32 is an unrecoverable trap that kills the engine instance for the rest of the session. Bulk data is unaffected — a full-size tilemap is millions of values but only a handful of containers, and only containers count toward the bound.

- [#9268](https://github.com/Tristan578/project-forge/pull/9268) [`3d266a6`](https://github.com/Tristan578/project-forge/commit/3d266a6fc69d79a9be882d918cec2d31c12c9bef) Thanks [@Tristan578](https://github.com/Tristan578)! - Refuse a negative camera follow damping instead of sending it to the engine.

  The engine follows with `t = (damping * delta).min(1.0)` and then
  `translation.lerp(target, t)` — `t` is capped above but never below, so a
  negative rate is a negative lerp factor: the camera extrapolates away from its
  target every frame and the gap compounds (~16x per second at 60fps with -3),
  putting the camera somewhere unreachable within two seconds. It was accepted by
  the GDD camera translator, sent, and reported as applied.

  The rate is now rejected at both boundaries — `flat_damping` on the command path
  and a floored `follow_lerp_factor` at each consume site, because `.forge` scene
  files deserialize straight into the camera struct without passing through
  `from_flat`.

  Because `set_game_camera` is full-replace, that engine-side tightening needs a
  matching screen on the browser side or one bad rate would take `mode`,
  `targetEntity` and `offset` down with it. Both write paths into the wire
  `damping` key now share one predicate, and the actionable signal moved to the
  input surfaces: the inspector's Smoothing field carries a real floor (the `min`
  attribute alone is advisory — a typed value still fires `change`), and the chat
  tool rejects a negative rate with a validation error naming the field instead of
  dropping it silently. `0` stays a legitimate authored value everywhere — it
  means "never move", not "absent".

  Camera config keys that do not reach the engine are also now reported by reason:
  an unrecognized key, a value the engine cannot take, and a duplicate spelling
  each get their own sentence, where all three previously shared one that named
  only the first.

- [#9215](https://github.com/Tristan578/project-forge/pull/9215) [`60eeffc`](https://github.com/Tristan578/project-forge/commit/60eeffc43f36fa94dbd4f10a3d152405a64bc846) Thanks [@Tristan578](https://github.com/Tristan578)! - Generated games now use the camera the GDD asked for. The camera directive was
  being normalized and then dropped before it reached the engine, so every
  generated game — including 2D side-scrollers — ran on the default third-person
  follow camera.

  The camera it creates also has something to follow, the repair path it runs on a
  broken scene actually renders, and camera values nobody restates — a sideways
  shoulder offset, a tuned follow smoothing — survive the next camera command
  instead of snapping back to the engine default. A pipeline step that only
  partially applied now says so in the UI rather than reporting plain success.

- [#9169](https://github.com/Tristan578/project-forge/pull/9169) [`5838cb7`](https://github.com/Tristan578/project-forge/commit/5838cb765f6503b43334b78a4369a36f5db367c6) Thanks [@Tristan578](https://github.com/Tristan578)! - Game creation: cancelling a run now stops the current step's remaining retries instead of waiting for them to finish, and reports the plan as cancelled rather than failed.

- [#9176](https://github.com/Tristan578/project-forge/pull/9176) [`64cd700`](https://github.com/Tristan578/project-forge/commit/64cd700f3dd7c567586991e9d7316029787ea8d9) Thanks [@Tristan578](https://github.com/Tristan578)! - Bind generated character setup to the engine's entity id instead of the designed
  name. `character_setup` steps come from the system registry rather than the
  entity loop, so they carried no entity at all — the executor then fell back to
  the GDD name, which the engine's `EntityId` match never resolves. A generated 3D
  player silently received no `CharacterController` and could not move. System
  definitions now receive the planned entities, and an unresolvable target fails
  loudly instead of dispatching a no-op.

- [#9176](https://github.com/Tristan578/project-forge/pull/9176) [`64cd700`](https://github.com/Tristan578/project-forge/commit/64cd700f3dd7c567586991e9d7316029787ea8d9) Thanks [@Tristan578](https://github.com/Tristan578)! - Game creation no longer abandons an entire build when a design asks for movement without naming a player character. The character rig step is planned only when there is a character to rig, and the final review says so when it was skipped.

- [#9261](https://github.com/Tristan578/project-forge/pull/9261) [`2913f64`](https://github.com/Tristan578/project-forge/commit/2913f6465555132ab3a068a8b3a23048c615e222) Thanks [@Tristan578](https://github.com/Tristan578)! - Run the compound chat tools' input validation instead of shadowing it. `compoundHandlers.ts` declared its own private copies of every `helpers.ts` export, so the validated builders never executed in production and a model-supplied material, light, physics body or game component reached the engine through a bare cast. The copies are deleted; the builders now clamp every game-component field to the engine's own range (mirrored from `build_game_component` and pinned against the Rust by test), clamp the material, light and physics fields to what each can mean, round the integer-typed fields, and fall back per field rather than throwing. A win condition described as `collect_all` no longer silently becomes a score game, and a vector component past the f32 range no longer reaches the engine as infinity.

- [#9224](https://github.com/Tristan578/project-forge/pull/9224) [`57da338`](https://github.com/Tristan578/project-forge/commit/57da338123981b7a67a75342ed38eadbb12576b7) Thanks [@Tristan578](https://github.com/Tristan578)! - Cutscene camera moves now actually move. A camera keyframe with a duration and
  an easing curve snapped to its destination on its first frame — the eased
  progress was written onto the command as a field no engine command reads — so
  every authored camera move was a cut.

  Every other kind of keyframe was being re-sent on every animation frame for the
  length of its duration, which restarted the sound, the animation clip and the
  dialogue about sixty times a second. Those now fire once. An audio keyframe also
  stops sending volume and fade settings that the engine discards, and a dialogue
  keyframe that names no dialogue tree is no longer sent at all.

  Seeking a cutscene past a camera keyframe now applies it. Jumping over a camera
  move left the camera wherever it happened to be, so seeking into a move showed
  it and seeking one frame past the same move showed nothing. Sounds, animations
  and dialogue are still not replayed by a seek.

  Reconfiguring a game camera mid-play no longer cancels a camera shake that is
  still running — including one triggered in the same frame — or snaps a
  first-person or orbital camera back to its starting angle.

- [#9231](https://github.com/Tristan578/project-forge/pull/9231) [`b9c4a31`](https://github.com/Tristan578/project-forge/commit/b9c4a31f51941dc6198ed696597ca493c4e262a6) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix cutscene dialogue beats doing nothing. A dialogue keyframe builds a
  `start_dialogue` command, but that command lives entirely in the browser — the
  engine has never known it. The player was handed the engine dispatcher, which
  rejected the command — a console error for a developer, nothing at all for the
  viewer: every authored dialogue beat in every cutscene played through with no
  dialogue and no user-visible error. Cutscene playback now routes browser-side
  commands to their real handler, and a cutscene pointing at a deleted dialogue
  tree says so instead of playing a silent gap.

- [#9221](https://github.com/Tristan578/project-forge/pull/9221) [`f54300b`](https://github.com/Tristan578/project-forge/commit/f54300b06a93195da3429751e870e86e0663ea39) Thanks [@Tristan578](https://github.com/Tristan578)! - Match GDD system keywords at word boundaries instead of anywhere in the prompt.

  The local system decomposer tested each keyword with `text.includes()`, so a
  keyword matched inside unrelated words: `car` in "scary", `star` in "start",
  `click` in "clicker", `run` in "runner". A horror prompt was given vehicle
  movement, "where you start the level" was read as collecting pickups, and the two
  entries that describe idle-clicker and endless-runner games lost to entries whose
  vocabulary the prompt never used.

  Keywords now match as whole words, with an optional plural so the table can keep
  listing `coin` while prompts say "coins". Evidence is counted as distinct regions
  of the prompt rather than as keywords, so the table's own nesting (`platform`
  inside `platformer`, `runner` inside `endless runner`) no longer lets one word
  score twice and beat a rival entry — which is what classified "a top-down game
  with jumping" as a platformer. Two separate mentions still count twice.

  `priority` now records whether the prompt named the category at all, rather than
  whether it tripped two keywords; that count was largely measuring the nesting
  above. The systems panel also names each detected system by what was detected
  rather than by its category, so a prompt asking for pixel art no longer reads
  back "visual".

- [#9201](https://github.com/Tristan578/project-forge/pull/9201) [`b1a838c`](https://github.com/Tristan578/project-forge/commit/b1a838cd4fc9247f954dbd972bae49f247611a8e) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump the npm minor-and-patch group (29 packages, including next 16.2.12 → 16.3.0).

  next 16.3.0 adds `@next/next/no-location-assign-relative-destination`, which the
  repo's `--max-warnings 0` policy turns into a build failure. The token-depleted
  modal now soft-navigates with `useRouter().push` instead of assigning
  `window.location.href` — a location assignment is a full document navigation, so
  it was tearing down the WASM engine and every unsaved store slice on the way to
  a billing page the user is expected to come straight back from.

  The editor error boundary keeps its hard navigation, with the rule disabled on
  that line and the reason recorded: it runs with `hasError` latched, so a soft
  push would carry the same wedged engine and stores onto the next screen instead
  of clearing them.

- [#9100](https://github.com/Tristan578/project-forge/pull/9100) [`fcf39f3`](https://github.com/Tristan578/project-forge/commit/fcf39f3c4678e2b709978b7af2254ab571e5e991) Thanks [@Tristan578](https://github.com/Tristan578)! - chore(deps): relock `nanoid`, `js-yaml` and `dompurify` to clear three published advisories ([#9099](https://github.com/Tristan578/project-forge/issues/9099))

  The `npm audit` gate was red on all three audited workspaces (`.`, `web`, `mcp-server`):

  - **GHSA-2v37-7h3g-55p8** (high) — `nanoid`: a custom generator can loop indefinitely when `size` is zero. `3.3.16` → `3.3.18`.
  - **GHSA-5p4m-2wfm-xmqj** (high) — `js-yaml`: quadratic CPU consumption resolving `!!omap`. `4.3.0` → `4.3.1` at the root, and the two nested `3.15.0` copies (under `gray-matter/` and `read-yaml-file/`) → `3.15.1`. A root-only bump would have left both nested copies vulnerable.
  - **GHSA-55q2-fjhq-7xh7** (moderate) — `dompurify`: an `IN_PLACE` hook removal leaves a detached subtree executable (XSS). The existing root override was pinned `>=3.4.12`, one patch short of the fix, so it actively held the vulnerable version in place; tightened to `>=3.4.13` and relocked to `3.4.13`.

  Every fix was already published, so no `ALLOWED_ADVISORIES` waiver was added — the allowlist stays empty, which is its correct steady state.

  Relocked on the pinned Node 24 toolchain with a scoped `npm update … --package-lock-only`. The committed lockfile carries exactly five changed nodes (`version`/`resolved`/`integrity` only) with zero nodes added or removed; the `libc` metadata that `npm update` strips from 34 Linux-only optional native nodes was restored so the file round-trips through `npm install --package-lock-only` unchanged.

- [#9259](https://github.com/Tristan578/project-forge/pull/9259) [`6b838a8`](https://github.com/Tristan578/project-forge/commit/6b838a89211c53682927089865008bc8b88d0708) Thanks [@Tristan578](https://github.com/Tristan578)! - Stop a malformed dialogue tree from crashing the play session. A conversation whose condition and action nodes formed a cycle recursed until the browser ran out of stack, ending the whole session rather than the one conversation. The runtime now walks such a tree without recursing and ends the conversation if it never reaches anything the player can read. Loops that resolve on their own — "ask again until the counter reaches three" — still play through as authored.

  Two neighbouring crashes from the same source are closed with it: a condition nested thousands of levels deep no longer overflows the stack when it is evaluated (it is treated as unmet instead, so a gated choice stays hidden rather than opening), and a line that points at a node which is not in the tree now ends the conversation with an explanation instead of leaving the player in an empty dialogue box with no way out but Esc.

- [#9240](https://github.com/Tristan578/project-forge/pull/9240) [`c75718b`](https://github.com/Tristan578/project-forge/commit/c75718ba09d8b46ed802fab1c85683f431ecadd3) Thanks [@Tristan578](https://github.com/Tristan578)! - Dialogue: a generated or imported tree can no longer break the dialogue runtime. Tree ids that name an inherited property (`__proto__`, `constructor`) are no longer mistaken for real trees — on every read path, not just the store's own — and a tree whose JSON carries no `nodes` array, no `startNodeId`, or a `nodes` entry that is not an object is now rejected rather than throwing on the first walk. A dialogue action can no longer re-point the prototype of a tree's variable bag, and a variable that was never set now reads back as unset whatever it is named — a condition on `toString` or `constructor` used to see the inherited member and turn on a name the tree never wrote.

  The same check now covers what each node carries, not just the tree around it: a node that is not an object, a condition or action that is not one, an `actions` field that is not a list, and a choice node whose `choices` is not a list all end the dialogue or read as empty instead of throwing mid-walk. A tree that simply omits its (empty) variable bag is repaired on import and on load rather than being accepted and then silently refusing to run — including a tree saved that way by an earlier build.

  Failures that used to be silent now say so where the author is looking. A dialogue cut short by a routing loop or an unrecognised node type raises a toast naming the node, not just a console line; a running conversation whose tree has gone unreadable says it cannot continue instead of painting an empty box that reads as a hang; and the dialogue editor now distinguishes a tree that will not open from no tree being selected, rather than telling an author who has just picked one to pick one.

  Corrupt stored data no longer costs more than the tree it corrupts. A tree that cannot be walked is now refused at import and dropped on load, each by name in the console, so it can never reach the runtime that would throw on it; a stored blob that is not an object at all starts an empty set of trees rather than being assigned through. Reads of the whole set — the dialogue tree editor's picker, the entity inspector's tree dropdown, the voice-profile speaker sweep, and the scene context sent to the AI — now skip an unwalkable tree instead of throwing on it, so one bad tree costs that tree and not the panel the author needs in order to fix it. The last remaining way to put an unreadable tree into the map is closed too: an update that would leave a tree unwalkable is refused rather than half-applied, and dropping the tree a dialogue is currently running now ends that dialogue instead of leaving the runtime aimed at something no longer there.

- [#9171](https://github.com/Tristan578/project-forge/pull/9171) [`645cfb4`](https://github.com/Tristan578/project-forge/commit/645cfb4c28626a1d596fe4d6619d61624ae807f6) Thanks [@Tristan578](https://github.com/Tristan578)! - Game creation: a design that asks for two mechanics in the same category (walk + swim, enemy waves + hazards) now builds steps for both instead of silently dropping all but the first.

- [#9156](https://github.com/Tristan578/project-forge/pull/9156) [`462597b`](https://github.com/Tristan578/project-forge/commit/462597b6daebf064baa36fd11e4564ef1fd8315c) Thanks [@Tristan578](https://github.com/Tristan578)! - Surface engine command rejections. `dispatchCommand` now returns the engine's `CommandResponse` instead of discarding it, and the store's tracked wrapper logs and reports any rejection — making a whole class of silent no-ops diagnosable across every editor panel, chat handler, and pipeline executor.

- [#9185](https://github.com/Tristan578/project-forge/pull/9185) [`27c9752`](https://github.com/Tristan578/project-forge/commit/27c9752c42d88022e49c33cda9398fd6c9c81f4d) Thanks [@Tristan578](https://github.com/Tristan578)! - Generated 3D games now spawn the shape the design asked for. `entity_setup` reads the GDD's `appearance` field when it names a primitive (`primitive:sphere`), instead of always spawning the role-default mesh — previously every enemy, NPC, decoration, trigger and interactable was a cube regardless of what the design specified. Free-text appearance still falls back to the role default rather than failing the step, and 2D entities remain textured planes.

  The `behaviors` field is removed from the game design document. Nothing in the pipeline ever read it, so the model was spending tokens writing prose that was parsed, sanitized, stored and then discarded.

- [#9251](https://github.com/Tristan578/project-forge/pull/9251) [`901c6f2`](https://github.com/Tristan578/project-forge/commit/901c6f299580a6df0610bfc708f970abbc3e692c) Thanks [@Tristan578](https://github.com/Tristan578)! - Play audio per entity instead of per scene. The editor kept a single audio component for the whole scene — whichever entity reported last — so a scene with two sound sources showed and edited the wrong one, the AI answered questions about the wrong entity, and nothing ever reached the Web Audio graph. Audio is now stored per entity, imported sounds are decoded and attached to the entity that owns them, and a pitch set before a sound plays (or set and then replayed) is no longer discarded. Sound generation that comes back without a clip now says so instead of attaching a sound that will never play, and deleting an audio asset no longer leaves entities pointing at it silent. Opening a scene restores every entity's audio at once rather than revealing it one selection at a time, and the AI generate buttons now state which tier they need somewhere a screen reader can reach.

- [#9176](https://github.com/Tristan578/project-forge/pull/9176) [`64cd700`](https://github.com/Tristan578/project-forge/commit/64cd700f3dd7c567586991e9d7316029787ea8d9) Thanks [@Tristan578](https://github.com/Tristan578)! - Bind orchestrator-generated scripts to the engine's entity id instead of the designed entity name. The plan now mints an id per entity, forwards it to the engine via `spawn_entity`'s id override, and `custom_script_generate` binds `set_script` to that id — previously every generated script bound to a name the engine never matches, and the miss was silent.

- [#9195](https://github.com/Tristan578/project-forge/pull/9195) [`bbbef60`](https://github.com/Tristan578/project-forge/commit/bbbef60133b97855fa3d95dd7e6771a2782f1ff7) Thanks [@Tristan578](https://github.com/Tristan578)! - Game-creation executors now read the editor store live through a `getStore()` accessor on `ExecutorContext` instead of a snapshot captured before the pipeline starts. `verify_all_scenes` no longer reports `empty_scene` on a populated scene, and `auto_polish` no longer dispatches `set_game_camera` against a despawned entity id. A guard test fails the build if any `lib/game-creation` module value-imports a client-only module, which is what previously broke the production build of `/api/game/decompose`.

- [#9211](https://github.com/Tristan578/project-forge/pull/9211) [`c0ca08c`](https://github.com/Tristan578/project-forge/commit/c0ca08c3a237bd7c3e5e6a7c7b05313a3ab830b6) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix `set_game_camera`, which never reached the engine from any call site. The
  engine deserialized the camera mode as an externally-tagged enum while every
  caller sent a camelCase string with flat parameters, so the command was dropped
  before it was queued — silently, because engine dispatch returns no result. The
  Game Camera Inspector, the AI `set_game_camera` tool, smart-camera presets and
  cutscene camera tracks were all affected.

  Also removes three camera parameters (`followLookAhead`, `sideScrollerHeight`,
  `topDownAngle`) that no engine camera mode has ever had a field for, and
  rewrites the published MCP `set_game_camera` schema, which advertised those
  same authoring names rather than the parameters the engine reads.

  Hardens the wire itself: a camera parameter can no longer crash the engine.
  Values that saturate to infinity and inverted `[min, max]` ranges are rejected,
  and the two sites that clamp between a pair order their bounds first — an
  inverted pair reached `f32::clamp`, whose panic takes down the whole WASM
  instance and loses the unsaved scene.

  Camera parameters the editor's authoring vocabulary has no field for — twelve of
  the engine's twenty-one, including field of view and the look-at target — now
  survive a round trip through the store. `set_game_camera` replaces the whole
  component, so a parameter the next payload omits comes back as the engine's
  default: dropping these on read was not leaving them alone, it was resetting
  them. An entity named `__proto__` can also no longer reparent the camera record,
  which previously made every camera-less entity report the polluting camera as
  its own.

  Fixes the 3D auto-polish camera, which sent a follow smoothing of 0.8 as though
  it were a 0..1 blend factor. The engine reads it as a rate per second, so every
  auto-polished 3D game shipped a follow camera roughly six times slower than the
  default.

- [#9163](https://github.com/Tristan578/project-forge/pull/9163) [`e7d32b3`](https://github.com/Tristan578/project-forge/commit/e7d32b3c8757abb0fba04fc9e2b081c805306244) Thanks [@Tristan578](https://github.com/Tristan578)! - Match the engine's whole-number coercion for game component fields. `collectible.value`, `spawner.maxCount` and `winCondition.targetScore` are `u32` in the engine, which rounds and clamps them — the editor previously kept the raw value, so a collectible authored as worth 10.4 points showed 10.4 in the inspector while the running game scored something else.

- [#9158](https://github.com/Tristan578/project-forge/pull/9158) [`ed296f7`](https://github.com/Tristan578/project-forge/commit/ed296f7af53c3300be0b1362098dcbab042500b9) Thanks [@Tristan578](https://github.com/Tristan578)! - Stop game-component integer fields from silently reverting to their defaults when JSON spells them as floats.

  `build_game_component` read `collectible.value`, `spawner.maxCount` and `win_condition.targetScore` with `as_u64()`, which answers `None` for a float-formatted integer like `10.0`. JSON has one number type and the producers on this wire spell integers differently — JS `JSON.stringify(10)` emits `10`, but anything routed through a float (an inspector slider, an LLM writing `10.0`, a `.forge` scene round-tripped through `f64`) emits `10.0`. The field then fell back to its default, so a collectible authored as worth 50 points was worth 1 — the exact unusable-value outcome the permissive builder exists to prevent, and inconsistent with the sibling float and vector readers, which both take either spelling.

  These fields now parse via `as_f64()`, round to the nearest whole (a fractional count means nothing to a system that iterates it), and clamp into range instead of dropping — the same clamp-don't-drop rule the float reader already followed. Non-numbers still leave the default standing.

- [#9146](https://github.com/Tristan578/project-forge/pull/9146) [`a1e63f7`](https://github.com/Tristan578/project-forge/commit/a1e63f7088b772aaaf0f04cc936c6211afb4513b) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix the JS↔engine game-component wire contract so AI-authored gameplay actually reaches the engine.

  The store models a game component as a tagged union (`{ type: 'characterController', characterController: {...} }`) but `handle_add_game_component` requires a flat `{ entityId, componentType: 'character_controller', properties }`, and the engine deserializes each properties bag with strict serde. Ten dispatch sites were sending a shape the engine rejected, and because `dispatchCommand` returns `void` every rejection was silent — the AI reported success on gameplay that was never added.

  - New `lib/engine/gameComponentWire.ts` owns the store↔engine name mapping, the per-type property projection, and a `buildStoreComponent` that fills a complete, deserializable default bag for all 13 component types.
  - `gameSlice` add/update/remove now dispatch the flat snake_case shape, which also revives the Remove button in the game-component inspector.
  - `characterSetupExecutor` sends all four `character_controller` fields (a missing `canDoubleJump` dropped the whole component) and uses `create_skeleton2d` for 2D.
  - The four `autoIteration` fix generators no longer emit the non-existent `game_component` type.
  - `gameplayHandlers` derives its valid-type list from the catalog, adding the previously missing `dialogue_trigger`.
  - `autoRigging` emits `create_skeleton2d` with a correctly nested `SkeletonData2d` and a string `targetEntityId`, so applying a rig works.

- [#9183](https://github.com/Tristan578/project-forge/pull/9183) [`6b21495`](https://github.com/Tristan578/project-forge/commit/6b21495a0e5c4ec4a938b9c782504d55017d79d7) Thanks [@Tristan578](https://github.com/Tristan578)! - Reject a generated game design that declares a movement system but casts no player entity. The two fields were each valid in isolation, so the nonsense design survived decomposition and only surfaced downstream as a dropped character-setup step — the user asked for movement and got a game where nothing moves. The decomposer now fails that GDD and re-prompts the model instead.

- [#9116](https://github.com/Tristan578/project-forge/pull/9116) [`56e9100`](https://github.com/Tristan578/project-forge/commit/56e9100479657b75bd9ea87a11803da8cc1e03a1) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix two permanent false outages on the public status page. The health check
  probed environment variables that nothing in the tree reads and no environment
  sets: `CLOUDFLARE_ACCOUNT_ID` / `R2_*` for asset storage (the real R2 consumer
  reads the `ASSET_*` namespace) and `MESHY_API_KEY` / `ELEVENLABS_API_KEY` /
  `SUNO_API_KEY` for AI providers (the real names are `PLATFORM_*`). The chat
  reachability probe also hard-coded `api.anthropic.com` while production routes
  chat through the Vercel AI Gateway.

  Every namespace a health check reads now comes from a shared constants module,
  so the check and its consumer can no longer drift apart.

- [#9181](https://github.com/Tristan578/project-forge/pull/9181) [`60e4103`](https://github.com/Tristan578/project-forge/commit/60e41037fcdca5dcbf57551d31b5dc21e8b5325f) Thanks [@Tristan578](https://github.com/Tristan578)! - Expose the health component's `despawnOnDeath` knob across the editor, AI chat, and MCP surfaces. The engine has always honored the field (defaulting to `true`), but nothing above the bridge could author it, so a boss or destructible prop that should leave a wreck at zero health had no way to say so.

- [#9113](https://github.com/Tristan578/project-forge/pull/9113) [`e261b4a`](https://github.com/Tristan578/project-forge/commit/e261b4a8422b6cf521ee99819aa343826e297a8a) Thanks [@Tristan578](https://github.com/Tristan578)! - Execute the distributed rate limiter's sliding-window Lua script in a real Lua VM under test, instead of only asserting the request we send to Upstash. The script's boundary arithmetic and `tonumber` coercions are now covered by tests that fail when the script changes.

- [#9232](https://github.com/Tristan578/project-forge/pull/9232) [`89ce885`](https://github.com/Tristan578/project-forge/commit/89ce885f16c6ce04deaedc46501595a5e9aa942f) Thanks [@Tristan578](https://github.com/Tristan578)! - Bound `movingPlatform.waypoints` on both sides of the engine bridge. The list had
  a lower bound (two points) and no upper one, and the values are LLM-authored — a
  generated GDD asking for a long patrol route grew an unbounded `Vec` that
  `system_moving_platform` walks every frame and that gets serialized into every
  scene save. Both sides now cap at a single `MAX_WAYPOINTS` constant, parsed out
  of the Rust by the TypeScript test so the two cannot drift apart silently. Points
  the engine would discard are also discarded in the store, including doubles that
  survive `Number.isFinite` in JavaScript but overflow to infinity as an `f32`.

  Also fixed three validators that were passing arrays they exist to reject.
  `Array.prototype.every` skips array holes, so `[1, , 3]` cleared every one of
  them without the missing slot being checked. On the engine wire that shipped the
  gap as a `null` the engine drops and the store keeps. In dialogue an `and` group
  with a missing condition reported itself satisfied; separately, a `null`
  condition, node or choice in an imported or persisted tree crashed playback, so
  both `JSON.parse` boundaries now drop members the declared types say cannot
  exist. In the effect system an incomplete binding was accepted by a type guard
  whose narrowing promises the opposite, leaving `applyBinding` — which iterates
  with `for...of`, and so does not skip the gap — to throw on it at gameplay time.

- [#9243](https://github.com/Tristan578/project-forge/pull/9243) [`cb599e8`](https://github.com/Tristan578/project-forge/commit/cb599e8f35cff7a5fd7701c2086dec54faceffb5) Thanks [@Tristan578](https://github.com/Tristan578)! - Render the OG image badge as inline SVG instead of an emoji glyph. Satori resolves any codepoint its emoji classifier matches through a third-party CDN rather than the bundled font, which put that CDN on the critical path of `next build` for the three prerendered OG routes — a connect timeout failed the export outright. The play card additionally strips emoji from the game title, description and creator name it renders, so a user-supplied emoji no longer breaks that share card at request time. The classifier keys on `Emoji`, not `Extended_Pictographic`, so flags, keycaps and skin-tone modifiers are stripped too, and truncation now counts codepoints so the cut cannot split a surrogate pair.

- [#9151](https://github.com/Tristan578/project-forge/pull/9151) [`0618de5`](https://github.com/Tristan578/project-forge/commit/0618de5bdbdfb29bb26cd6bad700884ce15e44a4) Thanks [@Tristan578](https://github.com/Tristan578)! - Game components now accept partial property bags. `build_game_component` merges each recognised field onto the type's default instead of deserializing the whole bag strictly, so a command that names only `speed` no longer fails with "missing field `jumpHeight`". Unusable values (wrong type, non-finite, out of range) fall back to their default rather than rejecting the component, and numeric fields are clamped to the range the engine can simulate. Only an unknown component type or a body that is not a JSON object is still an error.

- [#9192](https://github.com/Tristan578/project-forge/pull/9192) [`b892594`](https://github.com/Tristan578/project-forge/commit/b89259484e32ca22e7c119de047b06e30eeb03f5) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix `update_physics` silently discarding or corrupting partial physics edits.

  Asking the AI to change one physics property (for example "make the ground
  bouncier") previously rebuilt all 13 fields of the entity's physics body,
  sourcing the unspecified ones from whichever entity happened to be selected —
  so a single tweak could flip a static platform to dynamic and drop the player
  through the level. The engine now accepts a partial patch and leaves untouched
  fields at their live values, and the physics feel presets dispatch the payload
  shape the engine actually reads instead of one it discarded.

- [#9121](https://github.com/Tristan578/project-forge/pull/9121) [`1995c56`](https://github.com/Tristan578/project-forge/commit/1995c56b4253d275ff7aab859fb2e71935ce8921) Thanks [@Tristan578](https://github.com/Tristan578)! - Pixel-art generation no longer reports a job `completed` when the provider delivered no image. Completion is now derived from the artifact actually returned rather than from the absence of a prediction id, both provider clients reject an empty response, and an empty artifact surfaces as a 503 naming what is missing — with tokens refunded — instead of a 201 the client cannot poll.

- [#9144](https://github.com/Tristan578/project-forge/pull/9144) [`dfb1f47`](https://github.com/Tristan578/project-forge/commit/dfb1f477778690a5f618f07e580559e494e2b8d2) Thanks [@Tristan578](https://github.com/Tristan578)! - Game creation now reports a cyclic system-dependency graph as a named failure instead of silently dropping a step from the build plan.

- [#9126](https://github.com/Tristan578/project-forge/pull/9126) [`125797c`](https://github.com/Tristan578/project-forge/commit/125797c4100db40dee48e69ab3e422d3d64942fa) Thanks [@Tristan578](https://github.com/Tristan578)! - Published games no longer hang on an indefinite spinner. The `/play` metadata fetch and the WASM engine load are each bounded by a deadline, a failure of either now surfaces a message naming what timed out instead of leaving "Loading game..." or "Starting engine..." on screen forever, and both failures are reported to error tracking. A failure that happens before the engine takes the canvas offers a retry.

- [#9122](https://github.com/Tristan578/project-forge/pull/9122) [`83ba78e`](https://github.com/Tristan578/project-forge/commit/83ba78e9ed41d1628f4e443748f43ad5846aa3c7) Thanks [@Tristan578](https://github.com/Tristan578)! - Correct the public pricing copy. Every plan name, price, limit, and feature bullet on the pricing page, OG image, FAQ, and landing page is now derived from the billing constants the server enforces, replacing hand-written copy that quoted a $99 top tier (charged at $79), promised the free tier AI chat it cannot use, and advertised published-game and project allowances that did not match the limits in force.

- [#9106](https://github.com/Tristan578/project-forge/pull/9106) [`46d60c0`](https://github.com/Tristan578/project-forge/commit/46d60c08126a0d6def3c8850a59d8305b148bf5c) Thanks [@Tristan578](https://github.com/Tristan578)! - Make `/docs`, `/health`, `/robots.txt`, `/sitemap.xml` and the root/pricing OpenGraph images reachable without a session. Each rendered for anonymous visitors by design but was missing from the proxy's public-route matcher, so every one of them redirected to sign-in. `/health` now serves a shared TTL-cached health report with in-flight request dedup, so the public dashboard cannot amplify one inbound request into ten outbound service probes; `/api/status` uses the same cache.

- [#9110](https://github.com/Tristan578/project-forge/pull/9110) [`6049cd4`](https://github.com/Tristan578/project-forge/commit/6049cd4204897e3eb4c4bf855e3050de94deaaff) Thanks [@Tristan578](https://github.com/Tristan578)! - Bound the outbound fan-out driven by the public `/health` page, fix healthy services rendering as "Unknown", and tighten the Clerk public-route patterns.

  Rendering `/health` costs four outbound probes (Neon, engine CDN, Clerk, Anthropic). All three surfaces that can trigger it — the page, `GET /api/health` and `GET /api/status` — now read through a shared, in-flight-deduped report cache and charge a single shared fan-out budget, and only on a cache miss: a cached report is free to serve, so it no longer spends an allowance it never consumed. Over budget the two API routes return an honest 429 with `Retry-After`, while the page degrades to a neutral shell that polls `/api/health`.

  Separately, the dashboard now translates the public `'up'` status back to the internal `'healthy'` at the client boundary. Without it, every healthy service card flipped from green "Healthy" to gray "Unknown" on the first 30s poll. Public-route patterns are now declared as an exact path plus a `/(.*)` subtree, since Clerk's vendored matcher treats a bare `(.*)` as a suffix wildcard with no path-segment boundary.

- [#9160](https://github.com/Tristan578/project-forge/pull/9160) [`9d09c06`](https://github.com/Tristan578/project-forge/commit/9d09c066c92dfcc54d03ff346cc69fd24c0838d9) Thanks [@Tristan578](https://github.com/Tristan578)! - Persist a scene's contents when switching away from it. `saveCurrentSceneData` had no production caller, so every scene's stored data stayed empty — switching scenes discarded the outgoing scene's work and loaded a blank viewport back. Switching and duplicating now read the live scene out of the engine first, and refuse to proceed if a live scene exists but cannot be read.

- [#9180](https://github.com/Tristan578/project-forge/pull/9180) [`305f385`](https://github.com/Tristan578/project-forge/commit/305f385cee624ce8e972285111f3df9db788f140) Thanks [@Tristan578](https://github.com/Tristan578)! - Correlate scene-export requests so a listener only consumes the export it asked for. `export_scene` now carries an optional request id that the engine echoes back on `SCENE_EXPORTED`, preventing an autosave tick or cloud save from being mistaken for a pending game export or file download.

- [#9188](https://github.com/Tristan578/project-forge/pull/9188) [`43502e2`](https://github.com/Tristan578/project-forge/commit/43502e2324d1986886e72bf769eb8b661e5e8c6c) Thanks [@Tristan578](https://github.com/Tristan578)! - The scene graph now reports which components each entity carries. `detect_components` was a stub returning an empty list, so every node the engine emitted claimed to have no components at all — and ten editor surfaces classify entities by exactly that list. Light counts read zero, the chat entity picker could not tell a mesh from a light, and the LOD, pacing, camera, physics-feel and design-teacher panels all silently took their fallback branch.

  Scene Statistics additionally counted component names the engine never emits, so its physics, audio, particle and game-component rows would have stayed empty even once the engine reported correctly. Those counters now key on the emitted names and count entities rather than component names, so an entity carrying both a data component and its enabled-marker counts once. The "Animation Clips" row is removed — the editor has no scene-wide source for it, and a row that can only ever read zero is worse than no row.

  The engine half ships with the next WASM build.

- [#9111](https://github.com/Tristan578/project-forge/pull/9111) [`29960b8`](https://github.com/Tristan578/project-forge/commit/29960b82fff8dd279b28c7975e5475642181d0a2) Thanks [@Tristan578](https://github.com/Tristan578)! - Make the crawl policy actually block what it says it blocks, and make the docs
  site's crawler surfaces reachable.

  A robots.txt `Disallow` value is a plain prefix match, not a path-segment match,
  so `Disallow: /admin/` never matches the canonical URL `/admin` — only things
  beneath it. Every private entry in the web app's `robots.ts` carried a trailing
  slash, which left `/dev` (the auth-bypass route), `/settings`, `/health` and
  `/api-docs` crawlable at exactly the URL each entry was written to block.
  Dropping the slash matches both the bare path and its subtree. `/api/` keeps its
  slash deliberately: there is no bare `/api` page to miss.

  The docs deployment now publishes a robots.txt of its own, declaring the two
  surfaces reachable without a session (`/` and `/mcp`) and the auth-gated ones
  that are not. Both it and the existing sitemap read a single shared `DOCS_URL`,
  so a robots.txt advertising a sitemap at one origin while the sitemap declares
  its URLs at another is no longer possible.

  That robots.txt was unreachable as written: the docs proxy gates every path its
  matcher covers, and neither `/robots.txt` nor `/sitemap.xml` was listed as
  public, so a crawler fetching either received a redirect to sign-in — the same
  defect class already fixed on the web app. Both are public now, and the four
  bare `X(.*)` public-route patterns are tightened to an exact path plus an
  explicit `/(.*)` subtree, so a future sibling that merely shares a name prefix
  (`/sign-internal`, `/mcpadmin`) cannot become public by spelling.

- [#9177](https://github.com/Tristan578/project-forge/pull/9177) [`928999d`](https://github.com/Tristan578/project-forge/commit/928999d12eb8a34b8bbe731e606bbf827c2b1f4b) Thanks [@Tristan578](https://github.com/Tristan578)! - Document `spawn_entity`'s `id` override in the MCP command manifest. The engine has
  accepted a caller-supplied entity id for a while — it is what lets a caller address a
  new entity immediately instead of waiting for the async selection event, and the
  orchestrator's script and character binding now depend on it — but the manifest
  described `spawn_entity` without it, so neither an MCP client nor the chat tool schema
  could discover it. The chat tool schema deliberately withholds it: the store mints the
  id itself and returns it synchronously, so a model-supplied id buys nothing, while a
  collision with an existing id would make the engine's id-matching loops address the
  wrong entity. Also repairs three mojibake em-dashes in the `play`/`stop`/`pause`
  descriptions, which rendered as `â€"` in every MCP client's tool list.

- [#9179](https://github.com/Tristan578/project-forge/pull/9179) [`b8209c8`](https://github.com/Tristan578/project-forge/commit/b8209c8c4356da55166b5acdf9da525c81fd6f30) Thanks [@Tristan578](https://github.com/Tristan578)! - Chat `spawn_entity` now honors the documented `position` parameter. Asking the AI to spawn an entity at specific world coordinates previously reported success while placing it at the origin — the manifest documented `position` and the engine honored it, but the chat handler parsed only `entityType` and `name`. A malformed position (wrong arity, non-finite element) is now rejected with a clear error instead of being silently dropped, and the AI-facing tool schema no longer advertises the internal `id` override.

- [#9130](https://github.com/Tristan578/project-forge/pull/9130) [`35e89d3`](https://github.com/Tristan578/project-forge/commit/35e89d374ee08e25da59daa3e78c07f5f0ca58a8) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(engine): drain the terrain command queues, and parent the level ground to the terrain that was actually spawned

  Two defects on the 3D game-creation path, one on each side of the bridge.

  The engine pushed every `spawn_terrain` / `update_terrain` / `sculpt_terrain` command onto a
  `PendingCommands` queue that no system ever drained. The commands were accepted, acknowledged, and
  discarded — live terrain creation was a silent no-op for the entire life of the feature. Three drain
  systems now consume those queues, apply the noise config, rebuild the mesh, and emit
  `TERRAIN_CHANGED`.

  `create_level_layout` spawned the terrain and then read `primaryId` back out of the store to parent
  the ground to it. `primaryId` is only set later, by an asynchronous engine event, so the read
  returned whatever was selected _before_ the spawn — the ground was parented to a stale entity, or to
  none. `spawnTerrain` now returns the id it generated and the engine honours that id, so the handler
  parents to the real terrain synchronously. This is the terrain variant of the mesh fix in [#8748](https://github.com/Tristan578/project-forge/issues/8748).

  Also corrected while in the file:

  - The `TERRAIN_CHANGED` payload flattened `TerrainData` to the top level while the web handler read a
    nested `terrainData`, so the terrain inspector stored `undefined` and rendered nothing. Both sides
    now assert against one shared fixture, and the event name is a single shared constant rather than a
    literal repeated across a boundary neither side can see across.
  - The sculpt brush's falloff was inverted, weakening the effect at the brush centre instead of at its
    edge.
  - Terrain resolution was unbounded and `resolution * resolution` was computed unchecked. `usize` is
    32-bit on wasm32 and the release profile does not enable overflow checks, so a large resolution
    wrapped silently in the shipped binary — at 65536 the product is exactly zero, which made every
    downstream `heights.len()` guard vacuous. The mesh builders now bound the resolution and check the
    multiplication.
  - Both terrain commands snapped the requested resolution into `{32, 64, 128, 256}` before validating
    it. Asking for 100000 returned success and silently produced a 256-grid — the exact substitution the
    validator exists to refuse, defeated before it ever ran, and a cap four times lower than the mesh
    builder actually supports. An out-of-range resolution is now rejected with a message naming the
    supported range, and an in-range one is carried through verbatim.
  - `spawn_terrain` from chat reported success even when the engine had not finished loading and nothing
    was dispatched, and never returned the new entity's id. A follow-up "now sculpt it" had nothing to
    target. It now returns the id, and reports the not-ready case as a failure.
  - The sidebar and mobile toolbars discarded the result of adding an entity, so a click before the
    engine finished loading closed the menu, added nothing, and said nothing. Both now surface the
    reason.
  - Caller-supplied entity ids were interpolated into warning logs at full length. They are now
    truncated before logging.
  - `spawnEntity('terrain')` dropped the caller's `name` argument entirely, so every named terrain came
    back as the engine's auto-generated "Terrain (n)". The name is forwarded now.

  The engine half ships as WASM and is not live until the next engine build reaches the CDN.

- [#9148](https://github.com/Tristan578/project-forge/pull/9148) [`e5e33da`](https://github.com/Tristan578/project-forge/commit/e5e33dab518ec4d46ec89ee8741ab8cfa5e101dc) Thanks [@Tristan578](https://github.com/Tristan578)! - Sculpt a terrain with its real pose the frame it spawns. `apply_terrain_spawn_requests` relied on the required `GlobalTransform`, whose default is the identity until `PostUpdate` propagates — but the terrain drains are `.chain()`ed, so `apply_terrain_sculpts` sees the new terrain in the same frame and converted the world-space brush through the wrong affine, landing a hill on the terrain's local coordinate instead of the requested world one.

- [#9199](https://github.com/Tristan578/project-forge/pull/9199) [`6a4f5a3`](https://github.com/Tristan578/project-forge/commit/6a4f5a3fc83fe16c2a27226788871d7bce041cef) Thanks [@Tristan578](https://github.com/Tristan578)! - Generated 3D players now move the way the game design document asks. The character rig step built its controller from hardcoded numbers, so a floaty space game and a weighty RPG produced identical movement; both movement steps now resolve the feel directive through one shared resolver.

- [#9154](https://github.com/Tristan578/project-forge/pull/9154) [`78dd611`](https://github.com/Tristan578/project-forge/commit/78dd611fbc8c2bb78ca82649019cea36ee809abf) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix scene management dispatching engine commands that reject by design. Scenes live JS-side in `lib/scenes/sceneManager`, but four call sites dispatched the engine's `switch_scene` / `create_scene` / `delete_scene` / `duplicate_scene` / `save_scene` stubs instead. This hard-failed every entity in the AI game-creation pipeline, made the Scene Browser's add/switch/duplicate/delete controls inert, turned scene creation into a silent no-op, and stopped crash-recovery autosave from ever writing a byte.

## 0.5.0

### Minor Changes

- [#8992](https://github.com/Tristan578/project-forge/pull/8992) [`fd5e6d0`](https://github.com/Tristan578/project-forge/commit/fd5e6d07b1832649407745ee2f8787b8587a2b57) Thanks [@Tristan578](https://github.com/Tristan578)! - feat(billing): shadow-mode Stripe billing-meter usage reporting (PF-977/PF-978, [#8969](https://github.com/Tristan578/project-forge/issues/8969)/[#8970](https://github.com/Tristan578/project-forge/issues/8970))

  Adds infrastructure for reporting confirmed generation token usage to a Stripe
  billing meter (`generation_tokens`), gated behind `BILLING_METERS_ENABLED`
  (default off, dormant). No metered Price is attached in this rollout — this
  is usage reporting only and never changes what a customer is charged.

  - `web/scripts/provision-billing-meter.ts` — one-time, idempotent, owner-run
    script to create the Stripe meter in a given mode (test/live). Not run by
    any build/deploy step.
  - `web/src/lib/billing/meterEvents.ts` — `reportGenerationUsage()`, a
    fire-and-forget reporter with claim-before-emit semantics against two new
    additive/nullable `token_usage` columns (`meter_attempted_at`,
    `metered_at`) added via `web/drizzle/0009_token_usage_meter_columns.sql`.
    Skips BYOK usage, unmetered rows, and no-ops entirely when the flag is off.
  - Runbook: `docs/guides/billing-meters-setup.md`.

  Wiring the reporter into `createGenerationHandler`'s request path is a
  separate follow-up ticket (spec slice 3) — not included here.

- [#8967](https://github.com/Tristan578/project-forge/pull/8967) [`c352a0e`](https://github.com/Tristan578/project-forge/commit/c352a0e5e8124b032fc041fdeeb7564a4e1bbdd8) Thanks [@Tristan578](https://github.com/Tristan578)! - feat: bot protection, PostHog feature flags, AI Gateway tagging, and Sentry observability expansion (PF-975 [#8948](https://github.com/Tristan578/project-forge/issues/8948), PF-971 [#8952](https://github.com/Tristan578/project-forge/issues/8952), PF-969 [#8954](https://github.com/Tristan578/project-forge/issues/8954), PF-967 [#8956](https://github.com/Tristan578/project-forge/issues/8956))

  - **Bot protection (PF-975):** Vercel BotID verification gates every `/api/generate/*` route (via `createGenerationHandler`) and the Stripe checkout route, running before rate-limiting and token/payment spend.
  - **PostHog feature flags (PF-971):** a safe-subset local flag evaluator (`web/src/lib/flags/posthogFlags.ts`) supports full rollout, 0% rollout, or a single `tier` exact-match filter, evaluated with zero network I/O. Wires a `deep-generation-tier` override into the existing Opus deep-tier gate and per-provider kill switches (`provider-kill-switch-<provider>`) into `createGenerationHandler`. Fully dormant unless `POSTHOG_PERSONAL_API_KEY` + `NEXT_PUBLIC_POSTHOG_KEY` are set.
  - **AI Gateway request tagging (PF-969):** gateway-routed chat requests carry `providerOptions.gateway.{user,tags}` for per-user cost attribution in the AI Gateway dashboard.
  - **Sentry observability expansion (PF-967):** a DSN-gated `sentryLogger` wrapper (`web/src/lib/monitoring/sentry-server.ts`) forwards structured `Sentry.logger.*` calls at high-signal, low-volume lifecycle points — provider kill-switch trips, token refunds, Stripe webhook release-claim double failures, and the durable QStash generation-callback terminal states (completed/failed/timeout). Also adds `Sentry.feedbackIntegration` to the client widget. `enableLogs: true` was already set in all three Sentry init files prior to this batch — no change needed there.

### Patch Changes

- [#8926](https://github.com/Tristan578/project-forge/pull/8926) [`e9000be`](https://github.com/Tristan578/project-forge/commit/e9000be63907270ab2afc8f52b502e564c69dcbd) Thanks [@dependabot](https://github.com/apps/dependabot)! - chore(deps): bump npm minor-and-patch group (30 updates, [#8926](https://github.com/Tristan578/project-forge/issues/8926))

  Routine minor/patch dependency group update. Runtime deps in `web`: `@ai-sdk/anthropic` 4.0.8→4.0.12, `@ai-sdk/gateway` 4.0.12→4.0.16, `@ai-sdk/mcp` 2.0.7→2.0.10, `@ai-sdk/react` 4.0.16→4.0.23, `@anthropic-ai/sdk` 0.110→0.111, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 3.1079→3.1085, `@clerk/nextjs` 7.5.12→7.5.17, `@sentry/nextjs` 10.63→10.65, `@xyflow/react` 12.11.1→12.11.2, `next-intl` 4.13.1→4.13.2, `posthog-js` 1.396.6→1.399.3, `stripe` 22.3.0→22.3.1. Tooling/dev deps: Storybook 10.4.6→10.5.0 (react, react-vite, addon-a11y, addon-docs, core), `vite` 8.1.3→8.1.4, `@vitest/coverage-v8` 4.1.9→4.1.10, `turbo` 2.10.3→2.10.5 (root), `eslint` 9.39.4→9.39.5, `tsx` 4.23.0→4.23.1, `@types/node` 26.1.0→26.1.1, `fumadocs-core`/`fumadocs-ui` 16.10.7→16.11.4 in `apps/docs`. Dependabot resolved and relocked the single root lockfile from the repo root, so no manual lockfile intervention was needed.

- [#8964](https://github.com/Tristan578/project-forge/pull/8964) [`7f665d4`](https://github.com/Tristan578/project-forge/commit/7f665d437936ad3d17c7d398c27cec575f777700) Thanks [@dependabot](https://github.com/apps/dependabot)! - chore(deps): bump npm minor-and-patch group (30 updates, [#8964](https://github.com/Tristan578/project-forge/issues/8964))

  Routine minor/patch dependency group update. Runtime deps in `web`: `@ai-sdk/anthropic` 4.0.12→4.0.16, `@ai-sdk/gateway` 4.0.16→4.0.23, `@ai-sdk/mcp` 2.0.10→2.0.15, `@ai-sdk/provider-utils` 5.0.7→5.0.11, `@ai-sdk/react` 4.0.23→4.0.34, `ai` 7.0.22→7.0.31, `@anthropic-ai/sdk` 0.111.0→0.112.3, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 3.1085→3.1090, `@clerk/nextjs` 7.5.17→7.5.20, `@sentry/nextjs` 10.65.0→10.67.0, `@upstash/qstash` 2.11.1→2.11.2, `lucide-react` 1.24→1.25, `posthog-js` 1.399.3→1.404.1, `stripe` 22.3.1→22.3.2 (ApiVersion literal unchanged — tsc gate green), `svix` 1.96.1→1.98.0, `ws` 8.21.0→8.21.1. Tooling/dev deps: Storybook 10.5.0→10.5.3, `vite` 8.1.4→8.1.5, Tailwind 4.3.2→4.3.3, `@changesets/cli` 2.31.0→2.31.1, `portless` 0.15.1→0.15.4, `fumadocs-core`/`fumadocs-ui` 16.11.4→16.11.5 in `apps/docs`.

  Manual fix on top of the Dependabot bump: `@clerk/nextjs` 7.5.20 requires `@clerk/shared` ^4.25.5 (it imports `isAutoProxyDisabledFromEnvironment`, added after 4.23.0), but the root-override security floor `@clerk/shared: ^4.22.1` kept the lockfile's single hoisted copy at 4.23.0 — npm does not re-resolve an already-pinned transitive when only its override range changes, so the Turbopack build failed with a missing export while Lockfile Sync stayed green. Raised the override floor to `^4.25.5` and relocked the root lockfile on Node 24 (only the `@clerk/shared` version/resolved/integrity lines changed; regen verified byte-stable).

- [#9070](https://github.com/Tristan578/project-forge/pull/9070) [`5aba801`](https://github.com/Tristan578/project-forge/commit/5aba8017711f3ad0e1057c571a9317a51e3e11ea) Thanks [@dependabot](https://github.com/apps/dependabot)! - chore(deps): bump npm minor-and-patch group (25 updates, [#9070](https://github.com/Tristan578/project-forge/issues/9070))

  Routine minor/patch dependency group update. Runtime deps in `web`: `@ai-sdk/anthropic` 4.0.21→4.0.26, `@ai-sdk/gateway` 4.0.28→4.0.35, `@ai-sdk/mcp` 2.0.16→2.0.21, `@ai-sdk/react` 4.0.40→4.0.49, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 3.1096→3.1101, `@clerk/nextjs` 7.6.1→7.6.4, `@sentry/nextjs` 10.68.0→10.69.0, `@upstash/redis` 1.38.0→1.38.1, `acorn` 8.17.0→8.18.0, `lucide-react` 1.27.0→1.28.0, `posthog-js` 1.407.3→1.409.5, `stripe` 22.3.2→22.4.0. Tooling/dev deps: `@playwright/test` 1.62.0→1.62.1, `jsdom` 30.0.0→30.0.1, `portless` 0.15.4→0.15.5, `@types/react` 19.2.17→19.2.18, `@types/react-dom` →19.2.4, `turbo` 2.10.7→2.10.8 (root), `vite` 8.1.5→8.2.0 + `@vitejs/plugin-react` 6.0.4→6.0.5 in `apps/design`, `fumadocs-core`/`fumadocs-ui` 16.13.0→16.14.0 in `apps/docs`.

  Manual fix on top of the Dependabot bump: stripe-node 22.4.0 rolls its pinned `ApiVersion` literal from `2026-06-24.dahlia` to `2026-07-29.dahlia`, and the SDK types reject any other value — so the hardcoded string had to move in lockstep across `web/src/lib/billing/stripe-client.ts` plus the three billing route tests that assert it (`status`, `portal`, `checkout`), or `tsc --noEmit` fails and cascades into every build- and E2E-dependent job. The `invoice.parent.subscription_details.subscription` / top-level `invoice.subscription` dual read in the Stripe webhook route is deliberately unchanged: the Dashboard webhook endpoint carries its own API version, so both shapes must still be read. Verified unused across `web/src` and `mcp-server/src`: the only two removals in 22.4.0 (`proof_of_registration`, `dynamic_tax_rates`).

- [#9053](https://github.com/Tristan578/project-forge/pull/9053) [`7c32690`](https://github.com/Tristan578/project-forge/commit/7c326903f3e2421f44ef2cccb3dc233839743817) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(web): restore scrolling on every public page (PF-1017, [#9037](https://github.com/Tristan578/project-forge/issues/9037))

  Two independent defects each removed scrolling from every logged-out page, and
  both failed silently — `window.scrollTo()` kept working, so nothing threw and
  no automated check noticed.

  - `globals.css` set `body { overflow: hidden }`. With `html` at `overflow:
visible`, an overflow on `body` propagates to the VIEWPORT rather than
    clipping the body box, so the scrollbar and wheel/trackpad input died
    document-wide. The rule was load-bearing for the editor only, so it moves to
    a new `<ViewportLock>` applied at the `/editor` and `/dev` route segments
    instead of globally. `ViewportLock` is a static `h-dvh overflow-hidden`
    box, deliberately not `position: fixed` — a fixed element establishes a
    stacking context and would re-scope every `z-index` inside the editor
    relative to body-level portals (toasts, dialogs). It uses `h-dvh` rather
    than `h-screen` because `100vh` is the _large_ viewport on mobile browsers,
    so a `100vh` box would overflow the visual viewport by the browser-chrome
    height and make the editor document-scrollable — something the old global
    rule had been masking. `EditorLayout`'s two roots move to `h-dvh` to match.
  - `app/(marketing)/page.tsx` and `app/page.tsx` both resolved to `/`. Next.js
    compiled both and `/page` won, so the route group's layout — which held the
    only scroll wrapper — never wrapped anything. The landing page moves to
    `components/marketing/LandingPage.tsx` and the dead `(marketing)` group is
    removed, leaving exactly one file routed to `/`.

  `web/src/app/__tests__/public-scroll.test.ts` adds structural guards for both
  defects plus the editor's viewport lock. The assertions are structural because
  the failure mode is: the rendered markup is correct in jsdom, which has no
  viewport to clip. The guards cover every `html`/`body` rule in `globals.css` and
  in the `@import`ed `@spawnforge/ui` token sheet, the `<body className>` in the
  root layout, and every `page.*` under `app/` at any depth — failing on any URL
  path claimed twice, not just `/`.

  Those CSS guards walk brace depth rather than matching line-anchored regexes, so
  a rule nested inside `@media (max-width: …)` is caught too — a media query gates
  the cascade, it does not suppress it, so a nested `body { overflow: hidden }`
  reintroduces the bug on mobile while a top-level-only guard stays green. The
  extractor is itself pinned against a synthetic stylesheet, which is what guards
  the token sheet: that file legitimately has no `html`/`body` rules today, so
  "found more than zero rules in every real file" is not an assertion that can be
  made there.

  `web/e2e/tests/mobile-viewport.spec.ts` gains a document-scroll containment
  assertion at both emulated mobile viewports. Chromium has no retracting URL bar,
  so it cannot reproduce the mobile-Safari large-viewport case — it is a tripwire
  for the general "editor grew a document scrollbar" regression, where there was
  previously none.

  That directory also had no coverage in the local workspace gate: `src/app/__tests__`
  matched neither `vitest.config.node.ts` nor `vitest.config.jsdom.ts`, so five
  suites ran only under the standalone `vitest.config.ts`. The node config's globs
  now include it.

- [#8991](https://github.com/Tristan578/project-forge/pull/8991) [`a5c38ae`](https://github.com/Tristan578/project-forge/commit/a5c38aef707062b5a26ad2f33b0817a0392128da) Thanks [@Tristan578](https://github.com/Tristan578)! - Add graph_nodes and graph_edges tables (Drizzle schema + migration) for graph-based retrieval. Schema-only phase — no extraction, ingest, or query-time retrieval logic yet.

- [#9059](https://github.com/Tristan578/project-forge/pull/9059) [`a05486e`](https://github.com/Tristan578/project-forge/commit/a05486eb63b7a59e8058b73e01d6ab8dfec9fc90) Thanks [@Tristan578](https://github.com/Tristan578)! - Fix published games rendering blank at `/play/*` (PF-1018).

  The `/play` Content-Security-Policy set `script-src 'self' 'wasm-unsafe-eval'` with
  neither a nonce nor `'unsafe-inline'`. Next.js bootstraps App Router hydration with
  inline `<script>` tags, so every one of them was blocked: the server HTML painted and
  hydration never ran, leaving every published game stuck on a blank/loading page. It
  failed silently — nothing threw server-side.

  `/play` is dynamically rendered, so it can carry a real per-request nonce. The proxy
  now mints one, forwards it to the page, and emits the matching policy.

  Scope note: this does not yet prove `'unsafe-inline'` is gone from `/play` in
  production. `next.config.ts` also emits a static rule for that header — including a
  global `/:path*` rule that already carries `'unsafe-inline'` site-wide — and which
  writer the browser sees on Vercel is unverified (preview deployments sit behind SSO,
  which redirects before middleware runs, so it could not be measured). The guaranteed
  bound is that `/play` either runs the nonce policy or runs the same inline posture as
  every other page — parity, never a regression — and cannot lose both, which is what
  caused the blank page. Measuring the real winner is tracked separately.

  The proxy also now runs on every `/play` URL: the matcher's static-file extension
  exclusion previously skipped a user-chosen game slug ending in `.html`/`.js`/`.css`,
  which rendered a real HTML document with no nonce and no header stripping.

  The Clerk Frontend API host is derived from the publishable key rather
  than hardcoded, so dev and production instances both resolve correctly, and the decoded
  value is validated as a bare hostname before it reaches the header.

  Client-supplied `x-nonce`, `Content-Security-Policy` and `Content-Security-Policy-Report-Only`
  request headers are stripped on every route, so a caller cannot hand the app a nonce of
  their choosing — Next.js reads the nonce from either CSP header name.

  Also fixes a related dev-server breakage on the 12 eval-free content routes: Next.js's
  Fast Refresh runtime evaluates a string, which threw during module execution and aborted
  hydration under `npm run dev`. `'unsafe-eval'` is now admitted for the dev server only,
  gated on `NODE_ENV === 'development'`; production builds are unchanged.

- [#9066](https://github.com/Tristan578/project-forge/pull/9066) [`a35edaa`](https://github.com/Tristan578/project-forge/commit/a35edaa306447bc63be97cd8c5ff61493c0e7094) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(marketing): remove fabricated testimonials and the user-count claim from the landing page (PF-1020, [#9040](https://github.com/Tristan578/project-forge/issues/9040))

  SpawnForge is waitlist-only — every CTA on the page reads "Join the Waitlist" — yet the page published three named endorsements with invented job titles and a "Join thousands of creators" line. Both described users who do not exist.

  - Deletes the `testimonials` data array and the entire social-proof section.
  - Replaces the two tests that asserted the content was present with structural guards: no `blockquote`/`figcaption` endorsement markup, no "trusted by"/"loved by" heading, and no unverifiable population claim anywhere in the rendered text.

- [#9073](https://github.com/Tristan578/project-forge/pull/9073) [`53f447d`](https://github.com/Tristan578/project-forge/commit/53f447d6ee251d83b298f562683447d853acf551) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(deps): relock brace-expansion to 1.1.18 / 5.0.9 and fast-uri to 3.1.5 — clears three high advisories and retires the last npm-audit waiver's premise

  The `Quality Gates / Rust Security Audit` npm-audit gate (`scripts/check-npm-audit.sh`) went red repo-wide. This was not caused by any PR's diff — the advisory database is evaluated at run time, so every open PR fails the same gate on re-run while their existing greens predate the publication.

  Two advisories fired on `brace-expansion`:

  - **GHSA-rgw5-rvv9-x895** (high, newly published, NOT allowlisted): DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation. Patched at 1.1.18 / 2.1.4 / 3.0.6 / 5.0.9.
  - **GHSA-mh99-v99m-4gvg** (high, allowlisted) reported outside its pinned location — the [#9016](https://github.com/Tristan578/project-forge/issues/9016) regression class the location pinning from PF-1009 exists to catch. Patched at 1.1.17 / 5.0.8.

  A third advisory published while this fix was being verified, on a different package — the same live-database class, and the reason the gate went red again on a re-run with no diff change:

  - **GHSA-7p8r-x3mc-p8w7** (high, newly published, NOT allowlisted): `fast-uri` host confusion via a backslash authority introducer. Patched at 2.4.4 / 3.1.5 / 4.1.2. The tree carries exactly one node at 3.1.4; it relocks to 3.1.5 inside its existing range (three lines, one node).

  Fixed with a scoped relock under Node 24 (`npm update brace-expansion --package-lock-only`): the root copy moves 1.1.16 → 1.1.18 and both nested copies (under `glob/` and `@typescript-eslint/typescript-estree/`) move 5.0.8 → 5.0.9. Nine insertions and nine deletions, touching only those three nodes — no platform-native entries dropped and no pinned roots floated.

  The relock also invalidates the premise of the gate's sole remaining waiver. Its justification claimed the advisory was "patched ONLY in 5.0.8 (no 1.x/2.x backport exists)", which made the root `brace-expansion@1.1.x` under the minimatch@3 / eslint-9 lint toolchain un-relockable. Upstream shipped 1.1.17, so that is no longer true: the root copy relocks inside its existing `^1.1.7` range with no eslint-major migration. The waiver's comment is corrected in place to record this — the entry now waives nothing and the gate emits its anti-rot note for it in every workspace. Deleting the entry is deliberately left to a follow-up (PF-1046) because the hardened self-defense suite pins the id as present, sed-anchors its variant harness on the exact entry literal, and would need empty-array guards for bash 3.2 on macOS.

  Verified after both relocks: `npm audit --json` reports zero vulnerabilities at every severity across the whole graph; `scripts/check-npm-audit.sh` exits 0 for `web`, `mcp-server`, and the repo root, each printing the anti-rot note; `scripts/__tests__/check-npm-audit.test.sh` passes in full; `scripts/check-lockfile-sync.sh` passes against the committed lockfile; `npm ci` and `scripts/check-native-bindings.sh` verified under Node 24.

- [#9074](https://github.com/Tristan578/project-forge/pull/9074) [`1a8224c`](https://github.com/Tristan578/project-forge/commit/1a8224c2d8de9a70c8dc89e3a059d25bf549285e) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(deps): relock ip-address to 10.4.0 — clears GHSA-mwp4-54f8-5fhr (SSRF / trust-boundary bypass)

  `GHSA-mwp4-54f8-5fhr` (high) was published while [#9073](https://github.com/Tristan578/project-forge/issues/9073) was in flight and immediately re-reddened the `Quality Gates / Rust Security Audit` gate, this time in the `mcp-server` workspace: `ip-address`'s `Address4` decodes leading-zero octets as decimal while OS resolvers decode them as octal, so a value like `0177.0.0.1` can be validated as one address and resolved as another — an SSRF and trust-boundary bypass. Vulnerable at `<= 10.3.0`, patched at 10.3.1.

  Scoped relock under Node 24 (`npm update ip-address --package-lock-only`): the single node moves 10.2.0 → 10.4.0 inside its existing range. Three lines, one node, no platform-native entries dropped.

  This is the fourth high advisory to fire in a single afternoon (after `GHSA-rgw5-rvv9-x895` and `GHSA-mh99-v99m-4gvg` on brace-expansion and `GHSA-7p8r-x3mc-p8w7` on fast-uri, all fixed in [#9073](https://github.com/Tristan578/project-forge/issues/9073)). The gate evaluates the advisory database at run time, so a green `Rust Security Audit` only certifies the moment it ran — it is not a durable property of the commit. A PR whose checks predate a publication is not "still green"; it is unverified against the current database.

  Verified: `scripts/check-npm-audit.sh` exits 0 for `web`, `mcp-server`, and the repo root; `scripts/check-lockfile-sync.sh` passes against the committed lockfile; `npm ci` and `scripts/check-native-bindings.sh` verified under Node 24.

- [#9007](https://github.com/Tristan578/project-forge/pull/9007) [`e1f0f05`](https://github.com/Tristan578/project-forge/commit/e1f0f05a876f2ab6ad3e00b6617a6e456c4b833d) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(deps): clear npm-audit gate — postcss floor 8.5.18 and brace-expansion 5.0.8; waive the un-relockable brace-expansion 1.x by id

  Two source advisories were blocking the `Quality Gates / Rust Security Audit` npm-audit gate (`scripts/check-npm-audit.sh`) at high severity.

  - **postcss**: override floor raised `>=8.5.10` → `>=8.5.18` (root + web manifests, including the `next`-scoped override); the lockfile resolves to 8.5.23. The already-pinned in-range 8.5.16 node does not move on a plain relock, so the bump is applied with `npm update postcss --package-lock-only` — the committed lockfile is a fixed point of the Lockfile Sync gate's regeneration.
  - **brace-expansion** (GHSA-mh99-v99m-4gvg, unbounded-expansion OOM DoS): patched ONLY in 5.0.8 — no 1.x/2.x backport exists. The two relockable 5.0.7 copies (under `glob` and `@typescript-eslint/typescript-estree`) move to 5.0.8. The root 1.1.16 copy is dev-only and pinned `^1.1.7` by the minimatch@3/eslint-9 lint toolchain — un-relockable without an eslint-major migration and non-exploitable here (input is our own lint globs) — so it is waived by advisory id in `ALLOWED_ADVISORIES` with justification and removal path (eslint 10 or a 1.x backport).
  - The two stale esbuild waivers (GHSA-gv7w-rqvm-qjhr, GHSA-g7r4-m6w7-qqqr) are pruned — the gate's anti-rot notes reported them gone from every workspace. The hermetic test suite (`scripts/__tests__/check-npm-audit.test.sh`) is migrated to the new allowlist occupant and now pins that the esbuild ids stay pruned.

  Root lockfile relocked on Node 24; both audit gates (`web` and `mcp-server`) pass exit 0 with exactly one WAIVED line in `web`; `scripts/check-lockfile-sync.sh` passes against the committed lockfile; `npm ci` integrity verified under Node 24.

- [#8998](https://github.com/Tristan578/project-forge/pull/8998) [`97391b7`](https://github.com/Tristan578/project-forge/commit/97391b7680aa416789805db47dfdfa5c90701df3) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(deps): clear npm-audit gate — sharp 0.34→0.35 (CVE) and fast-uri 3.1.3→3.1.4

  Two source advisories were blocking the `Quality Gates / Rust Security Audit` npm-audit gate (`scripts/check-npm-audit.sh`) at high severity, which in turn blocks the merge train.

  - **sharp**: next's optional transitive was pinned at 0.34.5 (vulnerable). `overrides` alone cannot bump it — npm drops an optional dep to `undefined` when an override forces a range its parent doesn't satisfy. Fix: declare `sharp: ^0.35.0` as a direct root **devDependency** (forces 0.35.x into the tree, reproducible via `--package-lock-only`) plus an `overrides.next.sharp: ^0.35.0` so next's optional range realigns and dedupes to the single hoisted 0.35.3 node instead of keeping a stray 0.34.5 copy. devDependency is semantically correct: on Vercel, next image optimization runs Vercel-side, so sharp is build/dev-time only and `npm ci --omit=dev` pruning it in prod is harmless. Verified: sharp → 0.35.3, zero stray 0.34.x nodes; sharp ships prebuilt `@img/sharp-<platform>` binaries so this adds no compile step.
  - **fast-uri**: overridden to `^3.1.4` (NOT `>=3.1.4`, which overshoots to 4.1.1 and violates ajv's `^3.0.1`). Resolves to 3.1.4.

  Root lockfile relocked on Node 24 with the CI-exact `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` (idempotent; the diff touches only sharp/@img/fast-uri nodes — no unrelated drift). Both audit gates (`web` and `mcp-server`) now pass exit 0; `npm ci` integrity verified under Node 24.

- [#9003](https://github.com/Tristan578/project-forge/pull/9003) [`983d0b5`](https://github.com/Tristan578/project-forge/commit/983d0b5d1efeef1cef925eb028c05e2d28e8165f) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(security): remediate all 10 open Dependabot alerts + the CodeQL alert, and add a scheduled gate so alert debt can't silently accumulate again (PF-1000)

  - **next 16.2.10 → 16.2.11** (`web`): clears 9 Dependabot alerts — SSRF (GHSA-89xv-2m56-2m9x, GHSA-p9j2-gv94-2wf4), middleware bypass (GHSA-6gpp-xcg3-4w24), DoS (GHSA-m99w-x7hq-7vfj), plus mediums.
  - **@hono/node-server override ^1.19.13 → ^2.0.5** (mcp-server, transitive via `@modelcontextprotocol/sdk`): clears GHSA-frvp-7c67-39w9 (Windows serve-static path traversal). The SDK only imports `getRequestListener`, which v2 retains with dual ESM/CJS exports; peer `hono ^4` is satisfied by the pinned 4.12.31. Relock required deleting the stale SDK subtree lock nodes first — npm neither re-resolves an already-pinned transitive on an override change, nor (after deleting only the package's own node) re-adds it.
  - **tools/agentic-sync/sync.mjs**: CodeQL js/incomplete-multi-character-sanitization — comment stripping now runs to a fixed point, so spliced-together bytes (`<!<!-- x -->--`) can no longer smuggle a live `<!-- AGENTIC-SYNC:END -->` sentinel through a single-pass replace.
  - **New scheduled gate** (`scripts/check-security-alerts.sh` + `.github/workflows/security-alerts.yml`): daily + on-demand check that fails while any open Dependabot or code-scanning alert exists (GHSA allowlist mirrors the npm-audit gate's two dev-only esbuild waivers; fails closed on tooling errors). Scheduled rather than PR-blocking because repo-level alerts only close after the fixing PR merges.

## 0.4.2

### Patch Changes

- [#8916](https://github.com/Tristan578/project-forge/pull/8916) [`cc2721d`](https://github.com/Tristan578/project-forge/commit/cc2721d570758540897b38ee3fe54f9dd36f607e) Thanks [@dependabot](https://github.com/apps/dependabot)! - chore(deps-dev): bump chromatic from 11.29.0 to 18.0.1 in apps/design ([#8916](https://github.com/Tristan578/project-forge/issues/8916))

  Dev-toolchain-only update: bumps the `chromatic` CLI devDependency range in `apps/design` (`^11` → `^18`). The CLI is only invoked by the Chromatic Visual Regression job in `quality-gates.yml`, which already pins `chromaui/action` v18.0.1 — this aligns the local CLI with the action. CLI 18 renames its bin entry to `dist/bin.cjs`, requires Node >= 22 (we run Node 24), and adds an optional `@chromatic-com/vitest` peer (unused). No runtime or published-artifact changes. The root lockfile was regenerated on Node 24 (`npm install --package-lock-only`) from main's lockfile as base. Note: Dependabot-authored CI runs skip the Chromatic project token, so the first token-bearing run after merge is the real CLI-18 smoke test.

## 0.4.1

### Patch Changes

- [#8903](https://github.com/Tristan578/project-forge/pull/8903) [`1f7b929`](https://github.com/Tristan578/project-forge/commit/1f7b9292c464a879b633c8bfbd40df4d5a6b5f2c) Thanks [@dependabot](https://github.com/apps/dependabot)! - chore(deps): bump dockview-react 6.6.1 → 7.0.2 ([#8903](https://github.com/Tristan578/project-forge/issues/8903)) + re-baseline first-load JS budget

  dockview-react 7 ships an accessibility pack (ARIA roles, keyboard navigation, live regions) that adds ~27.5 KB minified and is not tree-shakeable in 7.0.2 (the `dockview-modules` opt-out entry point is unpublished). Our dockview usage is untouched by the v7 breaking changes — we use none of `onDidActivePanelChange`'s changed payload, `rootOverlayModel`, or the renamed types, and `.dv-*` CSS classes plus `SerializedDockview` layout serialization are byte-identical.

  The first-load JS budget is re-baselined to warn 5.3 MB / fail 5.5 MB (was 4.75/5.25) in `performanceTargets.ts` and the `check-bundle-size.js` mirror: main was already at 5.24 MB against the 5.25 MB hard gate, so any dependency growth tripped it. The +720 KB creep since the March baseline is tracked in [#8910](https://github.com/Tristan578/project-forge/issues/8910).

- [#8907](https://github.com/Tristan578/project-forge/pull/8907) [`7fd0562`](https://github.com/Tristan578/project-forge/commit/7fd0562ba7880dfc8764001d6ef56d5dd47a4113) Thanks [@dependabot](https://github.com/apps/dependabot)! - chore(deps): bump npm minor-and-patch group (11 updates, [#8907](https://github.com/Tristan578/project-forge/issues/8907))

  Routine minor/patch dependency group update: `@ai-sdk/anthropic` 4.0.5→4.0.8, `@ai-sdk/gateway` 4.0.8→4.0.12, `@ai-sdk/react` 4.0.12→4.0.16, `@anthropic-ai/sdk` 0.107→0.110, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 3.1076→3.1079, `posthog-js` 1.396.4→1.396.6, `@electric-sql/pglite` 0.5.3→0.5.4, `turbo` 2.10.1→2.10.3 (root), and `tsx` 4.22.4→4.23.0 in `apps/docs` + `mcp-server`. Dependabot resolved and relocked the single root lockfile from the repo root, so no manual lockfile intervention was needed.

- [#8915](https://github.com/Tristan578/project-forge/pull/8915) [`3caf4c2`](https://github.com/Tristan578/project-forge/commit/3caf4c26316aed596c2eb67a01c8325222407157) Thanks [@dependabot](https://github.com/apps/dependabot)! - chore(deps-dev): bump @types/node from 25.9.4 to 26.1.0 across the workspace ([#8915](https://github.com/Tristan578/project-forge/issues/8915))

  Dev-toolchain-only update: bumps the `@types/node` devDependency ranges in `web` (`^25` → `^26`), `apps/docs` (`^25` → `^26`), and `mcp-server` (`^25.5.0` → `^26.1.0`). Type definitions only — the runtime remains Node 24 per `engines` and `.node-version`; @types/node 26 requires TypeScript >= 5.6, which every workspace clears on TypeScript 6. No runtime or published-artifact changes. The root lockfile was regenerated on Node 24 (`npm install --package-lock-only`) to fix the manifest-mirror drift Dependabot's updater left in the web workspace blocks.

- [#8904](https://github.com/Tristan578/project-forge/pull/8904) [`5da0dc6`](https://github.com/Tristan578/project-forge/commit/5da0dc609eb0393f50124cea465965e7bf74e597) Thanks [@dependabot](https://github.com/apps/dependabot)! - chore(deps-dev): bump typescript to ^6.0.3 across the workspace ([#8904](https://github.com/Tristan578/project-forge/issues/8904))

  Dev-toolchain-only update: aligns the `typescript` devDependency ranges in `web` (`^6` → `^6.0.3`), `mcp-server` (`^6.0.2` → `^6.0.3`), `apps/docs` (`^5` → `^6`), and `packages/ui` (`^5` → `^6`). All workspaces already type-checked cleanly against TypeScript 6 in CI; no runtime or published-artifact changes. The root lockfile was regenerated on Node 24 (`npm install --package-lock-only`) to fix the manifest-mirror drift Dependabot's updater left in two workspace blocks.

## 0.4.0

### Minor Changes

- [#8883](https://github.com/Tristan578/project-forge/pull/8883) [`33dc33a`](https://github.com/Tristan578/project-forge/commit/33dc33a5b7d5da53f6283849b9164d5801cb63ca) Thanks [@Tristan578](https://github.com/Tristan578)! - Upgrade the Vercel AI SDK stack to v7 as a single coordinated major bump: `ai` 6→7, `@ai-sdk/mcp` 1→2, plus an explicit `@ai-sdk/provider-utils` ^5 pin (ending the dual-versioning that previously left it a phantom transitive dep). `@ai-sdk/anthropic`, `@ai-sdk/gateway`, and `@ai-sdk/react` remain on their v4 lines, which are the versions paired with `ai@7`. `@sentry/nextjs` stays on ^10.62.0 ([#8855](https://github.com/Tristan578/project-forge/issues/8855)).

  No application code changed — the migration is a version bump plus a root-lockfile relock. The v7 hyphenated `UIMessageChunk` chat SSE protocol is unchanged from v6, so the streaming contract test passes unmodified and no persisted chat data is affected. Sentry AI-generation spans keep emitting: v7 only stopped building OpenTelemetry spans itself, but still publishes to `diagnostics_channel` when `experimental_telemetry.isEnabled` is set, and `@sentry/nextjs@10.62.0` consumes that channel via its version-agnostic vercel-ai subscriber — so `@ai-sdk/otel` is deliberately **not** added and the four `experimental_telemetry` call sites are unchanged. Node 24 (already pinned) satisfies v7's Node 22+/ESM-only requirement.

### Patch Changes

- [#8866](https://github.com/Tristan578/project-forge/pull/8866) [`113a8fe`](https://github.com/Tristan578/project-forge/commit/113a8feccd0a456e0677b6d3e15da07ea7fc9996) Thanks [@Tristan578](https://github.com/Tristan578)! - Add a Security tab to the account settings page that mounts Clerk's prebuilt `<UserProfile routing="hash" />`, giving users self-serve access to MFA (authenticator app + backup codes), passkeys, and connected-account/device management ([#8820](https://github.com/Tristan578/project-forge/issues/8820)). The tab inherits the app-level dark `appearance` and uses `routing="hash"` so Clerk's internal navigation stays scoped to the URL hash and cannot hijack the page's own `?tab=` query routing. Dormant-safe by default: the underlying factors only become enrollable once the owner toggles them in the Clerk Dashboard (no code change, $0 on the current plan), and with no Clerk keys the provider is not mounted so nothing renders. Bot protection is documented for the future real `<SignUp>` (the public route is currently a waitlist form). No dependency or `@clerk/nextjs` version change.

- [#8879](https://github.com/Tristan578/project-forge/pull/8879) [`f8b8d64`](https://github.com/Tristan578/project-forge/commit/f8b8d64d22604aab42917e107d1f0bf389164755) Thanks [@dependabot](https://github.com/apps/dependabot)! - chore(deps): bump npm minor-and-patch group ([#8879](https://github.com/Tristan578/project-forge/issues/8879)) + relock @clerk/shared override

  Routine minor/patch dependency group update: `@anthropic-ai/sdk` 0.105→0.107, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 3.1075→3.1076, `@clerk/nextjs` 7.5.7→7.5.10, `lucide-react` 1.0.1→1.22.0, `posthog-js` 1.395→1.396.2, `svix` 1.96.0→1.96.1, `@axe-core/playwright` 4.11.3→4.12.1, `@tailwindcss/postcss` 4.3.1→4.3.2, `portless` 0.14→0.15.

  `@clerk/nextjs` 7.5.10 imports `isAutomatedEnvironment` from `@clerk/shared`, a symbol that only exists in `@clerk/shared` ≥ 4.22.1. The root `overrides` block pinned `@clerk/shared ^4.14.0`, so the build failed with `Export isAutomatedEnvironment doesn't exist in target module`. Bumped the override to `^4.22.1` (and the sibling `@clerk/nextjs` override to `^7.5.10`) and relocked the single root lockfile on Node 24, so the Clerk consumers resolve `@clerk/shared` 4.22.1 (and `@clerk/themes` keeps its compatible 3.47.x) with no invalid nodes.

- [#8864](https://github.com/Tristan578/project-forge/pull/8864) [`82538cf`](https://github.com/Tristan578/project-forge/commit/82538cf48741b704523ddcd15bc1aead4e87ba8c) Thanks [@Tristan578](https://github.com/Tristan578)! - deps: routine dependency wave (2026-06-27 changelog review).

  - `stripe` 22.2.3 → 22.3.0 — the SDK rolls its pinned `ApiVersion` literal to `2026-06-24.dahlia`, so the hardcoded literal in `stripe-client.ts` (and the billing route tests / webhook comment) moves in lockstep. Prevents a silent `tsc` break on the next relock.
  - `@sentry/nextjs` 10.59 → 10.62 — pins `streamGenAiSpans: false` and `enableTruncation: true` on the AI integrations so the 10.61 default flips don't newly stream untruncated `gen_ai` spans (span-volume/cost stays flat; opting in is a deliberate observability decision).
  - Security (Boy-Scout, surfaced reviewing the Sentry bump): all three `Sentry.init` configs set `enableLogs: true`, which routes `Sentry.logger.*` through a separate `beforeSendLog` pipeline that the existing `scrubSentryEvent` (wired only to `beforeSend`/`beforeSendTransaction`) never touched — a stray log could ship a prompt / BYOK key / PII unredacted. Added `scrubSentryLog` (reuses the same `scrubString`/`deepScrub` redaction core) and wired `beforeSendLog: scrubSentryLog` in server, edge, and client configs, with a regression guard tying `enableLogs: true` to the scrubber. It also handles two `@sentry/core` quirks: `logger.fmt` messages are boxed `String` objects shipped via `String(message)` after the hook (scrubbed via the rendered body), and the scope `username` is flattened into a `user.name` attribute that the key regex misses (`user.name`/`user.username` redacted explicitly, `user.id` kept for correlation).
  - `posthog-js` 1.392 → 1.395, `@playwright/test` 1.61.0 → 1.61.1, and the `vitest` floor `^4.1.8 → ^4.1.9` (already resolved at 4.1.9) — routine drop-in bug-fix bumps.

  `@clerk/nextjs` 7.5.9 is intentionally **not** in this wave: it is override-pinned in the root `package.json` alongside `@clerk/shared ^4.14.0`, and 7.5.9 pulls `@clerk/shared 4.22.0`, so bumping clerk without coordinating the shared/backend/react override subtree corrupts lockfile resolution. It needs a dedicated upgrade PR.

- [#8895](https://github.com/Tristan578/project-forge/pull/8895) [`18270c3`](https://github.com/Tristan578/project-forge/commit/18270c3b0673f0336831ef77c14766b4b2afe2d9) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(generate): sprite-sheet and tileset-gen generation responses now include usageId so failed jobs refund from the client

  All 12 generate routes now forward the generation agent's abort signal into their
  provider HTTP calls, so a per-route wall-clock deadline cancels the in-flight
  request deterministically rather than only the factory's await. Provider-error
  details are no longer exposed in voice/batch user-visible error messages.

- [#8891](https://github.com/Tristan578/project-forge/pull/8891) [`6340324`](https://github.com/Tristan578/project-forge/commit/63403249fb073b9bdfec1e57877228cabc698922) Thanks [@Tristan578](https://github.com/Tristan578)! - Add per-surface $ai_generation attribution for GDD, world builder, and cutscene generators so PostHog can distinguish deep-generator token usage from interactive chat traffic.

- [#8878](https://github.com/Tristan578/project-forge/pull/8878) [`242e9b8`](https://github.com/Tristan578/project-forge/commit/242e9b8a19e4fef09b6bac11d6b465c41c5ca9b0) Thanks [@Tristan578](https://github.com/Tristan578)! - feat(analytics): server-side LLM observability via PostHog `$ai_generation` (PF-907, [#8817](https://github.com/Tristan578/project-forge/issues/8817))

  Adds an env-guarded, dormant-by-default, consent-gated server capture of PostHog `$ai_generation` events on the three routes that run a model server-side (`/api/chat`, `/api/generate/localize`, `/api/generate/pacing`), powering PostHog's per-generation cost/token/latency/model/error dashboards. Capture is a dependency-free `fetch` (no `posthog-node`, no OTel span processor) fired via `after()`, and is **private by construction** — it never sends the content fields `$ai_input` / `$ai_output_choices`, only non-content metrics. Fully dormant unless `POSTHOG_LLM_CAPTURE === "true"` AND a project key is set; independently suppressed unless the user consented to analytics (PF-30, via a new server-readable `forge-cookie-consent` cookie). No behavior change when dormant.

- [#8867](https://github.com/Tristan578/project-forge/pull/8867) [`e861146`](https://github.com/Tristan578/project-forge/commit/e861146bb5af8eb1312640d2906ae952048a33a3) Thanks [@Tristan578](https://github.com/Tristan578)! - feat(generation): durable server-side generation callbacks via Upstash QStash (PF-906, [#8816](https://github.com/Tristan578/project-forge/issues/8816))

  Adds an env-guarded, dormant-by-default durable completion path for async asset generation (Meshy/Suno/Replicate). When `QSTASH_TOKEN` is set, each async generate route publishes a self-rescheduling QStash callback that polls the provider and finalizes the `generation_jobs` row + issues the refund-on-failure server-side — so a failed/timed-out/empty job is refunded even if the user closed the tab. When unset, the existing client poller is the only path and behavior is unchanged. Refund stays idempotent, so the durable and client paths never double-credit.

- [#8885](https://github.com/Tristan578/project-forge/pull/8885) [`1d8a7c2`](https://github.com/Tristan578/project-forge/commit/1d8a7c2ea4921d627c30dd93fd33cb0821eae5d2) Thanks [@Tristan578](https://github.com/Tristan578)! - Routine minor/patch dependency bumps: next 16.2.10, @clerk/nextjs 7.5.12, @sentry/nextjs 10.63.0, posthog-js 1.396.4.

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
