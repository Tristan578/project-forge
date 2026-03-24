# Spec: AI Texture Painter

> **Status:** DRAFT -- Awaiting Approval
> **Date:** 2026-03-24
> **Ticket:** PF-564
> **Scope:** Describe texture changes in natural language and AI paints them onto 3D models

## Problem

SpawnForge can generate full textures via the Meshy API (`/api/generate/texture`) and apply material-level adjustments via the texture painter module (`lib/ai/texturePainter.ts`). But users cannot make targeted modifications to existing textures -- "add rust spots to the metal panel", "paint a logo on the chest", "make the wood grain more pronounced". The current system is all-or-nothing: generate a completely new texture or adjust scalar material properties. There is no way to selectively modify regions of an existing texture.

## Existing Infrastructure

- `web/src/lib/ai/texturePainter.ts` -- 10+ texture styles, material property adjustments, prompt builder. Does NOT do image-level editing -- only adjusts material scalars (roughness, metallic, etc.)
- `web/src/components/editor/TexturePainterPanel.tsx` -- UI with style presets, slot selection, blend mode, intensity slider
- `web/src/app/api/generate/texture/route.ts` -- Meshy API integration for full texture generation (1024/2048, tiling)
- `web/src/stores/generationStore.ts` -- async job tracking with progress
- `engine/src/core/asset_manager.rs` -- `TextureHandleMap`, base64 data URL pipeline for texture loading
- `engine/src/bridge/scene_io.rs` -- `apply_texture_load` decodes base64 -> Bevy `Image` asset
- `engine/src/core/material.rs` -- `MaterialData` with 5 texture slots: base_color, normal, metallic_roughness, emissive, occlusion
- 5 texture slots synced via `sync_material_data` in the bridge

## Solution

Add an AI inpainting/editing layer that takes an existing texture (or generates a base first), applies a natural-language modification using an image generation API with inpainting support, and writes the result back to the entity's texture slot. The key insight: we extract the current texture as a base image, generate an edit mask from the description, and use img2img/inpainting to produce the modified texture.

### Architecture

```
"add rust spots to the metal panel"
    |
    v
TexturePainterPanel (enhanced)
    |  1. Read current texture from entity (or use blank)
    |  2. POST /api/generate/texture-edit
    v
API route:
    |  a. Resolve provider (Stability AI inpainting / DALL-E edit / Meshy texture)
    |  b. Send: { baseImage, prompt, mask?, slot, strength }
    |  c. Receive: edited image (PNG/JPEG)
    v
Client receives base64 image URL
    |  dispatchCommand("load_texture", { entityId, slot, dataUrl })
    v
Engine: apply_texture_load -> Bevy Image asset -> StandardMaterial slot
```

### Phase 1: Description-Based Texture Editing

**Web Changes**

1. `web/src/lib/ai/textureEditor.ts` -- Pure-function module:
   - `TextureEditRequest` type: `{ entityId, description, targetSlot, strength (0-1), preserveBase: boolean }`
   - `buildEditPrompt(description, currentMaterial, style): string` -- creates provider-appropriate prompt with material context (current roughness, color, style)
   - `EDIT_PRESETS: TextureEditPreset[]` -- common modifications: "add weathering", "make metallic", "add wood grain", "add scratches", "change color to...", "add pattern..."
   - `compositeTextures(base: ImageData, edit: ImageData, blendMode, strength): ImageData` -- client-side Canvas2D compositing for blend modes (replace, overlay, multiply, add)
   - `extractEntityTexture(entityId, slot): Promise<string | null>` -- reads current texture from the engine via a `get_texture_data` query (returns base64)

2. `web/src/app/api/generate/texture-edit/route.ts` -- API route:
   - Auth + rate limit (10 req / 5 min) + token billing (`texture_edit`: 40 tokens)
   - Input: `{ prompt, baseImage?, resolution?, strength?, style? }`
   - Provider selection:
     - Primary: Stability AI img2img endpoint (best for texture modification)
     - Fallback: Full texture regeneration via Meshy with prompt that references the original style
   - Content safety: `sanitizePrompt()` on description
   - Returns: `{ imageUrl: string, jobId: string }` (base64 data URL or signed URL)

3. Enhancement to `web/src/components/editor/TexturePainterPanel.tsx`:
   - New "Edit" tab alongside existing "Style" tab
   - Free-text description input: "add rust spots to the surface"
   - Strength slider (0-1): how much the edit overwrites the base
   - Before/after preview (split view or toggle)
   - "Apply to Slot" dropdown (base_color, normal, etc.)
   - Undo integration: stores previous texture data URL for revert

4. `web/src/lib/chat/handlers/texturePaintHandlers.ts`:
   - Handles: "paint rust on the metal cube", "make the floor tiles look wet", "add a logo to entity X"
   - Extracts target entity from context, calls texture-edit API, applies result

**MCP Commands (3 new)**

| Command | Params | Description |
|---------|--------|-------------|
| `edit_entity_texture` | `{ entityId, description, slot?, strength? }` | AI-modify existing texture based on description |
| `get_entity_texture` | `{ entityId, slot }` | Extract current texture as base64 data URL |
| `apply_texture_preset` | `{ entityId, preset }` | Apply a named texture edit preset |

### Phase 2: Region Masking + Multi-Slot

5. Region selection: user draws a mask on a 2D UV preview to constrain the edit area
   - `web/src/components/editor/TextureMaskCanvas.tsx` -- Canvas overlay for brush-based mask painting
   - Mask sent as additional channel to inpainting API
   - Requires UV-unwrap visualization (render entity UVs to a 2D canvas)

6. Multi-slot coherent editing: "make it look rusty" simultaneously adjusts:
   - base_color: brown/orange tint
   - normal: surface roughness bumps
   - metallic_roughness: reduced metallic, increased roughness
   - LLM determines which slots to modify based on the description

### Phase 3: Texture Memory + Project-Wide Consistency

7. Style transfer: "make all wooden objects in the scene match this texture style"
8. Texture palette: project-wide color/material themes that constrain generation
9. History stack: per-slot texture undo with thumbnail previews

## Engine Changes (Rust)

### Phase 1: Texture Extraction Query

One new query handler needed to read texture data back from the engine:

- `engine/src/core/commands/material.rs` -- add `get_texture_data` command:
  - Reads the `Handle<Image>` from the entity's `StandardMaterial` via the slot name
  - Accesses `Assets<Image>` to get pixel data
  - Encodes to base64 PNG and returns via `CommandResponse`
  - This is a **query** (read-only), no pending queue needed

- `engine/src/bridge/query.rs` -- add `QueryRequest::TextureData { entity_id, slot }` variant

**No changes to core components, pending queues, or bridge systems.** Texture application already works via the existing `load_texture` command pipeline.

## Constraints

- **Provider dependency** -- Stability AI or equivalent inpainting API required. Meshy does full generation only (no inpainting). If no inpainting provider is configured, fall back to full regeneration with style-matching prompt
- **Texture resolution** -- max 2048x2048. Larger textures downsample for AI processing, then upscale result. Canvas2D compositing handles the final blend at original resolution
- **Base texture extraction** -- requires `get_texture_data` engine query. If the entity has no texture (only a flat color), generate a solid-color base image client-side
- **WebGL2 texture readback** -- `Assets<Image>` stores CPU-side data. No GPU readback needed
- **Latency** -- img2img takes 5-15 seconds depending on provider and resolution. Show progress via generation store
- **Token cost** -- 40 tokens per edit (more expensive than scalar material changes, cheaper than full 3D generation)
- **No mask in Phase 1** -- edits apply to the entire texture surface. Region masking is Phase 2

## Acceptance Criteria

- Given an entity with a metal texture, When user types "add rust spots", Then the base_color texture is modified with rust-colored patches while preserving the underlying metal pattern, within 15 seconds
- Given an entity with no texture (flat color), When user requests a texture edit, Then a solid-color base is generated and the edit is applied on top
- Given a texture edit, When user clicks undo, Then the previous texture is restored
- Given a strength of 0.3, When a texture edit is applied, Then the result is a subtle blend (30% edit, 70% original) visible in the viewport
- Given an AI chat message "make the floor look wet", When processed, Then `edit_entity_texture` is called targeting the floor entity's base_color slot with an appropriate description
- Given no inpainting provider configured (BYOK), When user requests an edit, Then falls back to full texture regeneration with a prompt that describes the desired modification

## Alternatives Considered

1. **Client-side diffusion model** -- Rejected: Stable Diffusion ONNX in WASM is 2GB+ and takes 30+ seconds per image on CPU. Server-side is mandatory for acceptable latency.
2. **Shader-based effects instead of texture editing** -- Rejected: shaders apply uniformly and cannot create localized modifications like "rust spots on the left side". True texture editing requires pixel-level changes.
3. **3D painting (projecting onto mesh)** -- Rejected for Phase 1: requires UV-aware projection, seam handling, and a more complex UI. 2D texture editing (treating the unwrapped texture as a flat image) is simpler and covers 80% of use cases. 3D projection could be Phase 3.
