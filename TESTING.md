# Manual Test Cases

Manual verification checklist for user-facing features. Run these after major changes to ensure end-to-end functionality.

> **Automated tests:** 13,600+ unit tests (`cd web && npx vitest run`), 81 E2E tests (`cd web && npx playwright test`), 25 MCP tests (`cd mcp-server && npx vitest run`)

## Prerequisites

- WASM engine built (`./build_wasm.sh` or `.\build_wasm.ps1`)
- Dev server running (`cd web && npm run dev`)
- Open `http://spawnforge.localhost:1355/dev` (bypasses auth). Fallback: `http://localhost:3000/dev`

---

## Scene & Objects

### Spawn Entities
- [ ] Spawn each primitive (Cube, Sphere, Plane, Cylinder, Cone, Torus, Capsule) via toolbar
- [ ] Verify entity appears in scene hierarchy
- [ ] Verify transform gizmo appears on selection

### Delete / Duplicate
- [ ] Select entity → Delete → confirm removed from hierarchy and viewport
- [ ] Select entity → Duplicate → confirm new entity with offset position
- [ ] Undo delete → entity restored with same ID

### Rename / Reparent
- [ ] Double-click entity in hierarchy → rename → verify name updates
- [ ] Drag entity onto another in hierarchy → verify parent-child relationship

---

## Materials & Lighting

### PBR Material
- [ ] Select mesh → change base color → verify viewport updates
- [ ] Adjust metallic/roughness sliders → verify visual change
- [ ] Apply texture to base color slot → verify texture renders
- [ ] Apply material preset from library → verify applied correctly

### Lighting
- [ ] Spawn Point Light → verify illumination in viewport
- [ ] Spawn Directional Light → adjust direction → verify shadow direction changes
- [ ] Spawn Spot Light → adjust cone angle → verify cone visible

### Skybox
- [ ] Set skybox preset (Studio, Sunset, Overcast, Night, Bright Day)
- [ ] Verify environment reflection on metallic objects
- [ ] Remove skybox → verify reverts to clear color

---

## Physics (3D)

### Rigid Bodies
- [ ] Add physics to cube → enter Play mode → verify gravity
- [ ] Set body type to Static → verify stays in place during Play
- [ ] Apply force via script → verify entity moves

### Joints
- [ ] Create revolute joint between two entities → Play → verify hinge behavior
- [ ] Create spring joint → Play → verify elastic behavior

---

## 2D Engine

### Sprites
- [ ] Switch to 2D project type → verify orthographic camera
- [ ] Spawn sprite → assign texture → verify renders
- [ ] Change sorting layer → verify draw order changes

### Sprite Animation
- [ ] Add sprite sheet → configure frame count/timing → Play → verify animation cycles
- [ ] Set up animation state machine with transitions → verify state changes

### Tilemaps
- [ ] Create tilemap → select tile from palette → paint tiles
- [ ] Use fill tool → verify flood fill works
- [ ] Add second layer → paint on layer 2 → verify layering

### 2D Physics
- [ ] Add 2D physics to sprite → Play → verify gravity
- [ ] Add 2D joint between sprites → Play → verify constraint
- [ ] Enable debug rendering → verify collider outlines visible

### Skeletal 2D Animation
- [ ] Create skeleton → add bones → verify bone gizmos
- [ ] Create animation clip with keyframes → Play → verify interpolation
- [ ] Enable IK chain → drag end effector → verify chain follows

---

## Audio

### Playback
- [ ] Import audio file → attach to entity → Play → verify sound plays
- [ ] Verify spatial audio: move entity away from camera → volume decreases

### Bus Mixer
- [ ] Open Audio Mixer panel → create bus → route audio to bus
- [ ] Adjust bus volume → verify audio level changes
- [ ] Add reverb effect to bus → verify wet/dry mix

### Reverb Zones
- [ ] Create reverb zone → move entity inside → verify reverb applies
- [ ] Move entity outside zone → verify reverb removed

---

## Scripting

### Script Editor
- [ ] Attach script to entity → open Script Editor
- [ ] Write `forge.log("hello")` → Play → verify console output
- [ ] Use `forge.input.isKeyDown("w")` → Play → press W → verify response

### Script Library
- [ ] Save script to library → verify appears in Library tab
- [ ] Import script from library → verify attached to entity

---

## Shader Effects

### Built-in Effects
- [ ] Apply Dissolve effect → adjust progress → verify dissolve animation
- [ ] Apply Hologram effect → verify scan lines
- [ ] Apply Toon effect → verify cel-shading look

### Custom WGSL
- [ ] Open Custom WGSL editor → write fragment shader → Ctrl+Enter → verify compiles
- [ ] Apply custom shader to entity → verify visual effect in viewport
- [ ] Remove custom shader → verify reverts to standard material

---

## AI & Chat

### Chat Panel
- [ ] Open chat panel → send message → verify AI response
- [ ] Ask AI to "spawn a red cube" → verify entity created with red material
- [ ] Use @-mention to reference entity → verify context provided to AI

### Compound Actions
- [ ] Ask AI to "create a simple platformer level" → verify multiple entities spawned

---

## Game Systems

### Play Mode
- [ ] Enter Play mode → verify physics simulation starts
- [ ] Pause → verify simulation frozen
- [ ] Stop → verify scene restored to edit state

### Game Templates
- [ ] Create new project from Platformer template → verify entities and scripts loaded
- [ ] Enter Play mode → verify game mechanics work

### Dialogue System
- [ ] Create dialogue tree with choice nodes → Play → verify dialogue overlay
- [ ] Select choice → verify branching path followed

### Scene Transitions
- [ ] Create two scenes → add transition script → verify fade transition works

---

## Export & Publishing

### Game Export
- [ ] Export game as ZIP → extract → open index.html → verify game runs standalone

### Cloud Publishing
- [ ] Publish game → verify shareable URL generated
- [ ] Open published URL → verify game loads

---

## Post-Processing

- [ ] Enable Bloom → verify glow on bright objects
- [ ] Enable Chromatic Aberration → verify color fringing at edges
- [ ] Enable SSAO (WebGPU only) → verify ambient shadows in corners

---

## LOD & Performance

- [ ] Add LOD component to mesh → set distance thresholds
- [ ] Move camera away → verify LOD level changes (check inspector)
- [ ] Generate LODs → verify simplified meshes created
- [ ] Open Performance panel → verify FPS/triangle/draw call stats update in real-time

---

## Responsive & Mobile

- [ ] Resize browser to mobile width → verify compact layout activates
- [ ] Enter Play mode on mobile layout → verify touch controls appear
- [ ] Test virtual joystick → verify movement input works
