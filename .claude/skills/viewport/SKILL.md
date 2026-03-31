---
name: viewport
description: Visually verify the SpawnForge editor renders correctly — Playwright canvas readback, scene graph inspection, WebGPU/WebGL2 output validation. Use when visual rendering may be broken, after engine changes, or for visual regression checks.
---

# Viewport Verification Skill

Use this skill when you need to visually verify that something you built in the SpawnForge editor is actually rendering and in the correct state.

## When to Use

- After spawning entities — verify they appear in the scene graph and are visible
- After dispatching engine commands — confirm the command took effect
- After entering play mode — verify the mode transition succeeded
- When debugging blank canvases — distinguish engine-not-initialized from render failure
- Before declaring a build task complete — observe the final state

## Setup

```typescript
import { agentTest } from '../fixtures/editor.fixture';
import { formatObservation, formatVerificationResult } from '../lib';

agentTest('verify my build', async ({ agentViewport: av }) => {
  await av.boot(); // Load editor + wait for WASM engine
  // ... build something ...
  const obs = await av.observe('after build');
  console.log(formatObservation(obs));
});
```

## Key Methods

### `av.boot()`
Load the editor and wait for the WASM engine to initialize. Also registers the console error listener. Call before any other method.

### `av.bootPage()`
Load the editor without waiting for the engine. Use for UI-only tests that set `__SKIP_ENGINE = true`.

### `av.observe(label?, options?)`
Returns a `ViewportObservation` with:
- `scene` — entity count, nodes map, selected IDs, engine mode
- `viewport` — canvas capture (dataUrl, dimensions, backend, isBlank flag)
- `consoleErrors` — errors collected since boot()

### `av.sendCommand(cmd, payload)`
Dispatch an engine command via `__FORGE_DISPATCH`. Returns `CommandResult` with success/error/durationMs.

```typescript
await av.sendCommand('spawn_entity', { entityType: 'Cube' });
await av.waitForEntity('Cube');
```

### `av.verifyEntityExists(name)`
Check that an entity with the given name (case-insensitive) exists in the scene graph.

### `av.verifyEntitySelected(entityId)`
Check that the given entity ID is currently selected.

### `av.enterPlayMode()` / `av.exitPlayMode()`
Enter/exit play mode. Follow with `av.waitForMode('play')`.

### `av.waitForEntity(name, timeout?)`
Wait until an entity with the given name appears in the scene graph.

### `av.waitForMode(mode, timeout?)`
Wait until `engineMode` in the store equals the given value.

### `av.getSelectedEntityProperties()`
Returns the `SceneNodeSummary` of the first selected entity, or null.

## Formatters

```typescript
import { formatObservation, formatVerificationResult } from '../lib';

// Format for AI reasoning
const markdown = formatObservation(obs);

// Format a pass/fail result
const summary = formatVerificationResult(result);
```

## Canvas Readback Notes

- The `captureCanvasFrame()` function uses a double `requestAnimationFrame` fence to wait for a complete render cycle before reading pixels.
- `isBlankFrame()` samples 64 evenly-spaced pixels. A frame is blank when all sampled pixels are zero/transparent.
- Retries 3 times (500ms gap) before giving up — useful for cold starts where the engine renders its first frame after a delay.

## Security

`__FORGE_DISPATCH` is only exposed when `NODE_ENV !== 'production'`. In production builds, the window global is undefined and `sendCommand()` returns `{ success: false, error: '__FORGE_DISPATCH not available' }`.

## Running Agent Tests

```bash
# With dev server already running:
cd web && npx playwright test --config playwright.agent.config.ts

# With SwiftShader (headless WebGL2):
# The agent config already includes --enable-webgl --use-angle=swiftshader

# View results:
open e2e/agent-results/report/index.html
```

## File Locations

| File | Purpose |
|------|---------|
| `web/e2e/lib/types.ts` | Type definitions |
| `web/e2e/lib/canvasReadback.ts` | captureCanvasFrame, isBlankFrame |
| `web/e2e/lib/viewportFormatter.ts` | formatObservation, formatVerificationResult |
| `web/e2e/lib/agentViewport.ts` | AgentViewport class |
| `web/e2e/lib/index.ts` | Barrel exports |
| `web/e2e/fixtures/editor.fixture.ts` | agentTest fixture |
| `web/playwright.agent.config.ts` | Agent Playwright config |
| `web/e2e/lib/__tests__/` | Unit tests |
| `web/e2e/tests/agent-*.spec.ts` | Integration + E2E agent tests |
