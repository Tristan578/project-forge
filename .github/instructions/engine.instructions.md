---
applyTo: "engine/**"
---

# Rust Engine Instructions

This is a Bevy 0.16 game engine compiled to WebAssembly. All code must be `wasm32-unknown-unknown` compatible.

## Hard Rules

- Never use `std::fs`, `std::net`, `std::thread`, or any API unavailable in WASM.
- Never add `web-sys` or `wasm-bindgen` imports in `src/core/`. Only `src/bridge/` touches JS interop.
- Every `unsafe` block must have a `// SAFETY:` comment explaining why it is sound.
- Use `serde` + `serde_wasm_bindgen` for all data crossing the WASM boundary. No manual JSON.
- Prefer `Result<T, E>` and `anyhow::Result` over `.unwrap()` or `.expect()` in bridge code.

## Bevy Patterns

- Systems use `Query<>`, `ResMut<>`, `EventReader<>`, `EventWriter<>` as parameters.
- Keep systems small and focused. If a system has more than 3 query parameters, split it.
- Use `Changed<T>` and `Added<T>` filters to avoid processing unchanged entities.
- Register components and resources in the plugin's `build()` method, not in systems.
- Assets: use `AssetServer::load()` and poll `Assets<T>` for readiness. Never block.

## Build Targets

- WebGL2: `cargo build --target wasm32-unknown-unknown --release --features webgl2`
- WebGPU: `cargo build --target wasm32-unknown-unknown --release --features webgpu`
- Both produce a `.wasm` file that gets processed by `wasm-bindgen --target web`.
- Binary size matters. The current binary is ~53MB. CI fails at 60MB. Consider feature-gating heavy crates.

## Testing

- This crate currently has zero tests. Adding tests is a high priority.
- Place tests in `#[cfg(test)] mod tests { }` at the bottom of each module.
- Create a minimal Bevy `App` for system tests:
  ```rust
  #[test]
  fn test_my_system() {
      let mut app = App::new();
      app.add_plugins(MinimalPlugins);
      app.add_systems(Update, my_system);
      app.world.spawn(MyComponent { value: 42 });
      app.update();
      // assert state
  }
  ```
- Test serialization round-trips for all bridge data types.
- Do not test rendering (no GPU in test environment). Test logic and state transitions only.

## Module Layout

- `src/core/` — Pure game logic. Physics, rendering config, animation state, particles. No JS interop.
- `src/bridge/` — WASM ↔ JS boundary. Command handlers, event callbacks, state serialization.
- `src/lib.rs` — Plugin registration and app builder.
