# Aseprite Bridge & AI Pixel Art Pipeline — Design Document

**Date:** 2026-03-08
**Ticket:** PF-89
**Status:** Approved
**Author:** Claude (Opus 4.6) + Tristan Nolan

## Overview

Two-mode pixel art generation system for SpawnForge: (1) AI-powered pixel art pipeline that works for all users with zero external dependencies, and (2) an Aseprite Bridge connector that enables bidirectional sync with locally-installed Aseprite via Lua scripting. This is the first implementation of the SpawnForge Bridge platform — a connector marketplace for external creative tools.

## Goals

1. **AI Pixel Art Pipeline (Mode 1)**: Text/image-to-pixel-art with post-processing (downscale, palette quantization, dithering). Works for all users.
2. **Aseprite Bridge (Mode 2)**: WebSocket-based bridge to local Aseprite via Lua plugin. Bidirectional sprite sync.
3. **Bridge Platform Foundation**: Reusable protocol layer for future connectors (Blender, Reaper, Adobe, Tiled, etc.).
4. **Full test coverage**: Unit tests for all algorithms and protocol handlers.

## Architecture

```
SpawnForge Editor (Browser)
├── AI Pipeline (serverless)
│   ├── SDXL/DALL-E generation with pixel-art prompts
│   └── Post-processing: downscale → quantize → dither → export
├── Bridge Protocol Layer (reusable)
│   ├── JSON-RPC 2.0 over WebSocket
│   ├── Auth: one-time token, localhost only
│   └── Heartbeat + reconnection
├── Aseprite Bridge Connector
│   ├── Command mapping (SpawnForge → Aseprite Lua API)
│   └── Sync events (Aseprite → SpawnForge)
└── Sprite Asset Pipeline (existing)
    └── SpriteData ECS → PixelArtEditor → Export

User's Local Machine
└── Aseprite Desktop + Bridge Plugin (Lua)
    └── WebSocket client → ws://localhost:3000/api/bridge/ws
```

## Mode 1: AI Pixel Art Pipeline

### Generation Flow

1. User provides: text prompt, target size (16/32/64/128px), style preset, palette choice
2. API route validates input, resolves API key, deducts tokens
3. AI provider generates image (512x512 or 1024x1024)
4. Post-processing pipeline:
   a. **Downscale** to target resolution using nearest-neighbor interpolation
   b. **Color extraction** via median-cut quantization (extract N dominant colors)
   c. **Palette mapping** — map each pixel to nearest palette color (Euclidean distance in LAB color space)
   d. **Dithering** (optional) — ordered (Bayer 8x8/4x4) or none
   e. **Output** — indexed PNG with palette metadata
5. Result stored as sprite asset, applied to entity if specified

### Post-Processing Algorithms

#### Nearest-Neighbor Downscale
Standard pixel-art downscale. For each target pixel, sample the source pixel at `floor(tx * srcW / dstW), floor(ty * srcH / dstH)`. No interpolation — preserves hard pixel edges.

#### Median-Cut Color Quantization
1. Collect all unique colors from source image
2. Find the color channel (R/G/B) with the greatest range
3. Sort pixels by that channel, split at median
4. Recurse until N buckets reached
5. Average each bucket for final palette color

#### Palette Mapping (LAB Distance)
Convert both pixel and palette colors to CIELAB color space. Use Euclidean distance for perceptually uniform matching. This avoids the green-bias of RGB distance.

#### Ordered Dithering (Bayer Matrix)
Apply threshold map before palette mapping. For Bayer 8x8:
- Normalize threshold matrix to [-0.5, 0.5] range
- Add `threshold[x%8][y%8] * spread` to each color channel
- Then map to nearest palette color
- `spread` controls dithering intensity (0 = none, 1 = full)

### Preset Palettes

| Name | Colors | Source |
|------|--------|--------|
| Pico-8 | 16 | Classic retro (already in PixelArtEditor) |
| DB16 | 16 | DawnBringer 16 — warm retro |
| DB32 | 32 | DawnBringer 32 — expanded retro |
| Endesga-32 | 32 | Modern pixel art standard |
| Endesga-64 | 64 | Extended modern palette |
| NES | 54 | Nintendo Entertainment System |
| Game Boy | 4 | Original Game Boy green |
| CGA | 16 | IBM CGA palette |
| Custom | 2-256 | User-defined via color picker |

### API Endpoint

```
POST /api/generate/pixel-art
{
  "prompt": "a warrior knight with sword",
  "referenceImage": "data:image/png;base64,...",  // optional
  "targetSize": 32,           // 16, 32, 64, 128
  "palette": "endesga-32",    // preset name or "custom"
  "customPalette": ["#1a1c2c", ...],  // if palette="custom"
  "dithering": "bayer8x8",    // "none", "bayer4x4", "bayer8x8"
  "ditheringIntensity": 0.5,  // 0-1
  "style": "character",       // "character", "prop", "tile", "icon", "environment"
  "provider": "auto",         // "auto", "openai", "replicate"
  "entityId": "optional-target-entity"
}
```

### Token Cost

| Provider | Cost |
|----------|------|
| SDXL (Replicate) | 10 tokens |
| DALL-E 3 (OpenAI) | 20 tokens |
| Auto (routes pixel-art → SDXL) | Provider-dependent |

## Mode 2: Aseprite Bridge

### Bridge Protocol (JSON-RPC 2.0)

Reusable protocol layer for all future connectors.

```typescript
interface BridgeMessage {
  jsonrpc: "2.0";
  id?: string;          // Present for requests, absent for notifications
  method: string;       // e.g., "sprite.create", "sync.spriteChanged"
  params?: object;      // Method-specific parameters
  result?: unknown;     // Response data (success)
  error?: {             // Response data (failure)
    code: number;
    message: string;
    data?: unknown;
  };
}
```

### Authentication

1. User clicks "Connect Aseprite" in SpawnForge Bridge Panel
2. SpawnForge generates a one-time auth token (crypto.randomUUID)
3. Token displayed in UI: "Paste this into your Aseprite Bridge Plugin"
4. Lua plugin connects to `ws://localhost:3000/api/bridge/ws?token=<token>`
5. Server validates token, establishes session
6. Token expires after first use or 5 minutes

### Aseprite Lua Plugin

Installed by user into Aseprite's scripts directory (`%APPDATA%/Aseprite/scripts/` on Windows, `~/.config/aseprite/scripts/` on Linux/Mac).

```lua
-- spawnforge-bridge.lua (simplified)
local ws = WebSocket{
  url = "ws://127.0.0.1:3000/api/bridge/ws?token=" .. app.params["token"],
  onreceive = function(msgType, data)
    if msgType == WebSocketMessageType.TEXT then
      local msg = json.decode(data)
      handleCommand(msg)
    end
  end
}

function handleCommand(msg)
  if msg.method == "sprite.create" then
    local s = Sprite(msg.params.width, msg.params.height)
    ws:sendText(json.encode({jsonrpc="2.0", id=msg.id, result={spriteId=tostring(s)}}))
  elseif msg.method == "sprite.setPalette" then
    -- Apply palette colors...
  elseif msg.method == "image.importPng" then
    -- Import base64 PNG data into current cel...
  end
end
```

### Bridge Commands (SpawnForge → Aseprite)

| Command | Parameters | Description |
|---------|------------|-------------|
| `sprite.create` | width, height, colorMode | Create new sprite |
| `sprite.open` | path | Open existing .ase file |
| `sprite.save` | path? | Save current sprite |
| `sprite.close` | — | Close current sprite |
| `sprite.resize` | width, height | Resize canvas |
| `sprite.setPalette` | colors[] | Set palette colors |
| `sprite.getPalette` | — | Get current palette |
| `frame.add` | duration? | Add animation frame |
| `frame.remove` | index | Remove frame |
| `frame.setDuration` | index, ms | Set frame timing |
| `layer.add` | name, type? | Add layer |
| `layer.remove` | name | Remove layer |
| `layer.setOpacity` | name, opacity | Set layer opacity |
| `image.importPng` | base64, x?, y? | Import PNG into cel |
| `image.getPixels` | rect? | Get pixel data |
| `image.drawPixel` | x, y, color | Draw single pixel |
| `image.fill` | color, rect? | Flood fill region |
| `image.clear` | — | Clear current image |
| `tag.create` | name, from, to, direction | Create animation tag |
| `export.png` | scale?, path? | Export as PNG |
| `export.spriteSheet` | type, path? | Export sprite sheet |
| `command.run` | name, params? | Run any app.command |

### Sync Events (Aseprite → SpawnForge)

| Event | Data | Trigger |
|-------|------|---------|
| `sync.spriteChanged` | frameData (base64 PNG) | After any edit |
| `sync.paletteChanged` | colors[] | Palette modification |
| `sync.frameAdded` | index, duration | New frame created |
| `sync.frameRemoved` | index | Frame deleted |
| `sync.selectionChanged` | rect | Selection change |
| `sync.fileSaved` | path, filename | File saved |

### Security Constraints

- WebSocket server bound to `127.0.0.1` only (not `0.0.0.0`)
- One-time auth token required for connection
- Token expires after 5 minutes if unused
- Maximum 1 concurrent bridge connection per user session
- All file operations sandboxed to user's project directory
- No arbitrary code execution — only whitelisted commands

## Bridge Platform Foundation

### Connector Interface (for future bridges)

```typescript
interface BridgeConnector {
  id: string;                    // e.g., "aseprite", "blender", "reaper"
  name: string;                  // Display name
  version: string;               // Connector version
  status: "connected" | "disconnected" | "connecting";
  capabilities: string[];        // e.g., ["sprite", "animation", "palette"]

  connect(token: string): Promise<void>;
  disconnect(): void;
  sendCommand(method: string, params: object): Promise<unknown>;
  onEvent(handler: (event: BridgeEvent) => void): void;
}
```

### Future Connectors Roadmap

| Connector | Protocol | Priority | Use Case |
|-----------|----------|----------|----------|
| Aseprite | Lua WebSocket | **Phase 1 (now)** | Pixel art, sprite animation |
| Blender | Python socket | Phase 2 | 3D modeling, rigging |
| Reaper | Lua/OSC | Phase 2 | Audio, music, SFX |
| Tiled/LDtk | JSON export | Phase 2 | Level design, tilemaps |
| Adobe Photoshop | UXP plugin | Phase 3 | Textures, concept art |
| Unity | C# editor script | Phase 3 | Game engine bridge |
| Godot | GDScript | Phase 3 | Game engine bridge |

## File Structure

```
web/src/lib/
├── generate/
│   ├── pixelArtClient.ts          # AI generation client
│   ├── pixelArtProcessor.ts       # Post-processing algorithms
│   ├── palettes.ts                # Preset palette definitions
│   └── __tests__/
│       ├── pixelArtClient.test.ts
│       ├── pixelArtProcessor.test.ts
│       └── palettes.test.ts
├── bridge/
│   ├── protocol.ts                # JSON-RPC 2.0 protocol layer
│   ├── bridgeManager.ts           # Connection lifecycle management
│   ├── connectors/
│   │   └── aseprite.ts            # Aseprite-specific command mapping
│   └── __tests__/
│       ├── protocol.test.ts
│       ├── bridgeManager.test.ts
│       └── aseprite.test.ts
web/src/app/api/
├── generate/pixel-art/
│   ├── route.ts                   # AI pixel art generation endpoint
│   └── route.test.ts
├── bridge/
│   └── ws/route.ts                # WebSocket bridge endpoint
web/src/components/editor/
├── GeneratePixelArtDialog.tsx      # AI pixel art UI
├── BridgePanel.tsx                 # Bridge connection status/management
web/src/stores/
├── bridgeStore.ts                  # Bridge connection state
web/src/lib/chat/handlers/
├── pixelArtHandlers.ts            # MCP command handlers
bridges/aseprite/
├── spawnforge-bridge.lua          # Aseprite Lua plugin
├── README.md                      # Installation instructions
```

## MCP Commands (New)

| Command | Category | Description |
|---------|----------|-------------|
| `generate_pixel_art` | generation | AI pixel art from text prompt |
| `generate_pixel_art_sheet` | generation | AI animated sprite sheet with pixel art processing |
| `set_pixel_art_palette` | sprite | Apply preset/custom palette to sprite |
| `quantize_sprite_colors` | sprite | Reduce colors with dithering options |
| `bridge_connect` | bridge | Initiate bridge connection |
| `bridge_disconnect` | bridge | Close bridge connection |
| `bridge_send_to_aseprite` | bridge | Send current sprite to Aseprite |
| `bridge_import_from_aseprite` | bridge | Import sprite from Aseprite |
| `bridge_status` | bridge | Get bridge connection status |

## Testing Strategy

### Unit Tests (target: 50+ tests)

**Post-Processing (`pixelArtProcessor.test.ts`)**
- Nearest-neighbor downscale: identity (same size), 2x reduction, non-square
- Median-cut quantization: 1 color, 2 colors, 16 colors, 256 colors, transparent pixels
- Palette mapping: exact match, nearest LAB match, transparent preservation
- Bayer dithering: intensity=0 equals no dither, intensity=1 full dither, matrix tiling
- Full pipeline: downscale → quantize → dither end-to-end

**Palettes (`palettes.test.ts`)**
- All presets have correct color count
- Colors are valid hex strings
- Custom palette validation (min 2, max 256)

**Bridge Protocol (`protocol.test.ts`)**
- Serialize/deserialize JSON-RPC requests, responses, notifications, errors
- Message ID generation and tracking
- Timeout handling for pending requests
- Invalid message rejection

**Bridge Manager (`bridgeManager.test.ts`)**
- Token generation (unique, expires)
- Connection lifecycle (connect, authenticate, heartbeat, disconnect)
- Reconnection logic
- Max 1 concurrent connection enforcement

**Aseprite Connector (`aseprite.test.ts`)**
- Command mapping for all 20+ commands
- Event deserialization for all sync events
- Error handling for unknown commands

**API Route (`route.test.ts`)**
- Authentication required
- Rate limiting (10 req/5min)
- Input validation (size, palette, dithering params)
- Token deduction before generation
- Provider selection logic
- Error responses (402 insufficient tokens, 429 rate limited, 500 provider error)

**Pixel Art Client (`pixelArtClient.test.ts`)**
- Prompt construction per style preset
- Provider routing (pixel-art → SDXL)
- Response parsing and post-processing trigger
- Fallback on provider failure

### Integration Tests
- Full generation pipeline with mocked AI provider
- Post-processing with real image data (small test images)

## Implementation Phases

### Phase 1 (This Session): AI Pipeline + Post-Processing
- `pixelArtProcessor.ts` — all algorithms with full test coverage
- `palettes.ts` — preset definitions with tests
- `pixelArtClient.ts` — AI generation client with tests
- API route — `/api/generate/pixel-art` with tests
- MCP handlers — `generate_pixel_art`, `set_pixel_art_palette`, `quantize_sprite_colors`
- UI — `GeneratePixelArtDialog.tsx`

### Phase 2 (Next Session): Aseprite Bridge
- `protocol.ts` — JSON-RPC layer with tests
- `bridgeManager.ts` — connection lifecycle with tests
- `aseprite.ts` — connector with tests
- `bridgeStore.ts` — Zustand state
- `BridgePanel.tsx` — UI
- `spawnforge-bridge.lua` — Aseprite plugin
- WebSocket API route
- MCP bridge commands

### Phase 3 (Future): Bridge Marketplace
- Connector registry and marketplace UI
- Blender, Reaper, Tiled connectors
- Bridge authentication for remote servers
