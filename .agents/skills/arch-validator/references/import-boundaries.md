# Import Boundaries

This file defines exactly what each module is allowed to import. Violations are architecture bugs.

---

## Engine Layers

### `engine/src/core/` — Pure Rust

**May import:**
- Other files within `engine/src/core/` via `crate::core::*` or `super::*`
- Standard library: `std::*`
- Pure Rust crates: `bevy::*` (ECS, math, assets), `serde`, `serde_json`, `bevy_rapier3d`, `bevy_rapier2d`, `bevy_panorbit_camera`, `csgrs`, `noise`, `bevy_hanabi` (data types only — rendering gated by `#[cfg(feature = "webgpu")]`)

**Must NOT import:**
```rust
use web_sys;           // browser API
use js_sys;            // browser JS bindings
use wasm_bindgen;      // WASM bridge
use crate::bridge;     // reverse dependency into bridge
```

**Rationale:** `core/` must compile on any Rust target (native tests, CI, non-WASM builds). Browser APIs are not available outside WASM.

---

### `engine/src/bridge/` — JS Interop Layer

**May import:**
- Everything in `engine/src/core/` via `crate::core::*`
- Browser crates: `web_sys`, `js_sys`, `wasm_bindgen`
- `serde_wasm_bindgen` for JS ↔ Rust serialization

**Must NOT import:**
- There is no restriction on what bridge/ imports from core/. The data flows core/ → bridge/ only.

**Key pattern:**
```rust
// bridge/mod.rs — the only file with #[wasm_bindgen]
#[wasm_bindgen]
pub fn handle_command(json: &str) -> JsValue {
    // delegates to core::commands::dispatch()
}
```

---

### `engine/src/shaders/` — WGSL Files

WGSL shader files. No Rust imports. Referenced via `AssetServer` or embedded with `include_str!()`.

---

## Web Application Layers

### `web/src/` — Next.js Application

**May import:**
- Any file within `web/src/`
- `@spawnforge/ui` — the only allowed external package (via `transpilePackages` in `next.config.ts`)
- npm packages listed in `web/package.json`

**Must NOT import:**
```ts
import { ... } from '../../mcp-server/...';   // outside web/
import { ... } from '../engine/...';           // engine is WASM, not TS
import { ... } from '../packages/ui/src/...';  // use @spawnforge/ui alias
```

**Rationale:** Next.js production builds cannot resolve paths outside `web/`. The `transpilePackages` workaround only works for `@spawnforge/ui`.

### `web/src/data/commands.json` — Must Stay Synced

This file is a **copy** of `mcp-server/manifest/commands.json`. They must always be identical. Any PR touching one must also update the other.

Check sync status:
```bash
node apps/docs/scripts/check-manifest-sync.ts
```

---

### `mcp-server/` — MCP Protocol Server

**May import:**
- Files within `mcp-server/`
- npm packages listed in `mcp-server/package.json`

**Must NOT import:**
- `web/src/` — mcp-server is a standalone Node.js process

---

### `packages/ui/` — Design System Package

Published as `@spawnforge/ui`. The only cross-package import allowed in `web/`.

**Internal imports within `packages/ui/src/`:**
- `primitives/` may not import `composites/`
- `tokens/` may not import `primitives/` or `composites/`
- `effects/` may import `tokens/` and `hooks/`
- `composites/` may import all of the above

---

## Dependency Direction Summary

```
web/src/
  └── @spawnforge/ui (read-only, via transpilePackages)
  └── wasm (engine binary, loaded at runtime — no TS imports)

engine/src/core/
  └── [pure Rust deps only]

engine/src/bridge/
  └── engine/src/core/  (one-way: bridge depends on core, never reverse)
  └── web_sys / js_sys / wasm_bindgen

mcp-server/
  └── [standalone, no web/ imports]
```

---

## Enforcement

Architecture boundaries are checked by:
1. `python3 .claude/skills/arch-validator/check_arch.py` — Python checker (fast, no Rust toolchain needed)
2. `bash .claude/skills/arch-validator/scripts/boundary-check.sh` — Shell checker for bridge isolation
3. `bash .claude/tools/validate-rust.sh check` — Full Rust validation (includes `cargo check --target wasm32-unknown-unknown`)

Run all three before declaring engine work complete.
