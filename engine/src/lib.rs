//! Forge Engine - WebAssembly game engine powered by Bevy.
//!
//! ## Architecture
//!
//! - `core/` - Pure Rust engine logic, platform-agnostic
//! - `bridge/` - JavaScript/WASM interop layer
//!
//! All JS interop MUST go through the bridge layer.

pub mod bridge;
pub mod core;

// Re-export bridge functions for wasm-bindgen
pub use bridge::*;
