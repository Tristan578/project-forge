---
description: Run the architecture validator to ensure bridge isolation and code quality rules
---

# Architecture Validator

Validates that the codebase follows the Sandwich Architecture:
- Only `engine/src/bridge/` imports `web_sys`/`js_sys`/`wasm_bindgen`
- `engine/src/core/` remains platform-agnostic

## Steps

1. Run the architecture validation script:
// turbo
```bash
python .claude/skills/arch-validator/check_arch.py
```

2. If violations found, fix them:
   - Move any `web_sys`/`js_sys` imports from `core/` to `bridge/`
   - Core modules must be pure Rust with no browser dependencies
   - Only bridge modules may use `#[wasm_bindgen]` attributes
