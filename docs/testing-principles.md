# Testing Principles

> Canonical testing guide for SpawnForge. All contributors (human and AI) must follow these principles. CI enforces them via ESLint, TypeScript strict mode, and coverage thresholds.

## 1. Test Real Behavior, Not Implementation

Every test must assert a **meaningful outcome** — a state change, a rendered element, an API response, a dispatched command. If you can delete the implementation and the test still passes, the test is worthless.

```ts
// BAD — no-op assertion (string is always truthy)
expect('Search entities').toBeTruthy();

// BAD — only checks that something was called, not what it did
expect(handleCommand).toHaveBeenCalled();

// GOOD — asserts the actual command dispatched
expect(handleCommand).toHaveBeenCalledWith({
  type: 'set_material',
  entity_id: 'cube-1',
  material: { base_color: [1, 0, 0, 1] },
});
```

### Rules
- **No no-op assertions.** `expect(literal).toBeTruthy()` is banned. Every `expect` must reference a value produced by the code under test.
- **Prefer `.toHaveBeenCalledWith()` over `.toHaveBeenCalled()`.** Verify arguments, not just invocation.
- **Assert outcomes, not call counts** unless the count itself is the behavior (e.g., deduplication).

---

## 2. Mock at Boundaries, Not Internals

Mock **external dependencies** — network, WASM bridge, browser APIs, auth providers. Never mock the module you're testing.

### Boundary mocks (approved)
| Boundary | What to mock |
|----------|-------------|
| Network | `global.fetch`, `NextResponse` |
| WASM bridge | `handle_command()`, `wasmModule` |
| Auth | `@clerk/nextjs` — `auth()`, `currentUser()` |
| Browser APIs | `localStorage`, `navigator.gpu`, `crypto.subtle`, `HTMLCanvasElement` |
| Time | `vi.useFakeTimers()` for debounce/polling, never raw `setTimeout` in tests |
| Database | `@/lib/db` — mock the Drizzle query builder |

### Forbidden mocks
- Do not mock Zustand stores when testing store logic. Test the real store.
- Do not mock the function you're testing to make it "pass."
- Do not mock child components in integration tests — render the real tree.

### Type-safe mocks
```ts
// BAD — loses type safety, hides breaking changes
vi.mocked(useEditorStore.getState).mockReturnValue(actions as any);

// GOOD — compiler catches if the store shape changes
vi.mocked(useEditorStore.getState).mockReturnValue(
  actions as unknown as ReturnType<typeof useEditorStore.getState>
);
```

**Rule:** `as any` is banned in test files. Use `as unknown as T` with the actual return type.

---

## 3. No Flaky Async

Tests must be deterministic. No sleeping, no race conditions, no timing-dependent assertions.

```ts
// BAD — arbitrary sleep, will flake in CI
await new Promise((r) => setTimeout(r, 50));
expect(store.status).toBe('complete');

// GOOD — wait for the specific condition
await vi.waitFor(() => {
  expect(store.getState().status).toBe('complete');
});

// GOOD — advance fake timers explicitly
vi.useFakeTimers();
store.startPolling();
await vi.advanceTimersByTimeAsync(5000);
expect(store.getState().status).toBe('complete');
vi.useRealTimers();
```

### Rules
- **No `setTimeout`/`sleep` in tests** except via `vi.useFakeTimers()`.
- **Use `vi.waitFor()`** for async state that settles within an event loop tick.
- **Use `vi.advanceTimersByTimeAsync()`** for code that uses `setTimeout`/`setInterval` internally.
- **Set explicit timeouts** on async tests via vitest config (`testTimeout: 10000`), not per-test overrides.

---

## 4. No Skipped Tests

Skipped tests are dead code. They rot, they mislead, and they hide regressions.

### Rules
- **`it.skip` / `test.skip` / `describe.skip` must not be committed** to `main`. If a test can't pass, fix it or delete it.
- **Temporary skips during development** are acceptable on feature branches only.
- **If a test is blocked by missing infrastructure**, create a GitHub issue and delete the test. Don't leave a skip.

---

## 5. No Snapshot Tests

Snapshots are brittle, hard to review, and encourage "update snapshot" over "understand the failure."

### Rules
- **`toMatchSnapshot()` and `toMatchInlineSnapshot()` are banned.**
- **Assert specific properties** of rendered output or data structures instead.
- For component tests, use `getByRole`, `getByText`, `getByTestId` to assert the presence and content of elements.

---

## 6. Test File Organization

### Naming
- Unit tests: `<module>.test.ts` or `__tests__/<module>.test.ts` — colocated with source.
- Component tests: `__tests__/<Component>.test.tsx` — colocated in the component directory.
- Integration tests: `__tests__/<feature>.integration.test.ts` — test multiple modules together.
- E2E tests: `e2e/tests/<feature>.spec.ts` — Playwright, in the `web/e2e/` directory.

### Structure
```ts
describe('ModuleName', () => {
  // Setup shared across all tests in this describe
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('methodName', () => {
    it('should [expected behavior] when [condition]', () => {
      // Arrange
      // Act
      // Assert
    });

    it('should throw when [error condition]', () => {
      // ...
    });
  });
});
```

### Rules
- **One logical unit per test file.** Don't test `chatStore` and `editorStore` in the same file.
- **Descriptive test names.** Use `should [verb] when [condition]` format.
- **Arrange-Act-Assert** pattern in every test. No interleaving.
- **`beforeEach` for cleanup**, not `afterEach`. Clear mocks at the start of each test.

---

## 7. Component Testing

Use `@testing-library/react` with the project's `componentTestUtils.tsx` wrapper.

### Rules
- **Query by role first** (`getByRole`), then by text (`getByText`), then by test ID (`getByTestId`) as a last resort.
- **Simulate real user interactions** — `userEvent.click()`, `userEvent.type()`, not `fireEvent`.
- **Assert store mutations** via `useEditorStore.getState()` after interactions, not DOM internals.
- **Mock the engine bridge**, not the store. Test the full UI → store → command path.

```ts
// GOOD — tests the real interaction path
it('should dispatch set_position command when X input changes', async () => {
  const user = userEvent.setup();
  render(<Vec3Input entityId="cube-1" />, { wrapper: TestProviders });

  const xInput = screen.getByRole('spinbutton', { name: /x/i });
  await user.clear(xInput);
  await user.type(xInput, '5.0');

  expect(mockHandleCommand).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'set_position', x: 5.0 })
  );
});
```

---

## 8. API Route Testing

Use `mockNextResponse` from `@/test/utils/apiTestUtils` and test route handlers as functions.

### Rules
- **Mock auth at the boundary** — `authenticateRequest` returns a user or a 401 response.
- **Mock database queries** — cast with `as unknown as ReturnType<typeof getDb>`, never `as any`.
- **Test all response codes** — happy path, auth failure, validation error, internal error.
- **Verify response body shape** — parse `res.json()` and assert specific fields.

---

## 9. E2E Testing (Playwright)

E2E tests validate the full application from the browser.

### Rules
- **Tag UI-only tests with `@ui`** — these run in CI without a WASM build.
- **Tag engine tests with `@engine`** — these require WASM binaries.
- **Use page objects or fixtures** for shared setup (editor page, dashboard page).
- **Assert visible outcomes** — text on screen, navigation, element visibility. Not network requests.
- **Keep E2E tests focused** — one user flow per test. Don't chain unrelated actions.

---

## 10. Coverage

Coverage thresholds are enforced in `vitest.config.ts` and ratcheted up per sprint (see `docs/coverage-plan.md`).

### Rules
- **No PR may lower coverage** below the current thresholds.
- **Target per-file minimum: 50% statements** for any file over 50 statements. Below that is a red flag in code review.
- **Exclude generated code** from coverage (already configured in vitest.config.ts).
- **Coverage is a floor, not a ceiling.** 55% is the minimum, not the goal. Aim for 80%+ on core logic.

---

## Quick Reference: Banned Patterns

| Pattern | Replacement |
|---------|------------|
| `as any` in tests | `as unknown as T` with the real type |
| `expect(literal).toBeTruthy()` | Remove or replace with a real assertion |
| `.toHaveBeenCalled()` without args | `.toHaveBeenCalledWith(...)` |
| `await new Promise(r => setTimeout(r, N))` | `vi.waitFor()` or `vi.useFakeTimers()` |
| `toMatchSnapshot()` | Specific property assertions |
| `it.skip` / `test.skip` on main | Fix the test, delete it, or file an issue |
| `eslint-disable` in test files | Fix the lint error properly |

---

## Test Infrastructure

| Utility | Location | Purpose |
|---------|----------|---------|
| `mockNextResponse` | `src/test/utils/apiTestUtils.ts` | Type-safe NextResponse for API route tests |
| `makeUser` | `src/test/utils/apiTestUtils.ts` | Create mock authenticated user |
| `TestProviders` | `src/test/utils/componentTestUtils.tsx` | React wrapper with Zustand + providers |
| `makeEntity` | `src/test/utils/fixtures.ts` | Create test entities with defaults |

### Planned additions (see coverage-plan.md)
- **Engine command spy** — mock `handle_command()` that records commands
- **Store factory** — pre-populated Zustand for component tests
- **Streaming response mock** — for chat API SSE tests
- **Canvas mock** — for PixelArtEditor/shader tests in jsdom
