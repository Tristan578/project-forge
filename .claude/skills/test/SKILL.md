---
name: test
description: Run the full test suite (lint, TypeScript, unit tests, E2E, MCP)
user-invocable: true
allowed-tools: Bash, Read, Glob, Grep
argument-hint: "[suite: all|lint|tsc|vitest|playwright|mcp|quick]"
---

# Test Suite Runner

Run tests for the SpawnForge project. All commands run from the project root.

## Available Suites

| Suite | Command | What it checks |
|-------|---------|---------------|
| `lint` | `cd web && npx eslint --max-warnings 0 .` | ESLint code quality |
| `tsc` | `cd web && npx tsc --noEmit` | TypeScript type safety |
| `vitest` | `cd web && npx vitest run` | Unit + integration tests (2211+) |
| `playwright` | `cd web && npx playwright test` | E2E browser tests (163+, requires WASM build) |
| `mcp` | `cd mcp-server && npx vitest run` | MCP server manifest + docs tests |
| `quick` | lint + tsc + vitest (no E2E) | Fast pre-commit check |
| `all` | All suites in sequence | Full validation |

## How to Run

### Default (when $ARGUMENTS is empty): run "quick" suite

```bash
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run
```

### Specific suite

Run the suite matching $ARGUMENTS from the table above.

### Full suite ("all")

```bash
# 1. Lint
cd web && npx eslint --max-warnings 0 .

# 2. TypeScript
cd web && npx tsc --noEmit

# 3. Unit tests
cd web && npx vitest run

# 4. MCP tests
cd mcp-server && npx vitest run

# 5. E2E (requires WASM build + dev server)
cd web && npx playwright test
```

## E2E Test Prerequisites

Playwright E2E tests require:
1. **WASM engine built** — Run `/build` first. Check `web/public/engine-pkg-webgl2/` exists.
2. **Playwright browsers installed** — `npx playwright install chromium`
3. Dev server starts automatically via Playwright's `webServer` config.

## Coverage Report

To run vitest with coverage:

```bash
cd web && npx vitest run --coverage
```

Coverage report outputs to `web/coverage/`.

## Interpreting Failures

- **Lint failures**: Fix the code or add an eslint-disable comment with justification
- **TypeScript errors**: Fix type issues. Never use `any` without `@ts-expect-error` justification
- **Vitest failures**: Read the assertion diff. Check if the test or the implementation is wrong
- **Playwright failures**: Check screenshots in `web/test-results/`. Likely a selector or timing issue
- **MCP failures**: Usually a manifest mismatch — check `mcp-server/manifest/commands.json`

## Test File Conventions

- Unit tests: `src/**/__tests__/*.test.ts` or `src/**/*.test.ts`
- E2E tests: `web/e2e/tests/*.spec.ts`
- Test helpers: `src/stores/slices/__tests__/sliceTestTemplate.ts`
- Vitest config: `web/vitest.config.ts`
- Playwright config: `web/playwright.config.ts`
