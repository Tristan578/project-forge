# Installation & Setup

Get Project Forge running on your machine.

## Prerequisites

- **Node.js** 18+ — [nodejs.org](https://nodejs.org)
- **Rust** (latest stable) — [rustup.rs](https://rustup.rs)
- **wasm-pack** — Install with `cargo install wasm-pack`
- **wasm32-unknown-unknown target** — `rustup target add wasm32-unknown-unknown`

## Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/project-forge.git
   cd project-forge
   ```

2. **Build the WASM engine** (produces both WebGPU and WebGL2 binaries)
   ```powershell
   powershell -File ./build_wasm.ps1
   ```

3. **Install web dependencies**
   ```bash
   cd web
   npm install
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Open the editor** at `http://localhost:3000/dev`

## Browser Requirements

Project Forge uses **WebGPU** for rendering when available, with automatic fallback to **WebGL2**.

| Browser | WebGPU | WebGL2 |
|---------|--------|--------|
| Chrome 113+ | Yes | Yes |
| Edge 113+ | Yes | Yes |
| Firefox | Flag only | Yes |
| Safari 18+ | Yes | Yes |

WebGPU delivers better performance and enables GPU particle effects. WebGL2 works everywhere but disables GPU particles.

## Cloud Version

The hosted version at your deployment URL handles all setup automatically — just sign in and start creating.

## Troubleshooting

- **Pink/magenta materials**: This indicates the WASM build is missing the `tonemapping_luts` feature. Rebuild with `build_wasm.ps1`.
- **Build fails on Windows**: Ensure the Windows SDK is installed (needed for native proc-macro compilation during WASM build).
- **Slow first load**: The WASM binary is ~53MB. First load takes a moment; subsequent loads use browser cache.
- **"RangeError: Invalid string length"**: If you see this in the dev server, ensure the dev script uses `--webpack` mode (not Turbopack).
