# Mock Patterns — SpawnForge

## The Golden Rule: Always Use `@/` Aliases in `vi.mock()`

**Wrong:**
```typescript
// In web/src/lib/tokens/__tests__/creditManager.test.ts
vi.mock('../../../stores/editorStore');         // relative from __tests__ dir — WRONG
vi.mock('../../lib/db/client');                 // relative path — WRONG
```

**Correct:**
```typescript
vi.mock('@/stores/editorStore');                // absolute alias — CORRECT
vi.mock('@/lib/db/client');                     // absolute alias — CORRECT
```

Vitest resolves `@/` to `web/src/` via `tsconfig.json` path aliases. Relative paths from `__tests__/` directories break because the module resolver uses the file's location.

---

## Hoisted Mock Pattern

For mocks that need to be available before imports execute (e.g., mocking a module used at import-time):

```typescript
import { vi, describe, it, expect } from 'vitest';

// vi.mock() is hoisted automatically by Vitest's transform
vi.mock('@/lib/auth/safe-auth', () => ({
  safeAuth: vi.fn(() => ({ userId: 'user_test_123' })),
}));

// This import happens AFTER the mock is registered (due to hoisting)
import { safeAuth } from '@/lib/auth/safe-auth';
```

---

## Store Slice Mocking

Use `createSliceStore()` from the slice test template for testing actions in isolation:

```typescript
import { createSliceStore, createMockDispatch } from '@/stores/slices/sliceTestTemplate';

// Test store state without dispatch
const store = createSliceStore();

// Test that actions dispatch the right commands
const { store, dispatch } = createMockDispatch();
store.getState().someAction('arg');
expect(dispatch).toHaveBeenCalledWith('command_name', { arg: 'arg' });
```

Do NOT mock the entire `editorStore` — use `createSliceStore()` which creates a real store with just the slice under test.

---

## Server-Only Module Mocking

API routes import server-only modules (Clerk, Stripe, Neon). These can't run in jsdom:

```typescript
vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

vi.mock('@/lib/auth/safe-auth', () => ({
  safeAuth: vi.fn(() => ({ userId: 'user_test_123' })),
}));
```

---

## Resetting Mocks for Side-Effect Modules

Script workers and other modules with global side effects need module reset:

```typescript
describe('scriptWorker', () => {
  beforeEach(async () => {
    vi.resetModules(); // Clear module registry
    vi.stubGlobal('self', { postMessage: vi.fn() });
    // Dynamic import AFTER resetModules and stub setup
    await import('@/lib/scripting/scriptWorker');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
```

---

## `dispatchCommand` Mock Pattern

For testing chat handlers and components that call `dispatchCommand`:

```typescript
const dispatchCommand = vi.fn();
const mockStore = {
  getState: () => ({
    selectedEntityId: 'entity-1',
    // ... other state your handler reads
  }),
} as never;

const result = await handlers['my_command'](
  { entityId: 'entity-1', value: 42 },
  { store: mockStore, dispatchCommand },
);

expect(dispatchCommand).toHaveBeenCalledWith('my_command', {
  entityId: 'entity-1',
  value: 42,
});
```

---

## Fetch Mock Pattern

For API route handlers and service functions that call `fetch`:

```typescript
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

mockFetch.mockResolvedValueOnce(new Response(
  JSON.stringify({ data: 'expected' }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
));
```

---

## Timer Mocks

For debounce, throttle, and timeout-dependent code:

```typescript
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('debounces rapid input', async () => {
  callDebounced();
  callDebounced();
  callDebounced();
  vi.advanceTimersByTime(300);
  await vi.runAllTimersAsync();
  expect(handler).toHaveBeenCalledTimes(1);
});
```

---

## Common Mock Mistakes

| Mistake | Fix |
|---------|-----|
| `vi.mock()` with relative path | Use `@/lib/...` alias |
| Forgetting `vi.clearAllMocks()` in `afterEach` | Add to `afterEach` or use `clearMocks: true` in vitest config |
| Mocking return value with `mockReturnValue` on an async function | Use `mockResolvedValue` for promises |
| Missing `await` on `vi.runAllTimersAsync()` | It returns a Promise |
| `vi.spyOn` on a read-only property | Use `vi.stubGlobal` or restructure the code |
