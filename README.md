# Project Forge

An open-source, AI-native 3D game engine for the browser. Every capability — scene creation, materials, physics, scripting, audio, particles, export — is exposed as a JSON command, making the entire editor fully controllable by LLMs and autonomous agents via the [Model Context Protocol](https://modelcontextprotocol.io/). Build games by conversation, by code, or by hand.

Powered by WebGPU (with WebGL2 fallback), Rust compiled to WebAssembly, and a React-based visual editor.

## Features

### AI & Automation
- **AI Chat Assistant** — Built-in Claude-powered chat panel with agentic tool loop. Describe what you want ("build a platformer level") and the AI spawns entities, configures materials, writes scripts, and iterates across multiple turns until the scene is complete
- **Extended Thinking** — Toggle deep reasoning mode for complex multi-step requests like full game setup
- **MCP Server** — 139 commands across 20 categories. Any MCP-compatible agent or LLM can create scenes, configure materials, set up physics, write game scripts, and export finished games — no UI interaction required
- **Command-Driven Architecture** — Every engine operation is a JSON command through `handle_command()`. The visual editor and AI agents use the exact same API
- **Scene Context** — Built-in context builder provides LLMs with full scene state for informed decision-making
- **Documentation System** — 28 structured docs searchable via MCP tools (`search_docs`, `get_doc`, `list_doc_topics`), enabling AI agents to learn features and procedures on demand

### Engine
- **Skybox & Environment Maps** — 5 built-in procedural cubemap presets (Studio, Sunset, Overcast, Night, Bright Day) with adjustable brightness, IBL intensity, and rotation
- **Collision Events & Raycasting** — Real-time physics collision callbacks for scripts and raycasting API for spatial queries
- **WebGPU Rendering** — Primary rendering via WebGPU (wgpu 24) with automatic WebGL2 fallback for older browsers
- **PBR Materials** — Physically-based rendering with metallic/roughness workflow, UV transforms, clearcoat, transmission/IOR, parallax mapping, texture support, alpha modes, and 56 material presets across 9 categories
- **Quality Presets** — Low/Medium/High/Ultra rendering presets that batch-configure MSAA, shadows, bloom, sharpening, and particle density
- **Dynamic Lighting** — Point, directional, and spot lights with real-time shadows and ambient light controls
- **Physics** — Rigid body dynamics, colliders, forces, and constraints powered by Rapier
- **Audio** — Spatial 3D audio, bus mixer with effect chains (reverb, delay, EQ, compressor), crossfade transitions, ducking, one-shot sounds, audio layers, and per-entity controls
- **GPU Particles** — 9 built-in presets (fire, smoke, sparks, rain, snow, explosions, and more) with full customization via WebGPU compute shaders
- **Skeletal Animation** — glTF animation playback with transport controls, crossfade transitions, blend weights, per-clip speed, and script API
- **CSG Boolean Operations** — Union, subtract, and intersect on mesh entities using BSP-based constructive solid geometry
- **Procedural Terrain** — Heightmap terrain generation with Perlin/Simplex/Value noise, sculpting tools, and height-based vertex coloring
- **Procedural Mesh Generation** — Extrude 2D shapes, lathe profiles, array entities in grid/circle patterns, and combine meshes
- **Custom Shader Effects** — 6 built-in visual effects (Dissolve, Hologram, Force Field, Lava/Flow, Toon, Fresnel Glow) extending the PBR pipeline via MaterialExtension
- **Post-Processing** — Bloom, chromatic aberration, color grading, and contrast-adaptive sharpening

### Editor
- **3D Scene Editor** — Transform gizmos, multi-select, snapping, scene hierarchy, and inspector panels
- **Responsive Layout** — Adaptive UI with compact mode (mobile/tablet), condensed mode (laptop), and full desktop layout with slide-over drawer panels
- **Onboarding** — Welcome modal for first-time users and keyboard shortcuts reference panel (press ?)
- **TypeScript Scripting** — Sandboxed scripting API (`forge.*`), starter templates, and a built-in editor with console output
- **Material Library** — Browse 56 built-in material presets with CSS sphere previews, category filters, search, and custom material saving
- **Asset Pipeline** — Import glTF models (with animations), textures, and audio files via drag-and-drop
- **Play Mode** — Test your game instantly with play/pause/stop and scene snapshot restore
- **Input System** — Configurable key bindings with 4 presets (FPS, Platformer, Top-Down, Racing)
- **Save/Load** — JSON scene format, local storage auto-save, and cloud project storage
- **Prefab System** — Save entity configurations as reusable templates with 8 built-in prefabs, import/export, and search
- **Multi-Scene Management** — Multiple named scenes per project with scene switching, duplication, and import/export
- **Game Export** — Export standalone HTML games that run anywhere

## Architecture

```
MCP Server (139 commands)                      AI agents + LLM tool use
    ↕  JSON commands
React Shell (Next.js, Zustand, Tailwind)      Visual editor UI
    ↕  JSON events via wasm-bindgen
Bevy Engine (Rust → WebAssembly)              Scene editing + WebGPU rendering
    ↕
Game Runtime + TypeScript Scripting           In-browser game execution
```

The MCP server and the visual editor share the same command interface — there is no separate "AI mode." An agent calling `set_material` goes through the exact same code path as a user dragging a color picker.

**Rendering:** WebGPU primary (auto-detected), WebGL2 fallback. Two WASM binaries are built per release — the frontend auto-selects the correct one at runtime.

## Prerequisites

- [Rust](https://rustup.rs/) (stable) with the `wasm32-unknown-unknown` target
- [wasm-bindgen-cli](https://rustwasm.github.io/wasm-bindgen/reference/cli.html)
- [Node.js](https://nodejs.org/) 18+
- PowerShell (Windows) or compatible shell for build scripts

### Install the WASM target

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli
```

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Tristan578/project-forge.git
cd project-forge
```

### 2. Build the WASM engine

```powershell
# Windows (PowerShell)
.\build_wasm.ps1

# This compiles both WebGL2 and WebGPU WASM binaries
# and copies them to web/public/
```

### 3. Install web dependencies

```bash
cd web
npm install
```

### 4. Set up environment variables

```bash
cp .env.example .env
# Edit .env with your API keys (Clerk, Stripe, database, etc.)
```

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a WebGPU-capable browser (Chrome 113+, Edge 113+, or Firefox Nightly).

### 6. Install MCP server dependencies (optional)

```bash
cd ../mcp-server
npm install
```

## Project Structure

```
project-forge/
├── engine/                  # Bevy ECS engine (Rust → WASM)
│   ├── src/
│   │   ├── bridge/          # JS interop (wasm-bindgen, events)
│   │   └── core/            # Pure Rust: commands, ECS components, systems
│   ├── Cargo.toml
│   └── Cargo.lock
├── web/                     # Next.js frontend
│   ├── src/
│   │   ├── components/      # React UI (editor panels, dashboard, settings)
│   │   ├── hooks/           # WASM loader, engine events, script runner
│   │   ├── stores/          # Zustand state (editor, chat, user)
│   │   └── lib/             # Audio, scripting, export, auth, billing
│   ├── public/              # Static assets + WASM binaries (generated)
│   └── package.json
├── mcp-server/              # MCP command manifest + tools
│   ├── manifest/commands.json
│   └── src/
├── docs/                    # User-facing documentation (human + AI readable)
│   ├── getting-started/     # Installation, first scene, editor overview
│   ├── features/            # Per-feature guides (18 topics)
│   ├── guides/              # End-to-end tutorials (FPS, platformer, AI workflow)
│   ├── reference/           # Command reference, script API, entity types
│   └── scripts/             # Doc generation scripts
├── build_wasm.ps1           # Dual WASM build script (WebGL2 + WebGPU)
└── README.md
```

## Development

### Build commands

| Command | Description |
|---------|-------------|
| `.\build_wasm.ps1` | Build both WASM variants (WebGL2 + WebGPU) |
| `cd web && npm run dev` | Start the Next.js dev server |
| `cd web && npm run build` | Production build |
| `cd web && npm run lint` | Run ESLint |
| `cd web && npx tsc --noEmit` | TypeScript type checking |
| `cd web && npx vitest run` | Run web tests |
| `cd mcp-server && npx vitest run` | Run MCP server tests |

### Key conventions

- **Bridge isolation:** Only `engine/src/bridge/` may import `web_sys`/`js_sys`/`wasm_bindgen`. The `core/` module is pure Rust with no browser dependencies.
- **Command-driven:** All engine operations are expressed as JSON commands through `handle_command()`. This enables both the UI and programmatic integrations to drive the editor.
- **Event-driven updates:** Bevy systems emit events via the bridge → JS callback → Zustand store → React re-render. No direct DOM manipulation from Rust.

## Contributing

Contributions are welcome! Here's how to get involved.

### Forking the repository

1. Click the **Fork** button at the top-right of the [repository page](https://github.com/Tristan578/project-forge)
2. Clone your fork locally:
   ```bash
   git clone https://github.com/<your-github-handle>/project-forge.git
   cd project-forge
   ```
3. Add the upstream remote:
   ```bash
   git remote add upstream https://github.com/Tristan578/project-forge.git
   ```

### Creating a Pull Request

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes and verify they work:
   ```bash
   # Build WASM engine
   .\build_wasm.ps1

   # TypeScript check
   cd web && npx tsc --noEmit

   # Run tests
   cd web && npx vitest run
   cd ../mcp-server && npx vitest run
   ```
3. Commit your changes with a clear message:
   ```bash
   git add <files>
   git commit -m "feat: add your feature description"
   ```
4. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
5. Open a Pull Request on the upstream repository. Include:
   - A summary of what changed and why
   - Steps to test the changes
   - Screenshots if the change is visual

### Submitting an Issue

1. Go to the [Issues tab](https://github.com/Tristan578/project-forge/issues)
2. Click **New Issue**
3. Choose the appropriate template (bug report or feature request), or open a blank issue
4. Include:
   - **Bug reports:** Steps to reproduce, expected vs. actual behavior, browser/OS info, console errors
   - **Feature requests:** Description of the feature, use case, and any proposed implementation ideas

### Code style

- **Rust:** Follow standard `rustfmt` conventions. All code must compile for `wasm32-unknown-unknown`.
- **TypeScript/React:** Follow the ESLint config in `web/eslint.config.mjs`. Use functional components with hooks.
- **Commits:** Use [Conventional Commits](https://www.conventionalcommits.org/) format (`feat:`, `fix:`, `docs:`, `refactor:`, etc.).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Engine | Bevy 0.16, wgpu 24, bevy_rapier3d, bevy_hanabi, bevy_panorbit_camera, csgrs, noise |
| Frontend | Next.js 16, React, Zustand, Tailwind CSS |
| Auth | Clerk |
| Payments | Stripe |
| Database | Neon (PostgreSQL) + Drizzle ORM |
| Build | wasm-bindgen, wasm-pack |

## License

This project is licensed under the [Business Source License 1.1](LICENSE). You may fork, modify, and contribute, but commercial use is prohibited. The license converts to Apache 2.0 on February 11, 2030. See [LICENSE](LICENSE) for full terms.
