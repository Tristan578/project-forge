# SpawnForge Engine API Reference

> Generated from `web/src/data/commands.json`. 350 commands across 41 categories.
> Last updated: 2026-03-30

## System Boundaries

| Layer | What runs there | Notes |
|-------|----------------|-------|
| Rust / WASM (Bevy ECS) | Physics simulation, rendering, transform math, particle GPU, CSG booleans, terrain noise | Single-threaded WASM, runs on the browser's main thread |
| JS / React (Web Audio API) | Audio playback, spatial audio nodes, bus routing, reverb | Rust stores `AudioData` metadata only; execution is JS-side |
| JS / Web Worker | TypeScript game scripts, forge.* API, sandbox watchdog | Rust stores `ScriptData` metadata only; execution is a dedicated worker |
| JS / React (Zustand) | Editor state, inspector panels, scene graph UI | Driven by events emitted from Rust bridge |

**Command flow:** `dispatchCommand()` in Zustand → `handle_command()` WASM export → `core/commands/` dispatch → `core/pending/` queue → Bevy drains next frame → `bridge/` emit systems → JS callback → Zustand store update → React re-render.

---

## Undo/Redo Coverage

Commands that modify entity state are undoable via the `UndoableAction` enum (29 variants). The following categories are always undoable: transform, material, lighting, physics, audio, particles, scripting, animation clips, sprites, physics2d, tilemap, skeleton2d, joints, CSG operations, terrain, mesh extrude/lathe/array/combine.

Commands that are **not** undoable: scene export/load, play/stop/pause/resume, query commands, editor settings (gizmo mode, snap), asset import.

---

## Transform Commands (scene category)

| Command | Description | Undo |
|---------|-------------|------|
| `spawn_entity` | Create a new entity (cube, sphere, plane, cylinder, cone, torus, capsule, point_light, directional_light, spot_light). Optional `name` and `position [x,y,z]`. | Yes |
| `despawn_entity` | Remove a single entity by `entityId`. | Yes |
| `delete_entities` | Batch delete by `entityIds[]`. | Yes |
| `duplicate_entity` | Copy an entity with position offset. | Yes |
| `update_transform` | Set position, rotation (degrees), and/or scale on an entity. All three fields optional. | Yes |
| `rename_entity` | Change display name. | Yes |
| `reparent_entity` | Move entity in the hierarchy. `newParentId: null` for root. | No |
| `set_visibility` | Show or hide an entity. | Yes |
| `select_entity` | Select one entity; modes: replace, add, toggle. | No |
| `select_entities` | Select multiple at once; modes: replace, add. | No |
| `clear_selection` | Deselect all. | No |
| `create_joint` | Create physics joint between two entities. Types: fixed, revolute, spherical, prismatic, rope, spring. | Yes |
| `update_joint` | Modify joint limits or motor settings. | Yes |
| `remove_joint` | Remove a joint by `jointId`. | Yes |

### Editor Controls (editor category)

| Command | Description | Undo |
|---------|-------------|------|
| `set_gizmo_mode` | Set transform gizmo mode: translate, rotate, scale. | No |
| `set_coordinate_mode` | World vs. local coordinate space. | No |
| `set_snap_settings` | Configure grid snap size and enable/disable. | No |
| `toggle_grid` | Show or hide the editor grid overlay. | No |
| `toggle_debug_physics` | Toggle Rapier debug wireframe rendering. | No |
| `set_project_type` | Switch between `2d` and `3d` project mode. | No |
| `set_grid_2d` | Configure 2D grid cell size and color. | No |

---

## Material Commands

**Rust-side:** `MaterialData` ECS component synced to Bevy `StandardMaterial` via `MeshMaterial3d`. Texture assets loaded from base64 data URL, stored in `TextureHandleMap`.

| Command | Description | Undo |
|---------|-------------|------|
| `update_material` | PBR material on an entity. Fields: `baseColor [r,g,b,a]`, `metallic`, `roughness`, `reflectance`, `emissive [r,g,b,a]`, `alphaMode` (Opaque/Blend/Mask), `doubleSided`, `unlit`, `uvOffset/Scale/Rotation`, parallax mapping, `clearcoat`, `specularTransmission`, `ior`, `attenuationColor`. | Yes |
| `apply_material_preset` | Apply one of 56 named presets (gold, glass, marble, leather, etc.) to an entity. | Yes |
| `set_custom_shader` | Apply a built-in shader effect (dissolve, hologram, force_field, lava_flow, toon, fresnel_glow, none). | Yes |
| `remove_custom_shader` | Revert entity to standard PBR. | Yes |
| `list_shaders` | List all built-in shader types. | No |
| `set_custom_wgsl_source` | Set scene-global WGSL shader code. WebGPU only; WebGL2 falls back to PBR. | No |
| `validate_wgsl` | Heuristic validation of WGSL source without applying. Returns success or error string. | No |
| `list_material_presets` | List all 56 built-in presets with metadata. | No |
| `save_material_to_library` | Save current entity material as a named custom preset. | No |
| `delete_library_material` | Remove a custom material from the library. | No |
| `list_custom_materials` | List user-saved materials. | No |

### Custom Shader Library (shaders category)

| Command | Description | Undo |
|---------|-------------|------|
| `register_custom_shader` | Register WGSL function body into slot 0-7. Triggers hot-reload. | No |
| `apply_custom_shader` | Apply a registered slot (1-8, 1-indexed) to an entity. | Yes |
| `remove_custom_shader_slot` | Clear a slot from the registry. | No |
| `create_shader_graph` | Create a node-based shader graph (visual scripting for shaders). | No |
| `add_shader_node` | Add a node to the shader graph. | No |
| `connect_shader_nodes` | Connect two shader nodes. | No |
| `compile_shader` | Compile shader graph to WGSL. | No |
| `apply_shader_to_entity` | Apply compiled shader to entity. | Yes |
| `list_shader_presets` | List available shader presets. | No |

---

## Physics Commands (3D)

**Rust-side:** `PhysicsData` + `PhysicsEnabled` ECS components, Rapier3D integration. `RapierConfiguration` is a Component (not Resource) in bevy_rapier3d 0.33.

| Command | Description | Undo |
|---------|-------------|------|
| `update_physics` (runtime) | Set physics body type, collider shape, mass, restitution, friction, gravity scale, CCD, sleeping. | Yes |
| `toggle_physics` | Enable or disable physics simulation on entity. | No |
| `apply_force` | Apply a continuous force vector. | No |
| `set_physics_force` | Set a persistent force on entity. | No |
| `raycast_query` | Cast a ray and return hit results (entityId, distance, normal). | No |
| `create_joint` | Create a physics joint (see Transform section). | Yes |
| `get_physics` (query) | Read current physics data for an entity. | No |

---

## Physics 2D Commands

**Rust-side:** `Physics2dData` + Rapier2D plugin. Separate from 3D physics.

| Command | Description | Undo |
|---------|-------------|------|
| `set_physics2d` | Configure 2D physics body: type, collider (box/circle/capsule/polygon/tilemap/sensor), density, friction, restitution, one-way platform, surface velocity. | Yes |
| `remove_physics2d` | Remove 2D physics from entity. | Yes |
| `get_physics2d` | Query current 2D physics data. | No |
| `set_gravity2d` | Set scene-wide 2D gravity vector. | No |
| `set_debug_physics2d` | Toggle Rapier2D debug wireframe. | No |
| `apply_force2d` | Apply 2D force vector to entity. | No |
| `apply_impulse2d` | Apply instant 2D impulse. | No |
| `raycast2d` | Cast a 2D ray, return hit info. | No |

---

## Audio Commands

**Execution is JS-side** using the Web Audio API. Rust stores `AudioData` metadata as ECS components.

| Command | Description | Undo |
|---------|-------------|------|
| `set_audio` | Attach audio to an entity: `url`, `volume`, `loop`, `spatial`, `bus`, `minDist`, `maxDist`. | Yes |
| `remove_audio` | Remove audio component from entity. | Yes |
| `play_audio` / `stop_audio` / `pause_audio` | Playback control. | No |
| `get_audio` | Read current audio settings. | No |
| `import_audio` | Import audio from URL or base64. | No |
| `create_audio_bus` | Create a named mixer bus with send/receive routing. | No |
| `update_audio_bus` | Update bus gain, EQ, and effects. | No |
| `delete_audio_bus` | Remove a bus. | No |
| `get_audio_buses` | List all buses. | No |
| `set_bus_effects` | Set reverb/delay/compression on a bus. | No |
| `audio_fade_in` / `audio_fade_out` | Fade with configurable duration. | No |
| `audio_crossfade` | Cross-fade between two audio sources. | No |
| `set_reverb_zone` | Spatial reverb zone (impulse response). | Yes |
| `remove_reverb_zone` | Remove reverb zone. | Yes |
| `set_adaptive_music` | Configure adaptive music stems. | No |
| `set_music_intensity` | Set music intensity level (0-1). | No |
| `set_music_stems` | Set multi-stem audio files for intensity layers. | No |
| `create_audio_snapshot` / `apply_audio_snapshot` | Save and restore mixer state. | No |
| `set_audio_occlusion` | Configure occlusion lowpass filter. | No |

---

## 2D Commands

### Sprite (sprite category)

**Rust-side:** `SpriteData` + Bevy `Sprite` component. `Camera2dData` + `OrthographicProjection`.

| Command | Description | Undo |
|---------|-------------|------|
| `create_sprite` | Create a new 2D sprite entity with texture. | Yes |
| `set_sprite_texture` | Set sprite texture by asset URL or base64. | Yes |
| `set_sprite_tint` | Set sprite color tint `[r,g,b,a]`. | Yes |
| `set_sprite_flip` | Flip horizontally or vertically. | Yes |
| `set_sprite_sorting` | Set sorting layer and order-in-layer. | Yes |
| `set_sprite_anchor` | Set sprite anchor point (center, top-left, etc.). | Yes |
| `get_sprite` | Query sprite data. | No |
| `set_sorting_layers` | Configure scene-wide sorting layer stack. | No |

### Sprite Animation (sprite_animation category)

**Rust-side:** `SpriteSheetData`, `AnimationStateMachine` ECS components.

| Command | Description | Undo |
|---------|-------------|------|
| `slice_sprite_sheet` | Slice a texture into atlas frames by columns/rows or pixel boundaries. | No |
| `create_sprite_anim_clip` | Create named animation clip from frame range. | No |
| `set_sprite_animator` | Attach animation state machine to entity. | No |
| `play_sprite_animation` | Play a named clip immediately. | No |
| `set_anim_state_machine` | Configure state transitions and parameters. | No |
| `set_anim_param` | Set a state machine parameter (bool, int, float, trigger). | No |

### Tilemap (tilemap category)

**Rust-side:** `TilesetData` / `TilemapData` ECS, tile sprites as `TextureAtlas` children.

| Command | Description | Undo |
|---------|-------------|------|
| `create_tilemap` | Create a new tilemap with width/height and cell size. | Yes |
| `import_tileset` | Load tileset texture and configure tile size. | No |
| `set_tile` | Place a tile at `(col, row)` on a layer. | Yes |
| `fill_tiles` | Flood-fill a region with a tile. | Yes |
| `clear_tiles` | Erase tiles in a region. | Yes |
| `add_tilemap_layer` | Add a new tile layer (background, foreground, collision). | No |
| `remove_tilemap_layer` | Remove a layer. | No |
| `set_tilemap_layer` | Configure layer properties (name, visible, z-offset). | No |
| `resize_tilemap` | Resize the tilemap (may truncate tiles). | No |
| `get_tilemap` | Query tilemap structure and layer data. | No |

### 2D Skeletal Animation (skeleton2d category)

**Rust-side:** `SkeletonData2d`, `SkeletalAnimation2d`, `BlendTree2d` ECS + IK solving, vertex skinning.

| Command | Description | Undo |
|---------|-------------|------|
| `create_skeleton2d` | Create a 2D skeleton on an entity. | Yes |
| `add_bone2d` / `remove_bone2d` / `update_bone2d` | Bone hierarchy management. | Yes |
| `create_skeletal_animation2d` | Create a new animation clip. | No |
| `add_keyframe2d` | Add a bone keyframe. | No |
| `play_skeletal_animation2d` | Play a named 2D animation clip. | No |
| `set_skeleton2d_skin` | Switch between named skins. | No |
| `create_ik_chain2d` | Set up IK chain from tip to root bone. | No |
| `get_skeleton2d` | Query skeleton data. | No |
| `auto_weight_skeleton2d` | Auto-compute bone weights from mesh. | No |
| `add_skeleton2d_mesh_attachment` | Attach a mesh to a bone slot. | No |
| `import_skeleton_json` | Import skeleton from JSON format. | No |

### Camera 2D (camera category)

| Command | Description | Undo |
|---------|-------------|------|
| `set_camera_2d` | Set orthographic camera zoom, position, bounds, and follow target. | No |

---

## 3D Commands

### Lighting (lighting category)

**Rust-side:** `LightData` ECS component (Point/Directional/Spot).

| Command | Description | Undo |
|---------|-------------|------|
| `update_light` | Set `color [r,g,b]`, `intensity` (lumens), `shadowsEnabled`, `shadowDepthBias`, range, type-specific params. | Yes |
| `update_ambient_light` | Set global ambient light color and intensity. | Yes |

### Environment (environment category)

**Rust-side:** `EnvironmentSettings` (ClearColor + `DistanceFog`).

| Command | Description | Undo |
|---------|-------------|------|
| `update_environment` | Set fog type (linear/exponential), fog color, density, near/far clip, clear color. | No |
| `set_skybox` | Apply a procedural skybox preset (Studio, Sunset, Overcast, Night, Bright Day). | No |
| `remove_skybox` | Remove the skybox, revert to clear color. | No |
| `update_skybox` | Modify skybox parameters (sun angle, sky/horizon color). | No |
| `set_custom_skybox` | Upload a custom HDR/EXR cubemap by URL or base64. | No |

### Post-Processing (rendering category)

**Rust-side:** `PostProcessingSettings` (Bloom, ChromAb, ColorGrade, Sharpen). SSAO is WebGPU only.

| Command | Description | Undo |
|---------|-------------|------|
| `update_post_processing` | Configure bloom (intensity, knee), chromatic aberration, color grading (gain/gamma/lift), sharpening strength, depth of field, SSAO, motion blur. | No |
| `get_post_processing` | Query current post-processing settings. | No |
| `set_quality_preset` | Apply Low/Medium/High/Ultra quality preset (MSAA, shadows, bloom, sharpening, particles). | No |
| `get_quality_settings` | Query current quality preset and settings. | No |

### 3D Camera (camera category)

| Command | Description | Undo |
|---------|-------------|------|
| `set_camera_preset` | Set editor camera mode: orbit, fly, top, front, right. | No |
| `focus_camera` | Focus camera on a specific entity or world position. | No |

### Game Cameras (game_cameras category)

| Command | Description | Undo |
|---------|-------------|------|
| `set_game_camera` | Configure game-mode camera: ThirdPerson, FirstPerson, SideScroller, TopDown, Fixed, Orbital. | No |
| `set_active_game_camera` | Switch active game camera entity. | No |
| `camera_shake` | Trigger a camera shake with magnitude and duration. | No |
| `get_game_camera` | Query game camera configuration. | No |

### Terrain (terrain category)

**Rust-side:** `TerrainData` (noise config) + `TerrainMeshData` (computed heightmap). Uses `noise` crate (Fbm+Perlin).

| Command | Description | Undo |
|---------|-------------|------|
| `spawn_terrain` | Spawn procedural terrain: width, depth, height scale, octaves, frequency, seed. | Yes |
| `update_terrain` | Update terrain noise parameters. | Yes |
| `sculpt_terrain` | Sculpt terrain at a world position with radius and strength. | Yes |
| `get_terrain` | Query terrain data. | No |

### Procedural Mesh (mesh category)

**Rust-side:** CSG via `csgrs 0.20` (BSP), extrude/lathe/combine via `ProceduralMeshData`.

| Command | Description | Undo |
|---------|-------------|------|
| `csg_union` | Boolean union of two mesh entities. Creates new entity. | Yes |
| `csg_subtract` | Boolean difference (A - B). | Yes |
| `csg_intersect` | Boolean intersection. | Yes |
| `extrude_shape` | Extrude a 2D polygon profile along an axis. | Yes |
| `lathe_shape` | Lathe a profile curve around an axis. | Yes |
| `array_entity` | Duplicate entity in a grid/circular/linear array. | Yes |
| `combine_meshes` | Merge multiple entity meshes into one (optimization). | Yes |
| `mesh_inset` / `mesh_bevel` / `mesh_loop_cut` / `mesh_delete` | Edit-mode mesh operations. | Yes |

### LOD / Performance (performance category)

**Rust-side:** QEM mesh simplification (Garland-Heckbert), `LodMeshes`, distance-based switching.

| Command | Description | Undo |
|---------|-------------|------|
| `set_entity_lod` | Manually configure LOD levels for an entity. | No |
| `generate_lods` | Auto-generate LOD levels using QEM simplification. | No |
| `set_performance_budget` | Set FPS/triangle/memory budget and enable warnings. | No |
| `get_performance_stats` | Read real-time fps/triangles/draw calls/memory. | No |
| `optimize_scene` | Auto-optimize: LOD generation + mesh combination. | No |
| `set_lod_distances` | Configure transition distances for LOD levels. | No |
| `set_simplification_backend` | Choose simplification algorithm. | No |

---

## Animation Commands (animation category)

**Rust-side:** GLTF animation registration, `AnimationClip` system, keyframe eval (position/rotation/scale/color).

| Command | Description | Undo |
|---------|-------------|------|
| `play_animation` | Play a named GLTF animation clip on entity. | No |
| `pause_animation` / `resume_animation` / `stop_animation` / `seek_animation` | Playback control. | No |
| `set_animation_speed` | Set playback speed multiplier. | No |
| `set_animation_loop` | Enable/disable looping. | No |
| `get_animation_state` | Query current clip, time, speed, loop. | No |
| `list_animations` | List all registered animation clips for an entity. | No |
| `set_animation_blend_weight` | Set blend weight for a clip in additive/blend graph. | No |
| `create_animation_clip` | Create a new keyframe animation clip. | Yes |
| `add_clip_keyframe` / `remove_clip_keyframe` / `update_clip_keyframe` | Manage keyframes (position, rotation, scale, color). | Yes |
| `set_clip_property` | Set clip duration, loop, easing mode. | Yes |
| `preview_clip` | Preview keyframe clip in the editor (play mode). | No |
| `get_animation_clip` | Query clip data. | No |
| `remove_animation_clip` | Delete a clip. | Yes |

---

## Scripting Commands

**Execution is JS-side** in a sandboxed Web Worker. Rust stores `ScriptData` metadata.

| Command | Description | Undo |
|---------|-------------|------|
| `set_script` | Attach TypeScript code to an entity. | Yes |
| `remove_script` | Remove script from entity. | Yes |
| `apply_script_template` | Apply a built-in script template. | Yes |
| `create_library_script` | Save script to the standalone library. | No |
| `update_library_script` / `delete_library_script` / `list_library_scripts` | Manage library. | No |
| `attach_script_to_entity` / `detach_script_from_entity` | Manage script attachment from library. | Yes |
| `set_visual_script` | Set visual script (node graph) on entity. | Yes |
| `get_visual_script` | Query visual script node graph. | No |
| `compile_visual_script` | Compile node graph to TypeScript. | No |
| `add_visual_script_node` / `connect_visual_script_nodes` | Visual script editing. | No |
| `get_script` (query) | Read current script source. | No |
| `list_script_templates` (query) | List built-in templates. | No |

---

## Particle Commands

**WebGPU:** `bevy_hanabi` GPU rendering. **WebGL2:** data stored only, not rendered.

| Command | Description | Undo |
|---------|-------------|------|
| `set_particle` | Configure particle system: rate, lifetime, speed, size, color, spread. | Yes |
| `remove_particle` | Remove particle system from entity. | Yes |
| `toggle_particle` | Enable or disable emission. | No |
| `set_particle_preset` | Apply a named preset: fire, smoke, sparks, rain, snow, explosion, magic, dust, trail. | Yes |
| `play_particle` / `stop_particle` | Start/stop emission. | No |
| `burst_particle` | Emit a one-shot burst of particles. | No |
| `get_particle` | Query particle configuration. | No |

---

## Scene / Project Commands

| Command | Description | Undo |
|---------|-------------|------|
| `export_scene` | Serialize scene to `.forge` JSON format. | No |
| `load_scene` | Deserialize and load a `.forge` JSON. | No |
| `new_scene` | Clear current scene, start fresh. | No |
| `create_scene` | Create a new named scene. | No |
| `switch_scene` | Switch to a different scene by name. | No |
| `duplicate_scene` | Clone a scene with a new name. | No |
| `delete_scene` | Remove a scene. | No |
| `rename_scene` | Rename the current or a named scene. | No |
| `set_start_scene` | Set which scene loads first on game start. | No |
| `list_scenes` | List all scenes in the project. | No |
| `load_scene_with_transition` | Switch scene with CSS transition (fade, wipe, instant). | No |
| `set_default_transition` | Set default scene transition effect. | No |
| `import_gltf` | Import a GLTF/GLB model by URL. | No |
| `load_texture` | Load a texture from URL or base64. | No |

---

## Game / Runtime Commands

| Command | Description | Undo |
|---------|-------------|------|
| `play` | Enter play mode (runs scripts, physics, animations). | No |
| `stop` | Exit play mode, restore to pre-play snapshot. | No |
| `pause` / `resume` | Pause/resume simulation. | No |
| `get_mode` | Query current engine mode (edit/play/paused). | No |
| `set_input_binding` | Map action name to a key. | No |
| `set_input_preset` | Apply input preset (FPS, Platformer, TopDown, Racing). | No |

### Game Components (game_components category)

Pre-built behavior components: CharacterController, Health, Collectible, Enemy, Spawner, Trigger, Score, Timer, Checkpoint, DoorLock, Platform, Projectile.

| Command | Description | Undo |
|---------|-------------|------|
| `add_game_component` | Attach a game component by type. | Yes |
| `update_game_component` | Update component parameters. | Yes |
| `remove_game_component` | Remove a game component. | Yes |
| `get_game_components` | List components on an entity. | No |
| `list_game_component_types` | List all available component types. | No |

---

## Dialogue System Commands

**JS-side:** `DialogueTree` store, 5 node types (text, choice, condition, action, end), runtime overlay.

| Command | Description | Undo |
|---------|-------------|------|
| `create_dialogue_tree` | Create a new named dialogue tree. | No |
| `add_dialogue_node` | Add a node to a tree. | No |
| `set_dialogue_choice` | Configure a choice branch. | No |
| `remove_dialogue_tree` | Delete a tree. | No |
| `get_dialogue_tree` | Query tree structure. | No |
| `set_dialogue_node_voice` | Attach voice audio to a node. | No |
| `export_dialogue_tree` / `import_dialogue_tree` | JSON serialization. | No |

---

## In-Game UI Builder Commands (ui category)

**JS-side:** 10 widget types (text, button, image, progressbar, slider, toggle, panel, grid, list, canvas).

| Command | Description | Undo |
|---------|-------------|------|
| `create_ui_screen` | Create a named UI screen layout. | No |
| `delete_ui_screen` | Remove a UI screen. | No |
| `list_ui_screens` | List all screens. | No |
| `get_ui_screen` | Query screen layout. | No |
| `update_ui_screen` | Modify screen properties (preset, background). | No |
| `add_ui_widget` | Add a widget to a screen. | No |
| `update_ui_widget` | Modify widget properties. | No |
| `remove_ui_widget` | Remove a widget. | No |
| `set_ui_binding` | Bind widget property to a forge.state key. | No |
| `remove_ui_binding` | Remove a binding. | No |
| `set_ui_theme` | Apply a color theme to a screen. | No |
| `duplicate_ui_screen` / `duplicate_ui_widget` / `reorder_ui_widget` | Layout helpers. | No |

---

## Publishing & Export Commands

| Command | Description | Undo |
|---------|-------------|------|
| `export_game` | Build standalone HTML export package. | No |
| `export_project_zip` | Export full project as ZIP. | No |
| `export_project_pwa` | Export as Progressive Web App. | No |
| `publish_game` | Publish to a shareable URL. | No |
| `unpublish_game` | Take down a published game. | No |
| `list_publications` | List user's published games. | No |
| `get_publish_url` | Get shareable URL for a published game. | No |

---

## AI Asset Generation Commands (generation category)

Integrates with Meshy (3D/texture), ElevenLabs (SFX/voice), Suno (music).

| Command | Description | Undo |
|---------|-------------|------|
| `generate_3d_model` | Generate GLTF from text prompt via Meshy. | No |
| `generate_texture` | Generate PBR texture maps from prompt. | No |
| `generate_sfx` | Generate sound effects via ElevenLabs. | No |
| `generate_voice` | Generate voice line from text + voice profile. | No |
| `generate_music` | Generate background music via Suno. | No |
| `generate_skybox` | Generate HDR skybox from prompt. | No |
| `generate_sprite` | Generate 2D sprite from prompt. | No |
| `generate_sprite_sheet` | Generate sprite sheet from prompt. | No |

---

## Query Commands

Read-only queries — never modify state, never undo.

| Command | Returns |
|---------|---------|
| `get_scene_graph` | Full entity tree with IDs, names, types, transforms |
| `get_entity_details` | Full snapshot of a single entity (all component data) |
| `get_selection` | Currently selected entity IDs |
| `get_camera_state` | Editor camera position, yaw, pitch, radius |
| `get_physics` | Physics data for an entity |
| `get_scene_name` | Current scene name |
| `list_assets` | All imported asset references |
| `get_script` | Script source code for entity |
| `get_token_balance` | User's remaining AI token credits |
| `query_play_state` | Current play/pause/stop mode |

---

## History Commands

| Command | Description |
|---------|-------------|
| `undo` | Undo the last undoable action. |
| `redo` | Redo the last undone action. |

---

## Compound AI Actions (compound category)

High-level multi-step operations — one call maps to many engine commands:

| Command | What it does |
|---------|-------------|
| `create_scene_from_description` | Spawns entities + materials + lights + positions from natural language description |
| `create_level_layout` | Creates level geometry, platforms, obstacles |
| `setup_character` | Entity + physics + game components + scripts |
| `configure_game_mechanics` | Sets up win/lose conditions, scoring, timer |
| `arrange_entities` | Repositions selected entities (grid, circle, random scatter) |
| `apply_style` | Applies consistent material + lighting style across scene |
| `describe_scene` | Returns natural language description of scene state |
| `analyze_gameplay` | Analyses entity setup and returns balance/UX suggestions |

---

## Prefab Commands (prefab category)

| Command | Description |
|---------|-------------|
| `save_as_prefab` | Save entity (and children) as a reusable template |
| `instantiate_prefab` | Spawn a prefab instance |
| `list_prefabs` | List all prefabs |
| `delete_prefab` | Remove a prefab template |
| `get_prefab` | Query prefab data |

---

## Game Templates (templates category)

| Command | Description |
|---------|-------------|
| `list_templates` | List 5 starter templates (platformer, runner, shooter, puzzle, explorer) |
| `load_template` | Load a starter template as the current scene |
| `get_template_info` | Get template description and entity count |

---

## Documentation Commands (docs category)

| Command | Description |
|---------|-------------|
| `search_docs` | BM25 full-text search across in-editor docs |
| `get_doc` | Retrieve a specific doc page by path |
| `list_doc_topics` | List all documentation categories and pages |
