---
"web": patch
---

Bump the `wasm-bindgen` pin from `=0.2.108` to `=0.2.127` (PF-DEP / #9380).

The crate version and the installed `wasm-bindgen-cli` must match exactly — a
mismatch fails with opaque "missing export" errors that read like engine bugs —
so this is a coordinated change across `engine/Cargo.toml`, `engine/Cargo.lock`,
every workflow that runs `cargo install wasm-bindgen-cli`, and every agent
instruction, skill, and gate script that names the pin. The exact-pin `=` form
is kept deliberately; a caret range reintroduces the CLI-mismatch class.

`cargo update -p wasm-bindgen` carried `js-sys` 0.3.85 → 0.3.104,
`wasm-bindgen-futures` 0.4.58 → 0.4.77, and `web-sys` 0.3.85 → 0.3.104 with it.

Bevy 0.19.1's own floor is only `wasm-bindgen ^0.2`, so 0.2.127 satisfies the
pending Bevy 0.19 upgrade and does not need a second bump when that lands.

All four WASM variants (editor + runtime × WebGL2/WebGPU) build clean on the new
toolchain. Historical records (`PR.md`, `docs/audits/`) keep the old version.
