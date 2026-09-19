# Spec Template

Copy this template when creating a new feature spec. Save as `specs/YYYY-MM-DD-<feature-name>.md`.

---

```markdown
# Spec: <Feature Name>

> **Status:** DRAFT
> **Date:** YYYY-MM-DD
> **Ticket:** PF-XXXX

## Problem

What user problem does this solve? Why now? What breaks or is missing without it?

Example:
> Users cannot adjust per-entity audio reverb from the inspector. There's no way for the
> AI to control spatial audio feel. Reverb zones exist in-engine but have no UI or MCP commands.

## Solution

High-level approach. One or two paragraphs. Reference existing patterns where possible.

Example:
> Add a `ReverbZone` ECS component with shape (Box/Sphere/Global) and standard reverb
> parameters (decay, pre-delay, diffusion, wet/dry). Follow the existing AudioData pattern —
> Rust stores the metadata, JS plays back using the Web Audio API reverb node.

## Design

### Rust Changes

List components, commands, pending queues, bridge systems to add/modify.

**New ECS component** (`engine/src/core/reverb_zone.rs`):
```rust
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
pub struct ReverbZoneData {
    pub shape: ReverbShape,
    pub decay_time: f32,  // seconds
    pub pre_delay: f32,   // ms
    pub diffusion: f32,   // 0.0–1.0
    pub wet_mix: f32,     // 0.0–1.0
    pub enabled: bool,
}
```

**New commands**: `set_reverb_zone`, `remove_reverb_zone`
**Pending queue**: `engine/src/core/pending/audio.rs` (extend existing)
**Bridge system**: `engine/src/bridge/audio.rs` `apply_reverb_zone_updates()`

Data flow:
```
JS: dispatchCommand('set_reverb_zone', { entityId, shape: 'sphere', decayTime: 2.0 })
  → core/commands/audio.rs dispatch()
  → queue_reverb_zone_update_from_bridge()
  → bridge/audio.rs apply_reverb_zone_updates()
  → emit_reverb_zone_changed()
  → JS store → ReverbZoneInspector re-render
```

### Web Changes

- **Store slice**: Extend `audioSlice.ts` with `reverbZoneMap`
- **Event handler**: Add `REVERB_ZONE_CHANGED` in `audioEvents.ts`
- **Chat handler**: `reverbZoneHandlers.ts` with `set_reverb_zone` and `remove_reverb_zone`
- **Inspector**: New `ReverbZoneInspector.tsx` component
- **InspectorPanel**: Render when entity has `ReverbZoneData`

### WGSL Changes

None required — reverb is processed by the Web Audio API in JS, not the Bevy renderer.

## Constraints

- Maximum 50 reverb zones per scene (performance — each adds a Web Audio ConvolverNode)
- No reverb support in WebGL2 export builds (Web Audio is JS-only, not engine-side)
- Reverb zones do not support per-material channel routing in this phase

## Acceptance Criteria

- Given an entity exists in the scene, When I add a ReverbZoneData component via the inspector, Then a reverb zone appears with default parameters
- Given a reverb zone entity is selected, When I adjust the decay time slider, Then the Web Audio reverb node updates in real time
- Given a reverb zone exists, When I use the AI to say "add reverb to this room", Then the AI calls `set_reverb_zone` with appropriate parameters
- Given a reverb zone has been added, When I press Ctrl+Z, Then the reverb zone is removed (undo works)
- Given a .forge scene with a reverb zone, When I export the game, Then the reverb zone data is included in the export bundle

## Test Plan

- Unit: `audioSlice.test.ts` — verify reverb zone state updates
- Unit: `reverbZoneHandlers.test.ts` — verify arg validation and dispatch
- Unit: `audioEvents.test.ts` — verify REVERB_ZONE_CHANGED event handling
- Manual: Add reverb zone in inspector, verify audio effect in Play mode
- Manual: Undo/redo reverb zone addition

## Alternatives Considered

**Use a global reverb setting (not per-entity)**
Rejected: designers need per-room control in large scenes. Global reverb is too blunt.

**Use bevy_audio spatial audio instead of Web Audio API**
Rejected: bevy_audio's spatial audio has limitations in WASM; the existing Web Audio pattern gives us full ConvolverNode control.
```

---

## Required Sections Checklist

When using `validate-spec.sh`, these sections must be present:

| Section | Required | Notes |
|---------|----------|-------|
| Problem | Yes | Why does this feature exist? |
| Solution | Yes | High-level approach, reference existing patterns |
| Acceptance Criteria | Yes | Must use Given/When/Then format |
| Test Plan | Yes | At minimum: unit test files to create/modify |
| Design | Recommended | Rust + Web + WGSL breakdown |
| Constraints | Recommended | What won't this do? Limits? |
| Alternatives Considered | Recommended | What else was evaluated? |

## Naming Convention

```
specs/YYYY-MM-DD-<kebab-case-feature-name>[-v2].md
```

Examples:
- `specs/2026-03-25-reverb-zones.md`
- `specs/2026-03-31-game-creation-orchestrator-phase2a-v4.md`

## Validate Your Spec

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/validate-spec.sh" specs/your-spec.md
```
