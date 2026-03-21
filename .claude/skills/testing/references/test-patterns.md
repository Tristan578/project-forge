# Test Patterns

## Store Slice Tests (most common)

```typescript
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';

describe('mySlice', () => {
  it('updates data on set action', () => {
    const store = createSliceStore();
    store.getState().setMyData('entity-1', { value: 42 });
    expect(store.getState().myDataMap['entity-1']).toEqual({ value: 42 });
  });

  it('dispatches command correctly', () => {
    const { store, dispatch } = createMockDispatch();
    store.getState().someAction('entity-1', { value: 42 });
    expect(dispatch).toHaveBeenCalledWith('my_command', {
      entityId: 'entity-1',
      value: 42,
    });
  });
});
```

## Event Handler Tests

```typescript
describe('myDomainEvents', () => {
  it('handles MY_EVENT by updating store', () => {
    const store = createSliceStore();
    const handler = createEventHandler(store);
    handler({
      type: 'MY_EVENT',
      payload: { entityId: 'e1', data: { ... } },
    });
    expect(store.getState().myDataMap['e1']).toEqual({ ... });
  });
});
```

## Chat Handler Tests

```typescript
describe('myHandler', () => {
  it('validates required args', async () => {
    const result = await handlers['my_command']({}, { store, dispatchCommand: vi.fn() });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing');
  });

  it('dispatches with correct params', async () => {
    const dispatchCommand = vi.fn();
    const result = await handlers['my_command'](
      { entityId: 'e1', value: 42 },
      { store, dispatchCommand },
    );
    expect(result.success).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledWith('my_command', {
      entityId: 'e1', value: 42,
    });
  });
});
```

## E2E Tests (Playwright)

```typescript
const editor = new EditorPage(page);
await editor.waitForReady(); // Waits for WASM engine
await editor.createEntity('Cube');
await editor.selectEntity('Cube');
await expect(editor.inspector).toBeVisible();
```

- Wait for WASM readiness — don't race the engine
- Use stable selectors: `data-testid` or `[role="dialog"][aria-labelledby="..."]`, not CSS classes
- Screenshots on failure (configured in playwright.config.ts)
- Each test starts with fresh scene state

## Mock Rules

- **Always use `@/lib/...` alias in `vi.mock()`** — never relative paths from __tests__ dirs
- **Use `vi.resetModules()` + dynamic import** for script worker tests
- **Stub `self` with mock `postMessage`** for worker tests
- **Use `mockImplementation(() => value)` not `mockReturnValue(value)`** for generators/streams/stateful objects
- **After `vi.clearAllMocks()`, re-mock every function** that callers chain `.then()/.catch()` on
- **Always `await res.text()`** on streaming responses in tests to drain the stream
- **Read the FULL production call chain** before writing mocks — mock every chained method

## What to Test (Priority Order)

**P0 — Must have:** Every store action, event handler, chat handler, export step, API route
**P1 — Should have:** Null/undefined IDs, empty arrays, max values, concurrent ops, mode transitions
**P2 — Integration:** Command→event→store cycle, batch ops, undo/redo, save/load roundtrip
**P3 — Regression:** Every bug fix gets a test that would have caught it
