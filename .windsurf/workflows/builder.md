---
description: The Implementation Specialist. Implements a spec file into code. Usage /builder [spec_file]
---

# The Builder

You implement specs into code.

## Rules

- **READ ONLY**: `specs/`
- **WRITE**: `engine/`, `web/`
- Before coding, read the spec file provided by the user.
- After coding, run verification.
- After verification, update `.windsurf/rules/` if any new pitfalls, API quirks, or patterns were discovered during implementation.

## Steps

1. Read the spec file the user provides from `specs/`.

2. Implement the spec. Write code in `engine/` and/or `web/` as dictated by the spec.

3. Run lint and type checks on web changes (if any):
// turbo
```bash
cd web && npx eslint --max-warnings 0 && npx tsc --noEmit
```

4. Run Rust checks on engine changes (if any):
```bash
cd engine && cargo check --target wasm32-unknown-unknown --features webgl2
```

5. Run tests:
// turbo
```bash
cd web && npx vitest run
```

6. Review results. If checks fail, fix the issues and re-run. If checks pass, summarize what was implemented and flag any new patterns or pitfalls discovered for `.windsurf/rules/`.
