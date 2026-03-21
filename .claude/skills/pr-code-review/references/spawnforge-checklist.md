# SpawnForge Code Review Checklist

<!-- pattern: Reviewer -->
<!-- This rubric is loaded by the code-reviewer agent and pr-code-review skill -->
<!-- Extracted from 46+ documented failure patterns in agent-produced PRs -->

## Severity Definitions

| Level | Meaning | Action |
|-------|---------|--------|
| BLOCK | Will cause runtime failure, data loss, security vulnerability, or CI failure | Must fix before merge |
| WARN | Likely to cause issues in edge cases or degrades quality | Should fix, but can merge with ticket |
| INFO | Style, minor improvement, or future concern | Optional fix |

---

## Category 1: Panel & Workspace Registration (BLOCK)

The #1 agent bug pattern. Every new AI workspace panel MUST be registered in two places.

- [ ] **panelRegistry entry exists** -- Check @web/src/lib/workspace/panelRegistry.ts has an entry for every new panel component with correct `id`, `label`, `icon`, and `component` fields.
- [ ] **Component import exists** -- The panel component is actually imported in the registry file (not just referenced by string).
- [ ] **JSX is well-formed** -- No unclosed tags, no duplicate attributes, no missing closing brackets. Agents frequently produce broken JSX.
- [ ] **No duplicate panel IDs** -- Each panel ID is unique across the entire registry.

**How to check:**
```bash
# Structural test catches most issues
cd web && npx vitest run src/lib/workspace/__tests__/panelRegistry.test.ts
```

## Category 2: Bridge Isolation (BLOCK)

The #1 architecture rule. Violations compile but create platform coupling.

- [ ] **core/ has zero browser deps** -- Files in `engine/src/core/` must NOT import `web_sys`, `js_sys`, `wasm_bindgen`, or any crate that depends on them.
- [ ] **bridge/ is the only interop module** -- Only files in `engine/src/bridge/` may use browser APIs.
- [ ] **No `unsafe` without `// SAFETY:` comment** -- Every unsafe block must justify why it's safe.

**How to check:**
```bash
bash .claude/tools/validate-rust.sh check
python3 .claude/skills/arch-validator/check_arch.py
```

## Category 3: ECS Component Completeness (BLOCK)

New components require updates across 4 Rust + 4 web files minimum.

- [ ] **EntitySnapshot field added** -- New `Option<ComponentData>` field in `EntitySnapshot` struct.
- [ ] **EntitySnapshot::new() updated** -- New field set to `None` in constructor.
- [ ] **spawn_from_snapshot arm added** -- If the component is spawnable, `entity_factory.rs` handles it.
- [ ] **UndoableAction variant added** -- If the component is user-modifiable, `history.rs` has a variant.
- [ ] **Selection emit works** -- Bridge module emits selection events when component data changes.
- [ ] **Web store slice exists** -- `web/src/stores/slices/` has a corresponding slice file.
- [ ] **Event handler exists** -- `web/src/hooks/events/` has a handler for the component's events.
- [ ] **Chat handler exists** -- `web/src/lib/chat/handlers/` has tool call handlers for MCP parity.

## Category 4: API Route Safety (BLOCK)

- [ ] **await on rate limiting** -- `rateLimitPublicRoute()` and `rateLimit()` calls MUST be awaited. Missing await silently skips rate limiting.
- [ ] **Auth check present** -- API routes that access user data must call auth middleware.
- [ ] **maxDuration exported** -- AI-heavy routes (generation, chat) must export `maxDuration` to prevent Vercel timeout.
- [ ] **Token refund on failure** -- Generate routes must refund tokens when the provider call fails.
- [ ] **Input validation** -- `typeof prompt === 'string'` check before using prompt input.
- [ ] **No hardcoded API keys** -- All keys from environment variables.

## Category 5: SceneGraph & Entity API (BLOCK)

- [ ] **sceneGraph.nodes not sceneGraph** -- Iterating the scene graph requires `.nodes` property.
- [ ] **node.components not node.entityType** -- SceneNode objects use `components` array, not `entityType` property.
- [ ] **Entity ID format validated** -- Entity IDs are strings, not numbers.

## Category 6: TypeScript Quality (WARN)

- [ ] **No `any` types** -- Use proper types or `unknown` with type guards.
- [ ] **No `||` for numeric defaults** -- Use `??` (nullish coalescing). `0 || default` returns default when value is 0.
- [ ] **No .json() on streaming responses** -- SSE/streaming responses cannot be parsed as JSON.
- [ ] **No Math.max/min spread on large arrays** -- Stack overflow on arrays with 65k+ items. Use reduce().
- [ ] **Unused variables use `_` prefix** -- ESLint enforces `argsIgnorePattern: ^_`.
- [ ] **No useRef.current during render** -- Use useState prev-value pattern instead.
- [ ] **No Date.now() / Math.random() during render** -- Move to useEffect or useMemo.

## Category 7: MCP Manifest Sync (WARN)

- [ ] **Both manifests match** -- @mcp-server/manifest/commands.json and @web/src/data/commands.json must be identical.
- [ ] **New commands have all required fields** -- `name`, `category`, `description`, `parameters` with types.
- [ ] **Category exists in test validation** -- `validCategories` array in @mcp-server/src/manifest.test.ts includes any new category.

**How to check:**
```bash
bash .claude/tools/validate-mcp.sh full
```

## Category 8: Test Coverage (WARN)

- [ ] **New store slices have tests** -- Follow `sliceTestTemplate.ts` pattern with `createSliceStore()`.
- [ ] **New event handlers have tests** -- Test event to store update mapping.
- [ ] **New chat handlers have tests** -- Test arg validation + dispatch + error cases.
- [ ] **Mock paths use `@/` alias** -- Never relative paths from `__tests__/` directories.
- [ ] **No it.skip without ticket** -- Skipped tests must reference a PF-XXX ticket.
- [ ] **vi.resetModules() for worker tests** -- Script worker tests need module reset + dynamic import.

## Category 9: Security (BLOCK)

- [ ] **No dynamic code execution** in production code (scripting sandbox is exempt via Web Worker isolation).
- [ ] **sanitizePrompt uses replaceAll()** -- Single replace() only strips the first match.
- [ ] **No SQL string interpolation** -- All DB queries use parameterized values via Drizzle.
- [ ] **CORS headers correct** -- No `*` origin in production.
- [ ] **Webhook signatures verified** -- Stripe webhooks validate `stripe-signature` header.

## Category 10: Performance (WARN)

- [ ] **No O(n^2) entity lookups** -- Use Maps or indices, not nested loops over entity arrays.
- [ ] **Debounced inspector inputs** -- 100ms for sliders, 300ms for text inputs.
- [ ] **Virtual scrolling for long lists** -- Use `useVirtualList` hook for lists > 50 items.
- [ ] **No synchronous heavy computation in render** -- Move to Web Worker or requestIdleCallback.
- [ ] **console.log removed** -- No debug logging in production code paths.

## Category 11: Rendering & WASM (WARN)

- [ ] **tonemapping_luts feature enabled** -- Without it, materials render pink/magenta.
- [ ] **WebGPU-only features gated** -- bevy_hanabi and GPU particles behind `#[cfg(feature = "webgpu")]`.
- [ ] **No parallel feature on rapier** -- Rayon panics on WASM.
- [ ] **wasm-bindgen version pinned** -- Must be 0.2.108 exactly.
- [ ] **Use json_compatible() serializer** -- Default serde_wasm_bindgen serializer produces JS Map, not plain objects.

## Quick Verification Commands

```bash
# Full validation suite
bash .claude/tools/validate-all.sh

# Architecture only
bash .claude/tools/validate-rust.sh check

# Frontend (lint + tsc + vitest)
bash .claude/tools/validate-frontend.sh quick

# MCP sync
bash .claude/tools/validate-mcp.sh full

# panelRegistry structural test
cd web && npx vitest run src/lib/workspace/__tests__/panelRegistry.test.ts
```
