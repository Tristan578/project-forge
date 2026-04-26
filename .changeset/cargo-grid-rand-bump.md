---
"spawnforge": patch
---

Bump engine Rust transitives to clear Dependabot alerts:

- `grid` 1.0.0 → 1.0.1 (medium): integer overflow in `Grid::expand_rows()` could trigger UB via the safe `get()` API
- `rand` 0.8.5 → 0.8.6 (low): soundness issue with custom logger + `rand::rng()`
- `rand` 0.9.2 → 0.9.4 (low): same soundness backport on the 0.9 line

`cargo check --target wasm32-unknown-unknown --features webgl2` passes after the bump.
