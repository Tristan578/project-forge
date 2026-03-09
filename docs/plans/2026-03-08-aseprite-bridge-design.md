# Aseprite Bridge — Phase 2 Design

## Overview

A standalone bridge service that manages Aseprite as an external tool for pixel art generation. First implementation of a generic bridge pattern for future tool integrations (Blender, Krita, etc.).

## Architecture

```
SpawnForge Editor UI
    ↓ (API routes)
Bridge Service Layer (web/src/lib/bridges/)
    ↓ (child_process spawn)
Aseprite --batch --script <generated.lua>
    ↓ (file output)
Result files → imported back into SpawnForge
```

## Components

### 1. Bridge Core (`web/src/lib/bridges/bridgeManager.ts`)

Generic bridge interface for external tool management:

- `BridgeToolConfig` — per-platform paths, version, status
- `discover(toolId)` — scan platform-appropriate install locations
- `execute(toolId, operation, params)` — run a tool operation
- `healthCheck(toolId)` — verify tool is accessible and functional

Platform-aware auto-discovery:
- **macOS**: `/Applications/Aseprite.app/Contents/MacOS/aseprite`
- **Windows**: `C:\Program Files\Aseprite\aseprite.exe`, `C:\Program Files (x86)\Aseprite\aseprite.exe`
- **Linux**: `/usr/bin/aseprite`, `/usr/local/bin/aseprite`, `~/.local/bin/aseprite`

Config stored at `~/.spawnforge/bridges.json`:
```json
{
  "aseprite": {
    "paths": {
      "darwin": "/Applications/Aseprite.app/Contents/MacOS/aseprite",
      "win32": "C:\\Program Files\\Aseprite\\aseprite.exe",
      "linux": "/usr/bin/aseprite"
    },
    "activeVersion": "1.3.17"
  }
}
```

Discovery runs on every bridge service startup. Per-platform paths mean switching between machines (e.g., Windows desktop → MacBook) works without reconfiguration.

### 2. Aseprite Bridge (`web/src/lib/bridges/asepriteBridge.ts`)

Implements the bridge interface for Aseprite:

- Spawns `aseprite --batch --script <file>` for each operation
- Manages temp directories for Lua scripts and output files
- Parses exit codes and stderr for error reporting
- Returns structured results (output file paths, metadata)

### 3. Lua Template Library (`web/src/lib/bridges/aseprite/templates/`)

Pre-written Lua scripts with `{{variable}}` substitution:

| Template | Purpose |
|----------|---------|
| `createSprite.lua` | New sprite with dimensions, palette, base color |
| `exportSheet.lua` | Export as sprite sheet PNG + JSON metadata |
| `applyPalette.lua` | Swap/apply palette to existing .ase file |
| `createAnimation.lua` | Set up frames with timing and layers |
| `editSprite.lua` | Modify existing .ase (resize, recolor, add layers) |

Template rendering: simple `{{key}}` replacement with JSON-escaped values. No eval, no injection risk.

### 4. API Routes (`web/src/app/api/bridges/aseprite/`)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/bridges/discover` | POST | Find local tool installations |
| `/api/bridges/aseprite/execute` | POST | Run a bridge operation |
| `/api/bridges/aseprite/status` | GET | Health check |

### 5. Bridge Store (`web/src/stores/bridgeStore.ts`)

Zustand store tracking:
- Discovered tools and their paths/versions
- Connection status per tool
- Running operations (for UI progress indicators)

### 6. Settings UI

"Bridge Tools" section in existing Settings panel:
- List of discovered tools with status indicators
- Path override input per tool
- "Rediscover" button to re-scan
- Version display

## Testing Strategy

### Record/Replay Pattern

Real Aseprite responses drive all mocks — fixtures never drift from reality.

1. **Integration tests** (local only, requires Aseprite):
   - Run against real Aseprite installation
   - Capture actual outputs: exit codes, stdout/stderr, output files (PNGs, JSON metadata)
   - Save responses to `__fixtures__/aseprite/` as recorded fixtures

2. **Fixture-based unit tests** (CI):
   - Mock `child_process.spawn` using recorded fixtures
   - Test full pipeline: template rendering → mock execution → result parsing
   - Test error handling with recorded failure fixtures

3. **E2E tests with mock bridge** (CI):
   - Mock bridge service returns fixture data
   - Test SpawnForge pipeline: bridge API → result processing → sprite import
   - Validates the integration seam without external dependencies

4. **Full local E2E** (development):
   - Live Aseprite + SpawnForge end-to-end
   - Generates/updates fixtures when run with `--update-fixtures` flag

### Test Files
- `web/src/lib/bridges/__tests__/bridgeManager.test.ts` — discovery, config, platform logic
- `web/src/lib/bridges/__tests__/asepriteBridge.test.ts` — execution, error handling
- `web/src/lib/bridges/__tests__/luaTemplates.test.ts` — template rendering
- `web/src/lib/bridges/__tests__/fixtures/` — recorded Aseprite responses
- `web/src/lib/bridges/__tests__/asepriteBridge.integration.test.ts` — real Aseprite (local only)

## Out of Scope (Phase 3+)

- AI-generated Lua scripts (Claude generates custom Lua per request)
- Reference image analysis (extract style/palette from existing art)
- Iterative feedback loop (preview → accept/reject → refine)
- Bridge Marketplace UI (PF-267)
- Other tool bridges (Blender, Krita)
