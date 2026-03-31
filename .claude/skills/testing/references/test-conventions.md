# Test Conventions — SpawnForge

## Vitest Workspace Structure

The project has two Vitest configurations. Use them correctly:

### Workspace (local dev only)
`web/vitest.workspace.ts` splits tests into two projects:
- `web/vitest.config.node.ts` — `environment: 'node'` for lib, stores, API routes
- `web/vitest.config.jsdom.ts` — `environment: 'jsdom'` for components, hooks

### Standalone (CI + coverage)
`web/vitest.config.ts` — standalone config with `environment: 'jsdom'`, used by CI.

**Important:** `--workspace` ignores per-project coverage thresholds. CI MUST use the standalone config:
```bash
cd web && npx vitest run --config vitest.config.ts --coverage
```

CI thresholds: statements 70, branches 60, functions 65, lines 72.

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
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSliceStore, createMockDispatch } from '@/stores/slices/sliceTestTemplate';

describe('materialSlice', () => {
  describe('state updates', () => {
    it('stores material data keyed by entityId', () => {
      const store = createSliceStore();
      const data = { color: [1, 0, 0, 1], metallic: 0.5 };

      store.getState().setMaterialData('entity-1', data);

      expect(store.getState().materialDataMap['entity-1']).toEqual(data);
    });

    it('overwrites existing data for same entity', () => {
      const store = createSliceStore();
      store.getState().setMaterialData('entity-1', { color: [1, 0, 0, 1] });
      store.getState().setMaterialData('entity-1', { color: [0, 1, 0, 1] });

      expect(store.getState().materialDataMap['entity-1'].color).toEqual([0, 1, 0, 1]);
    });
  });

  describe('command dispatch', () => {
    it('dispatches set_material with correct payload', () => {
      const { store, dispatch } = createMockDispatch();

      store.getState().applyMaterial('entity-1', { metallic: 0.8 });

      expect(dispatch).toHaveBeenCalledWith('set_material', {
        entityId: 'entity-1',
        metallic: 0.8,
      });
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
import { describe, it, expect, vi } from 'vitest';
import { handlers } from '@/lib/chat/handlers/materialHandlers';

describe('materialHandlers', () => {
  const mockDispatch = vi.fn();
  const mockContext = { store: {} as never, dispatchCommand: mockDispatch };

  beforeEach(() => { mockDispatch.mockClear(); });

  it('returns error when entityId is missing', async () => {
    const result = await handlers['set_material']({}, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/entityId/i);
  });

  it('dispatches set_material with metallic value', async () => {
    const result = await handlers['set_material'](
      { entityId: 'e1', metallic: 0.5 },
      mockContext,
    );
    expect(result.success).toBe(true);
    expect(mockDispatch).toHaveBeenCalledWith('set_material', {
      entityId: 'e1',
      metallic: 0.5,
    });
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

Current CI thresholds in `web/vitest.config.ts`:
- Statements: 70%
- Branches: 60%
- Functions: 65%
- Lines: 72%

Target: 100% across all metrics. Every uncovered branch is a bug waiting to happen in production WASM.
