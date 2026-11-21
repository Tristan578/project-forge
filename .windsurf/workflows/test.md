---
description: Run the full test suite (lint, TypeScript, unit tests, E2E, MCP)
---

# Full Test Suite

Run all verification checks that CI enforces.

## Steps

1. Run ESLint (zero warnings enforced):
// turbo
```bash
cd web && npx eslint --max-warnings 0
```

2. Run TypeScript type checking:
// turbo
```bash
cd web && npx tsc --noEmit
```

3. Run web unit tests:
// turbo
```bash
cd web && npx vitest run
```

4. Run MCP server tests:
// turbo
```bash
cd mcp-server && npx vitest run
```

5. Run E2E tests (requires WASM build in web/public/):
```bash
cd web && npx playwright test --grep @ui --project=chromium
```

6. Run architecture validator:
// turbo
```bash
python .claude/skills/arch-validator/check_arch.py
```

## Quick Validation (subset for fast feedback)

For a quick check after changes:
```bash
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run
```
