# Test Conventions — SpawnForge

## Production Vitest configuration

`web/vitest.config.ts` runs both environment projects and enforces aggregate
coverage thresholds across their combined results:

- `web/vitest.config.node.ts` selects server and unit tests in Node.
- `web/vitest.config.jsdom.ts` selects browser-dependent tests in jsdom.
- `web/vitest.test-selection.ts` defines the complementary partition, including
  browser-dependent storage and scene tests. Existing per-file environment
  annotations continue to apply.

CI and coverage runs must use the root configuration:

```bash
cd web && npx vitest run --config vitest.config.ts --coverage
```

The environment selectors do not define independent coverage thresholds.
The ratchet reads and updates only the aggregate thresholds in
`web/vitest.config.ts`. Read that file for their current values. The legacy
`web/vitest.workspace.ts` references the same environment selectors for local
use; it is not the production coverage gate.

## File Naming Conventions

Source file → test file mapping:
```
web/src/lib/tokens/creditManager.ts
  → web/src/lib/tokens/__tests__/creditManager.test.ts

web/src/stores/slices/materialSlice.ts
  → web/src/stores/slices/__tests__/materialSlice.test.ts

web/src/components/editor/MaterialInspector.tsx
  → web/src/components/editor/__tests__/MaterialInspector.test.tsx

web/src/hooks/events/materialEvents.ts
  → web/src/hooks/events/__tests__/materialEvents.test.ts
```

Test files always live in `__tests__/` sibling to the source file.

## Store Slice Test Template

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createSliceStore, createMockDispatch } from '@/stores/slices/__tests__/sliceTestTemplate';
import { createMaterialSlice, setMaterialDispatcher, type MaterialSlice } from '@/stores/slices/materialSlice';
import type { MaterialData } from '@/stores/slices/types';

let store: ReturnType<typeof createSliceStore<MaterialSlice>>;
let dispatch: ReturnType<typeof createMockDispatch>;

beforeEach(() => {
  store = createSliceStore(createMaterialSlice);
  dispatch = createMockDispatch();
  setMaterialDispatcher(dispatch);
});

describe('materialSlice', () => {
  it('stores the primary material', () => {
    const material = { metallic: 0.5 } as MaterialData;
    store.getState().setPrimaryMaterial(material);
    expect(store.getState().primaryMaterial).toEqual(material);
  });

  it('dispatches update_material with the entity id and fields', () => {
    store.getState().updateMaterial('entity-1', { metallic: 0.8 } as MaterialData);
    expect(dispatch).toHaveBeenCalledWith('update_material', {
      entityId: 'entity-1',
      metallic: 0.8,
    });
  });
});
```

## Script Worker Test Pattern

Script workers use `self.postMessage` and cannot be tested with standard imports. Use module isolation:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('scriptWorker', () => {
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    postMessage = vi.fn();
    // Stub the worker global before importing
    vi.stubGlobal('self', { postMessage });
    vi.resetModules();
    await import('@/lib/scripting/scriptWorker');
  });

  it('posts error message on invalid script', () => {
    self.dispatchEvent(new MessageEvent('message', {
      data: { type: 'EXECUTE', script: 'throw new Error("test")' },
    }));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ERROR' })
    );
  });
});
```

## Chat Handler Test Pattern

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { materialHandlers } from '@/lib/chat/handlers/materialHandlers';

describe('materialHandlers', () => {
  // update_material writes through the store action, which dispatches to the engine
  const updateMaterial = vi.fn();
  const mockContext = {
    store: { primaryMaterial: null, updateMaterial } as never,
    dispatchCommand: vi.fn(),
  };

  beforeEach(() => { updateMaterial.mockClear(); });

  it('returns error when entityId is missing', async () => {
    const result = await materialHandlers['update_material']({}, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/entityId/i);
  });

  it('applies the metallic value to the entity', async () => {
    const result = await materialHandlers['update_material'](
      { entityId: 'e1', metallic: 0.5 },
      mockContext,
    );
    expect(result.success).toBe(true);
    expect(updateMaterial).toHaveBeenCalledWith('e1', expect.objectContaining({ metallic: 0.5 }));
  });
});
```

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| `expect(result).toBeTruthy()` | Passes on any truthy, hides actual value | `expect(result).toEqual(expectedValue)` |
| `as any` in test types | Hides type errors that tests exist to catch | Use proper types or `satisfies` |
| `it.skip` without a ticket | Technical debt with no tracking | Add `// TODO: PF-XXX` or delete |
| Snapshot tests for logic | Auto-updated, become documentation not assertion | Explicit property checks |
| Testing third-party lib behavior | Not our code | Test our integration + error handling |
| `vi.mock()` with relative path from `__tests__/` | Module not found at runtime | Use `@/lib/...` alias always |
| Giant test files (500+ lines) | Hard to maintain | Split by behavior group |

## Naming Convention for Regression Tests

```typescript
it('returns zero when tokenCount is undefined (regression #PF-730)', () => {
  expect(computeCost(undefined, 0.01)).toBe(0);
});
```

Link to the PF ticket in the test name so future readers understand why this test exists.

## Coverage Thresholds

CI thresholds live in `web/vitest.config.ts` and are auto-ratcheted upward from aggregate project coverage.

Target: 100% across all metrics. Every uncovered branch is a bug waiting to happen in production WASM.
