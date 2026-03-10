# SpawnForge

[![CI](https://github.com/Tristan578/project-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/Tristan578/project-forge/actions/workflows/ci.yml)
[![CD](https://github.com/Tristan578/project-forge/actions/workflows/cd.yml/badge.svg)](https://github.com/Tristan578/project-forge/actions/workflows/cd.yml)

An open-source, AI-native 2D/3D game engine for the browser. Every capability — scene creation, materials, physics, scripting, audio, particles, tilemaps, animation, export — is exposed as a JSON command, making the entire editor fully controllable by LLMs and autonomous agents via the [Model Context Protocol](https://modelcontextprotocol.io/). Build games by conversation, by code, or by hand.

Powered by WebGPU (with WebGL2 fallback), Rust compiled to WebAssembly, and a React-based visual editor.

## Features

> **Status key:** Features marked **(UI only)** have inspector panels and store state but no engine integration yet — interactions update the UI but don't affect the WASM rendering engine. See [Known Limitations](docs/known-limitations.md) for architectural constraints.

### AI & Automation
- **AI Chat Assistant** — Built-in Claude-powered chat panel with agentic tool loop. Describe what you want ("build a platformer level") and the AI spawns entities, configures materials, writes scripts, and iterates across multiple turns until the scene is complete
- **Compound AI Actions** — 8 high-level tools (`create_scene_from_description`, `setup_character`, `arrange_entities`, etc.) that batch dozens of operations into single AI calls
- **Extended Thinking** — Toggle deep reasoning mode for complex multi-step requests like full game setup
- **Visual Scripting** — React Flow node graph editor with 73 node types across 10 categories. Non-programmers create game logic by connecting visual blocks; graphs compile to TypeScript
- **AI Asset Generation** — Generate 3D models, textures, sound effects, voice lines, and music via 5 provider integrations (Meshy, ElevenLabs, Suno, DALL-E, Stable Diffusion)
- **MCP Server** — 308 commands across 37 categories. Any MCP-compatible agent or LLM can create scenes, configure materials, set up physics, write game scripts, and export finished games — no UI interaction required
- **Command-Driven Architecture** — Every engine operation is a JSON command through `handle_command()`. The visual editor and AI agents use the exact same API
- **Scene Context** — Built-in context builder provides LLMs with full scene state for informed decision-making
- **Documentation System** — 28+ structured docs searchable via MCP tools (`search_docs`, `get_doc`, `list_doc_topics`), enabling AI agents to learn features on demand

### 3D Engine
- **WebGPU Rendering** — Primary rendering via WebGPU (wgpu 24) with automatic WebGL2 fallback for older browsers
- **PBR Materials** — Physically-based rendering with metallic/roughness workflow, UV transforms, clearcoat, transmission/IOR, parallax mapping, texture support, alpha modes, and 56 material presets across 9 categories
- **Shader Node Editor** — Visual WGSL shader creation with 30+ node types, live material preview, and save/load
- **Quality Presets** — Low/Medium/High/Ultra rendering presets that batch-configure MSAA, shadows, bloom, sharpening, and particle density
- **Dynamic Lighting** — Point, directional, and spot lights with real-time shadows and ambient light controls
- **Skybox & Environment Maps** — 5 built-in procedural cubemap presets (Studio, Sunset, Overcast, Night, Bright Day) with adjustable brightness, IBL, and rotation
- **Physics** — Rigid body dynamics, colliders, forces, joints (fixed, revolute, spherical, prismatic, rope, spring), collision events, and raycasting powered by Rapier 3D
- **Audio** — Spatial 3D audio, bus mixer with effect chains (reverb, delay, EQ, compressor), adaptive music (vertical stem layering), reverb zones, crossfade, ducking
- **GPU Particles** — 9 built-in presets (fire, smoke, sparks, rain, snow, explosions, etc.) with full customization via WebGPU compute shaders
- **Skeletal Animation** — glTF animation playback with transport controls, crossfade, blend weights, per-clip speed, and script API
- **Keyframe Animation** — Custom animation clips with position/rotation/scale/color keyframes, easing modes, and timeline editor
- **CSG Boolean Operations** — Union, subtract, and intersect on mesh entities using BSP-based constructive solid geometry
- **Procedural Terrain** — Heightmap generation with Perlin/Simplex/Value noise, sculpting tools, and vertex coloring
- **Procedural Mesh Generation** — Extrude 2D shapes, lathe profiles, array entities, and combine meshes
- **Polygon Modeling** — Edit mode with vertex/edge/face selection, extrude, subdivide, and normal recalculation
- **Custom Shader Effects** — 6 built-in visual effects (Dissolve, Hologram, Force Field, Lava/Flow, Toon, Fresnel Glow)
- **Custom WGSL Shaders** — Write arbitrary WGSL fragment shader code directly in the editor. 8 built-in templates (Passthrough, Color Tint, Wave Distortion, Rim Light, Grayscale, Pulsing Glow, UV Scroll, Scanlines), real-time compile status, error display, Ctrl+Enter compile shortcut, and scene persistence
- **Post-Processing** — Bloom, chromatic aberration, color grading, CAS sharpening, SSAO (WebGPU), depth of field, and motion blur
- **LOD System** — Level-of-detail component with distance thresholds, performance budget tracking

### 2D Engine (UI only)
> The 2D subsystem has full inspector UIs and Zustand state management, but no Bevy engine integration yet. Interactions update the editor UI; rendering and simulation require engine-side implementation.

- **2D Project Type** — Dedicated 2D mode with orthographic camera, sorting layers, and sprite-specific tools **(UI only)**
- **Sprite System** — Import PNG/WebP sprites, SpriteInspector, sorting layers (Background/Default/Foreground/UI) **(UI only)**
- **Sprite Animation** — Sprite sheet slicing, animation clips, state machines with parameter-driven transitions **(UI only)**
- **Tilemap System** — Multi-layer tilemaps, paint/erase/fill/rectangle tools, tile palette **(UI only)**
- **2D Physics** — Inspector for 6 collider shapes, 4 joint types, one-way platforms, surface velocity **(UI only)**
- **Skeletal 2D Animation** — Bone hierarchy, skins, IK constraints, blend trees, keyframe animation **(UI only)**
- **AI Sprite Generation** — Generate pixel art characters, tilesets, and sprite sheets via DALL-E 3 and SDXL

### Editor
- **Dockable Workspace** — Movable, resizable panels with preset layouts and persistent user customization
- **3D/2D Scene Editor** — Transform gizmos, multi-select, snapping, scene hierarchy, and domain-specific inspector panels
- **Game Templates** — 11 starter templates (5 3D + 6 2D): platformer, runner, shooter, puzzle, explorer, top-down RPG, shoot-em-up, fighting, metroidvania
- **Game Cameras** — 6 camera modes (ThirdPerson, FirstPerson, SideScroller, TopDown, Fixed, Orbital) with auto-activation in Play mode
- **Dialogue System** — Visual node editor with 5 node types (text, choice, condition, action, end), typewriter display, branching, and `forge.dialogue` script API
- **Scene Transitions** — Fade, wipe, and instant transitions between scenes with `forge.scene.load` API
- **In-Game UI Builder** — 10 widget types, WYSIWYG editor, 7 screen presets, data binding, play-mode renderer, and `forge.ui` script API
- **TypeScript Scripting** — Sandboxed scripting with `forge.*` API (14+ namespaces), starter templates, built-in editor with console
- **Script Library** — Save and share standalone scripts, import/export, enhanced script explorer
- **Material Library** — Browse 56 built-in presets with CSS sphere previews, category filters, search, and custom saving
- **Asset Pipeline** — Import glTF models, textures, audio, and sprites via drag-and-drop
- **Play Mode** — Test games instantly with play/pause/stop and scene snapshot restore
- **Input System** — Configurable key bindings with presets (FPS, Platformer, Top-Down, Racing)
- **Mobile Controls** — Virtual joystick and action buttons overlay, 5 touch presets, auto quality reduction
- **Prefab System** — Reusable entity templates with 8+ built-in prefabs, import/export, and search
- **Multi-Scene Management** — Multiple named scenes per project with scene switching, duplication, and import/export
- **Cloud Publishing** — Publish to shareable URLs with version management, tier-based limits, and analytics
- **Game Export** — ZIP export with texture compression, custom loading screens, PWA generation
- **Guided Onboarding** — Welcome wizard, interactive tutorials, context-sensitive tips
- **In-Editor Documentation** — Browsable docs panel with BM25 search, help buttons on inspectors, F1 shortcut
- **Pre-Built Game Components** — 13 drag-and-drop behaviors (CharacterController, Health, Collectible, Projectile, etc.)
- **Responsive Layout** — Adaptive UI with compact (mobile), condensed (laptop), and full desktop modes

## Architecture

```
MCP Server (308 commands, 37 categories)       AI agents + LLM tool use
    |  JSON commands
React Shell (Next.js 16, Zustand, Tailwind)    Visual editor UI
    |  JSON events via wasm-bindgen
Bevy Engine (Rust -> WebAssembly)              Scene editing + WebGPU rendering
    |
Game Runtime + TypeScript Scripting            In-browser game execution
```

The MCP server and the visual editor share the same command interface — there is no separate "AI mode." An agent calling `set_material` goes through the exact same code path as a user dragging a color picker.

**Rendering:** WebGPU primary (auto-detected), WebGL2 fallback. Two WASM binaries are built per release — the frontend auto-selects the correct one at runtime.

## Prerequisites

- [Rust](https://rustup.rs/) (stable) with the `wasm32-unknown-unknown` target
- [wasm-bindgen-cli](https://rustwasm.github.io/wasm-bindgen/reference/cli.html)
- [Node.js](https://nodejs.org/) 18+
- Bash (macOS/Linux) or PowerShell (Windows) for build scripts

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

```bash
# macOS / Linux
./build_wasm.sh

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
├── engine/                  # Bevy ECS engine (Rust -> WASM)
│   ├── src/
│   │   ├── bridge/          # JS interop — domain modules (wasm-bindgen, events)
│   │   └── core/            # Pure Rust: commands, ECS components, pending queues
│   ├── Cargo.toml
│   └── Cargo.lock
├── web/                     # Next.js frontend
│   ├── src/
│   │   ├── components/      # React UI (editor panels, inspectors, dialogs)
│   │   ├── hooks/           # WASM loader, engine events, script runner
│   │   ├── stores/          # Zustand state (editor slices, chat, user, workspace)
│   │   └── lib/             # Audio, scripting, export, auth, billing, shaders
│   ├── public/              # Static assets + WASM binaries (generated)
│   └── package.json
├── mcp-server/              # MCP command manifest + tools
│   ├── manifest/commands.json  # 308 commands across 37 categories
│   └── src/
├── docs/                    # User-facing documentation (human + AI readable)
│   ├── getting-started/     # Installation, first scene, editor overview
│   ├── features/            # Per-feature guides
│   ├── guides/              # End-to-end tutorials
│   └── reference/           # Command reference, script API, entity types
├── specs/                   # Feature specifications and sprint plans
├── build_wasm.sh            # WASM build script — macOS / Linux
├── build_wasm.ps1           # WASM build script — Windows (PowerShell)
└── README.md
```

## Development

### Build commands

| Command | Description |
|---------|-------------|
| `./build_wasm.sh` | Build both WASM variants — macOS / Linux |
| `.\build_wasm.ps1` | Build both WASM variants — Windows (PowerShell) |
| `cd web && npm run dev` | Start the Next.js dev server |
| `cd web && npm run build` | Production build |
| `cd web && npm run lint` | Run ESLint |
| `cd web && npx tsc --noEmit` | TypeScript type checking |
| `cd web && npx vitest run` | Run web tests (~4100+ tests) |
| `cd mcp-server && npx vitest run` | Run MCP server tests |

### Key conventions

- **Bridge isolation:** Only `engine/src/bridge/` may import `web_sys`/`js_sys`/`wasm_bindgen`. The `core/` module is pure Rust with no browser dependencies.
- **Command-driven:** All engine operations are expressed as JSON commands through `handle_command()`. This enables both the UI and programmatic integrations to drive the editor.
- **Event-driven updates:** Bevy systems emit events via the bridge -> JS callback -> Zustand store -> React re-render. No direct DOM manipulation from Rust.

## Agentic Development

SpawnForge is designed for **AI-assisted development**. Six AI coding tools are pre-configured with shared enforcement hooks, skills, and project context. Any contributor can open the repo in their preferred tool and start working immediately — ticket tracking, code quality, and GitHub sync are enforced consistently across all tools.

### Supported Tools

| Tool | Config Dir | Hooks | Skills | Default Model |
|------|-----------|-------|--------|---------------|
| [Claude Code](https://claude.ai/claude-code) | `.claude/` | Automatic | `.claude/skills/` | Opus 4.6 / Sonnet 4.6 |
| [GitHub Copilot](https://github.com/features/copilot) | `.github/` | Automatic | `.github/skills/` | GitHub-managed |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `.gemini/` | Automatic | `.agents/skills/` | `gemini-3.1-pro-preview` |
| [Windsurf](https://windsurf.com) | `.windsurf/` | Automatic | `.windsurf/workflows/` | App-managed |
| [Google Antigravity](https://antigravity.google) | `.agent/` + `.gemini/` | Manual | `.agent/skills/` | Gemini 3 |
| [OpenAI Codex CLI](https://github.com/openai/codex) | `.codex/` | Manual | `.codex/skills/` | `gpt-5.3-codex` |

**First-time setup:** Install the [taskboard binary](https://github.com/tcarac/taskboard/releases), then open the repo in your AI tool. Tools with automatic hooks will self-configure on first session. Tools without hooks (Codex, Antigravity) include manual workflow instructions in their `AGENTS.md` files.

### Quick Start by Tool

<details>
<summary><strong>Claude Code</strong></summary>

```bash
cd project-forge
claude  # hooks auto-start taskboard, pull GitHub, display backlog
```
Everything is automatic. Hooks enforce ticket-before-code on every prompt, validate tickets after every response, push changes to GitHub, and lint edited files. Skills are invoked via `/kanban`, `/sync-push`, `/sync-pull`, `/planner`, `/builder`, `/cycle`.

Claude Code also has three **subagents** (`.claude/agents/`):
- **Planner** (Opus) — Architect that creates specs in `specs/`, never writes code
- **Builder** (Sonnet) — Implementation specialist, reads specs and writes code
- **Validator** (Sonnet) — QA gatekeeper, runs tests and architecture checks

</details>

<details>
<summary><strong>GitHub Copilot</strong></summary>

```bash
cd project-forge
# Copilot reads .github/hooks/hooks.json and .github/instructions/copilot.instructions.md
```
Hooks trigger on session start (pull), prompt submit (ticket gate), and post-tool-use (validate + push). Skills available in `.github/skills/` and `.agents/skills/`. Prompts for manual sync in `.github/prompts/`.

</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

```bash
cd project-forge
gemini  # reads .gemini/settings.json, GEMINI.md, AGENTS.md
```
Hooks configured in `.gemini/settings.json` for SessionStart, BeforeAgent, AfterAgent, and AfterTool (file edits). Skills in `.agents/skills/`.

</details>

<details>
<summary><strong>Windsurf</strong></summary>

```bash
cd project-forge
# Windsurf reads .windsurf/hooks.json and .windsurf/rules/taskboard.md
```
Hooks trigger on `post_write_code`, `post_run_command`, `post_cascade_response`, and `pre_user_prompt`. Workflows for sync in `.windsurf/workflows/`.

</details>

<details>
<summary><strong>Google Antigravity</strong></summary>

```bash
cd project-forge
# Antigravity reads GEMINI.md (with AGENTS.md loading directive) and .agent/skills/
# No auto-hooks — run manually:
bash .claude/hooks/on-session-start.sh   # start of session
bash .claude/hooks/on-stop.sh             # after work
bash .claude/hooks/post-edit-lint.sh      # after editing
```
Skills in `.agent/skills/` (singular — Antigravity uses `.agent/`, not `.agents/`). Rules in `.agent/rules/`.

</details>

<details>
<summary><strong>OpenAI Codex CLI</strong></summary>

```bash
cd project-forge
codex  # reads .codex/config.toml and .codex/AGENTS.md
# No auto-hooks — run manually:
bash .claude/hooks/on-session-start.sh   # start of session
bash .claude/hooks/on-stop.sh             # after work
bash .claude/hooks/post-edit-lint.sh      # after editing
```
Config in `.codex/config.toml`. Skills in `.codex/skills/`. Full enforcement rules in `.codex/AGENTS.md`.

</details>

### Shared Hook System

All tools call the same bash scripts in `.claude/hooks/`. Tools with hook support wire them up automatically via their config files; tools without hooks require manual execution.

```
Tool Config (JSON/TOML)
    │
    ▼
Shared Bash Scripts (.claude/hooks/)
    │
    ├── taskboard-state.sh      ← Library: API helpers, validation, consistency
    ├── github_project_sync.py  ← Sync engine: push/pull with GitHub Projects v2
    └── github-sync-config.json ← GitHub Project metadata
```

#### Hook Lifecycle

| Hook | Script | Trigger | What It Does |
|------|--------|---------|-------------|
| **Session Start** | `on-session-start.sh` | Tool opens | Checks taskboard binary, auto-starts server, pulls from GitHub Project, displays backlog with prioritized work suggestions, warns about stale tickets |
| **Prompt Submit** | `on-prompt-submit.sh` | Before each prompt | Detects development-intent keywords, blocks code work if no active ticket, injects active ticket context |
| **Stop** | `on-stop.sh` | After each response | Validates active ticket (user story, AC, priority, team, subtasks), checks open ticket consistency, pushes changes to GitHub Project |
| **Post-Edit Lint** | `post-edit-lint.sh` | After file edits | Runs ESLint on changed `.ts`/`.tsx` files under `web/` (skips tests, node_modules, coverage) |
| **Sync Push** | `sync-to-github.sh` | Called by Stop | Guards for `gh` CLI + auth, calls `github_project_sync.py push` |
| **Sync Pull** | `sync-from-github.sh` | Called by Session Start | Guards for `gh` CLI + auth, calls `github_project_sync.py pull` |

#### Ticket Validation Rules

The `tb_validate_ticket()` function in `taskboard-state.sh` enforces:

1. **User Story** — Must match regex `As an?\s+.+,\s+I want\s+.+\s+so that\s+.+`
2. **Acceptance Criteria** — Minimum 3 complete Given/When/Then scenarios (happy path, edge case, negative)
3. **Description Substance** — At least 20 characters of technical context beyond user story and AC
4. **Priority** — Must be `urgent`, `high`, `medium`, or `low`
5. **Team** — Must be assigned to Engineering, PM, or Leadership
6. **Subtasks** — At least 3 implementation steps

### Skills Reference

Skills are callable capabilities loaded on-demand. Each tool stores them in its own directory, but all reference the same shared hook scripts.

| Skill | Available In | Purpose |
|-------|-------------|---------|
| **kanban** | All 6 tools | View board, create/update/move tickets, validate fields, toggle subtasks. Claude Code uses MCP tools; other tools use REST API (`curl` to `localhost:3010`) |
| **sync-push** | All 6 tools | Push local ticket changes to GitHub Project. Syncs full body (description, priority, subtask checkboxes, metadata block). Detects changes via content hashing |
| **sync-pull** | All 6 tools | Pull GitHub Project changes to local taskboard. Reconstructs subtasks from checkboxes, re-links tickets by ULID from metadata, imports new tickets with parsed fields |
| **planner** | Claude Code | Architect agent — analyzes requests, creates detailed specs in `specs/`, never writes code |
| **builder** | Claude Code | Implementation agent — reads specs, writes Rust/TypeScript, runs lint/check after coding |
| **cycle** | Claude Code | Orchestration — runs Plan → Build → Verify loop, updates project context after each cycle |
| **arch-validator** | Claude Code | Runs `check_arch.py` — 7 structural rules (bridge isolation, file sizes, dispatch chain, store composition) |

### GitHub Project Sync

The `github_project_sync.py` engine provides **bidirectional sync** between the local taskboard and [GitHub Project "SpawnForge" (#2)](https://github.com/orgs/Tristan578/projects/2).

**V2 body format:** Each ticket on GitHub contains a structured body:
```markdown
**Priority:** high

[ticket description — user story, AC, technical context]

## Subtasks
- [ ] Step 1
- [x] Step 2 (completed)
- [ ] Step 3

---
<!-- SPAWNFORGE_METADATA
{ "version": 2, "ticketId": "...", "bodyHash": "...", "subtaskHash": "..." }
SPAWNFORGE_METADATA -->
```

- `- [ ]`/`- [x]` renders as interactive checkboxes on GitHub
- The HTML comment is invisible but machine-parseable for re-linking
- Content hashes detect changes without full comparison
- Old v1 format (`**Taskboard:** PF-N (ULID)`) is still parsed on pull and auto-upgraded to v2 on next push

**Commands:**
```bash
python3 .claude/hooks/github_project_sync.py push       # incremental push
python3 .claude/hooks/github_project_sync.py push-all   # full push (upgrades all to v2)
python3 .claude/hooks/github_project_sync.py pull        # pull remote changes
python3 .claude/hooks/github_project_sync.py status      # show sync state
```

### Architecture Validator

The `check_arch.py` script enforces 7 structural rules:

| Rule | Limit | What It Checks |
|------|-------|---------------|
| Bridge isolation | Hard fail | No `web_sys`/`js_sys`/`wasm_bindgen` imports outside `engine/src/bridge/` |
| Rust file size | 800 lines | No Rust source file exceeds limit |
| TypeScript file size | 500 lines | No TS/TSX file exceeds limit (excludes tests, `.d.ts`, legacy) |
| Command dispatch | 50 match arms | `commands/mod.rs` delegates to domain modules, not monolithic match |
| Pending mod.rs | No request structs | Request types live in domain modules, not `pending/mod.rs` |
| Store composition | 200 lines | `editorStore.ts` composes slices, doesn't define inline state |
| Event delegation | 150 lines | `useEngineEvents.ts` delegates to `hooks/events/` handlers |

```bash
python3 .claude/skills/arch-validator/check_arch.py           # warnings
python3 .claude/skills/arch-validator/check_arch.py --strict   # exit 1 on any violation
python3 .claude/skills/arch-validator/check_arch.py --json     # machine-readable output
```

### Taskboard

All work is tracked on a local [taskboard](https://github.com/tcarac/taskboard) that syncs to GitHub Projects.

**Install:**
```bash
go install github.com/tcarac/taskboard@latest
# Or download from https://github.com/tcarac/taskboard/releases
```

**Start:**
```bash
cd project-forge
taskboard start --port 3010 --db .claude/taskboard.db
```

- **Web UI:** http://localhost:3010
- **API:** http://localhost:3010/api
- **Project ID:** `01KJEE8R1XXFF0CZT1WCSTGRDP` (prefix: PF)
- **Database:** `.claude/taskboard.db` (SQLite, 186+ tickets)

Tools with hook support auto-start the taskboard on session start. The database is committed to the repo so all contributors share the same ticket state.

### Config Directory Map

```
project-forge/
├── AGENTS.md                    # Cross-tool instructions (Copilot, Gemini, Antigravity, Codex)
├── GEMINI.md                    # Gemini CLI + Antigravity instructions
├── .claude/                     # Claude Code (primary tool)
│   ├── CLAUDE.md                #   Full project constitution (280+ lines)
│   ├── settings.json            #   Tool settings
│   ├── agents/                  #   Subagent definitions
│   │   ├── planner.md           #     Architect (Opus model)
│   │   ├── builder.md           #     Implementer (Sonnet model)
│   │   └── validator.md         #     QA gatekeeper (Sonnet model)
│   ├── hooks/                   #   SHARED hook scripts (all tools call these)
│   │   ├── taskboard-state.sh   #     Library: API helpers, validation, staleness
│   │   ├── on-session-start.sh  #     Session start lifecycle
│   │   ├── on-prompt-submit.sh  #     Prompt submit gate
│   │   ├── on-stop.sh           #     Post-response validation
│   │   ├── post-edit-lint.sh    #     ESLint on changed files
│   │   ├── sync-to-github.sh    #     Push to GitHub Project
│   │   ├── sync-from-github.sh  #     Pull from GitHub Project
│   │   ├── github_project_sync.py  #  Sync engine (Python)
│   │   ├── github-sync-config.json #  GitHub Project metadata
│   │   └── github-project-map.json #  Ticket ↔ GitHub item mapping
│   ├── rules/                   #   Architecture & quality rules
│   │   ├── bevy-api.md          #     Bevy 0.18 API patterns
│   │   ├── entity-snapshot.md   #     ECS snapshot patterns
│   │   ├── web-quality.md       #     ESLint & React patterns
│   │   ├── library-apis.md      #     Third-party library APIs
│   │   └── file-map.md          #     Project file structure
│   ├── skills/                  #   Claude Code skills
│   │   ├── kanban/SKILL.md      #     Taskboard management
│   │   ├── sync-push/SKILL.md   #     Push to GitHub
│   │   ├── sync-pull/SKILL.md   #     Pull from GitHub
│   │   ├── planner/SKILL.md     #     Spec generation
│   │   ├── builder/SKILL.md     #     Code implementation
│   │   ├── cycle/SKILL.md       #     Plan→Build→Verify loop
│   │   └── arch-validator/      #     Architecture validation
│   │       ├── SKILL.md
│   │       └── check_arch.py
│   └── taskboard.db             #   SQLite database (186+ tickets)
├── .github/                     # GitHub Copilot
│   ├── hooks/hooks.json         #   Hook wiring (sessionStart, promptSubmit, postToolUse)
│   ├── instructions/copilot.instructions.md  # Copilot-specific guidance
│   ├── skills/                  #   kanban, sync-push, sync-pull
│   └── prompts/                 #   sync-push.prompt.md, sync-pull.prompt.md
├── .gemini/                     # Gemini CLI (+ Antigravity model config)
│   └── settings.json            #   Hooks + model (gemini-3.1-pro-preview)
├── .agents/                     # Shared skills (Copilot + Gemini CLI)
│   ├── rules/taskboard-sync.md  #   Ticket enforcement rules
│   └── skills/                  #   kanban, sync-push, sync-pull
├── .agent/                      # Google Antigravity (singular — NOT .agents/)
│   ├── rules/taskboard-sync.md  #   Ticket enforcement rules
│   └── skills/                  #   kanban, sync-push, sync-pull
├── .windsurf/                   # Windsurf
│   ├── hooks.json               #   Hook wiring (post_write_code, pre_user_prompt, etc.)
│   ├── rules/taskboard.md       #   Ticket enforcement rules
│   └── workflows/               #   sync-push.md, sync-pull.md
└── .codex/                      # OpenAI Codex CLI
    ├── config.toml              #   Model (gpt-5.3-codex), approval policy, sandbox
    ├── AGENTS.md                #   Full instructions (no hooks, so rules are inline)
    └── skills/                  #   kanban, sync-push, sync-pull
```

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
   ./build_wasm.sh          # macOS/Linux
   # .\build_wasm.ps1       # Windows

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
| Engine | Bevy 0.18, wgpu 27, bevy_rapier3d 0.33, bevy_hanabi 0.18, bevy_panorbit_camera 0.34, csgrs 0.20, noise 0.9 |
| Frontend | Next.js 16, React 19, Zustand 5, Tailwind CSS, React Flow |
| Auth | Clerk |
| Payments | Stripe |
| Database | Neon (PostgreSQL) + Drizzle ORM |
| Build | wasm-bindgen, wasm-pack |

## License

This project is licensed under the [Business Source License 1.1](LICENSE). You may fork, modify, and contribute, but commercial use is prohibited. The license converts to Apache 2.0 on February 11, 2030. See [LICENSE](LICENSE) for full terms.
