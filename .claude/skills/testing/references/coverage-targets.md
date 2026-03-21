# Coverage Targets & Architecture

## Current Thresholds (auto-ratchet in progress)

| Metric | Current | Target | Method |
|--------|---------|--------|--------|
| Statements | 55% | 90% | Auto-ratchet on merge |
| Branches | 45% | 90% | Auto-ratchet on merge |
| Functions | 50% | 90% | Auto-ratchet on merge |
| Lines | 55% | 90% | Auto-ratchet on merge |

90% coverage does not mean 90% bug-free. It means every line has been proven to execute without crashing.

## Test Architecture

```
web/src/**/__tests__/*.test.ts    # Unit + integration (vitest, 584 files, 12,300+ tests)
web/e2e/tests/*.spec.ts           # E2E browser tests (playwright, 81 tests)
mcp-server/src/*.test.ts          # MCP manifest tests (vitest)
engine/src/**/*.rs                # Rust unit tests (cargo test, 37 tests — growing)
```

## Vitest Configuration
- Config: @web/vitest.config.ts
- Default environment: `jsdom` (migrating to `node` for non-DOM tests)
- Pool: `forks` (migrating to `threads` for node-env tests)
- Coverage: `npx vitest run --coverage`
- Run specific: `npx vitest run myTestFile`
- Run changed only: `npx vitest run --changed`

## Playwright Configuration
- Config: @web/playwright.config.ts
- 4 CI shards, chromium only
- Page Object Model: @web/e2e/fixtures/editor.fixture.ts
- Requires WASM build + dev server
- Retries: 2 in CI, 0 local

## Test File Naming
- Source: `web/src/lib/myModule.ts`
- Test: `web/src/lib/__tests__/myModule.test.ts` or `web/src/lib/myModule.test.ts`
- E2E: `web/e2e/tests/myFeature.spec.ts`

## Running Tests

```bash
npx vitest run                          # All unit tests
npx vitest run --changed                # Only tests for changed files
npx vitest run src/path/to/test.ts      # Specific file
npx vitest run --coverage               # With coverage report
npx playwright test                     # All E2E (requires WASM)
npx playwright test --grep @ui          # UI-only E2E (no WASM needed)
cargo test --manifest-path engine/Cargo.toml  # Rust tests (native target)
```
