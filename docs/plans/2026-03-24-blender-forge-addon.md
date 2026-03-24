# Spec: Blender Add-on for .forge Scene Export

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-413
> **Scope:** Blender Python add-on that exports scenes to SpawnForge's `.forge` JSON format

## Problem

Artists use Blender for modeling and scene layout. Currently, the only import path into SpawnForge is glTF, which loses scene-level data (environment settings, physics config, audio, scripts). A direct `.forge` exporter lets artists author in Blender and bring complete scenes -- including entity hierarchy, materials mapped to SpawnForge's `MaterialData`, lights, and cameras -- directly into the editor.

## Solution

A **Blender Python add-on** (`spawnforge_exporter`) that:
1. Traverses the Blender scene graph.
2. Maps Blender objects to `EntitySnapshot` structures.
3. Converts Principled BSDF nodes to SpawnForge's `MaterialData` fields.
4. Exports a `.forge` JSON file matching `SceneFile` format version 1.
5. Optionally embeds mesh data as base64 glTF binary chunks (matching the existing asset pipeline).

The add-on is pure Python, distributed as a `.zip` installable via Blender's Preferences > Add-ons.

### Phase 1 -- Core Export (geometry, transforms, hierarchy)

**Add-on structure (`tools/blender-addon/spawnforge_exporter/`)**

1. `__init__.py` -- Add-on registration, `bl_info`, menu entry under File > Export > SpawnForge Scene (.forge).
2. `exporter.py` -- Main export operator. Walks `bpy.context.scene.objects`, builds `SceneFile` dict.
3. `entity_mapper.py` -- Maps Blender object types to `EntityType` variants:
   - `MESH` -> mesh entity (exports via `bpy.ops.export_scene.gltf` to buffer, base64-encodes)
   - `LIGHT` -> `Light` entity with `LightData` (point/directional/spot, color, intensity)
   - `CAMERA` -> skipped (SpawnForge has its own editor camera)
   - `EMPTY` -> `Empty` entity (used for hierarchy grouping)
4. `material_mapper.py` -- Converts Principled BSDF to `MaterialData`:
   - `Base Color` -> `color` (hex string)
   - `Metallic` -> `metallic` (0-1)
   - `Roughness` -> `roughness` (0-1)
   - `Emission Color` + `Emission Strength` -> `emissive` + `emissive_intensity`
   - Texture nodes -> exported as base64 PNG, referenced in `assets` map
5. `transform_mapper.py` -- Converts Blender's Z-up right-handed to SpawnForge/Bevy's Y-up right-handed coordinate system. Rotation: Blender quat `(w,x,y,z)` with axis swap.
6. `scene_builder.py` -- Assembles the final `SceneFile` JSON: metadata, environment (world background -> `EnvironmentSettings`), ambient light, entities list, assets map.

### Phase 2 -- Extended Data

7. Physics mapping: Blender rigid body settings -> `PhysicsData` (mass, body_type, collider shape).
8. Custom properties: `spawnforge_*` Blender custom props map to entity metadata (scripts, game components).
9. Collection hierarchy: Blender collections -> entity parent/child relationships.
10. Animation export: Blender keyframe actions -> SpawnForge `AnimationClipData` (position/rotation/scale tracks).

### Phase 3 -- Round-trip and Live Link

11. `.forge` importer: Import `.forge` files into Blender for round-trip editing.
12. Live link: WebSocket connection between Blender and running SpawnForge editor for real-time preview.
13. Batch export: Export multiple Blender scenes as a multi-scene `.forge` project.

## Coordinate System Mapping

```
Blender (Z-up, right-handed)    SpawnForge/Bevy (Y-up, right-handed)
X -> X                          X -> X
Y -> -Z                         Y -> Z (Blender)
Z -> Y                          Z -> -Y (Blender)

Position:  (x, y, z) -> (x, z, -y)
Rotation:  (w, x, y, z) -> (w, x, z, -y)
Scale:     (x, y, z) -> (x, z, y)
```

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Pure Python, no Rust | Blender add-ons must be Python; no native extension needed |
| Embed meshes as base64 glTF | Matches existing `import_gltf` pipeline; no new mesh format |
| Skip Blender camera | SpawnForge has its own editor camera; exporting it causes confusion |
| Principled BSDF only | Covers 95% of Blender materials; exotic shaders need manual remap |
| Zip distribution | Standard Blender add-on packaging; no pip dependencies needed |

## Constraints

- **Blender version:** Target 4.0+ (Python 3.11+, new extension system).
- **No Blender API in CI:** Tests use mock `bpy` module or run headless Blender.
- **Mesh size:** Large meshes (100K+ triangles) as base64 glTF can produce 50+ MB files. Add a "simplify before export" option.
- **Texture resolution:** Export textures at original resolution by default; add optional downscale (512, 1024, 2048).
- **No SpawnForge-specific features:** Physics, scripts, game components require custom properties -- document the convention.

## Acceptance Criteria

- Given a Blender scene with 5 meshes and a directional light, When the user exports to `.forge`, Then SpawnForge loads the file with all 5 meshes at correct positions and the light with matching color/intensity.
- Given a mesh with a Principled BSDF material (red, metallic=0.8, roughness=0.2), When exported, Then SpawnForge shows the material with matching color, metallic, and roughness values.
- Given a Blender hierarchy (Empty parent -> 3 child meshes), When exported, Then the `.forge` file preserves the parent-child relationship.
- Given a scene exported from Blender, When opened in SpawnForge and re-saved, Then the scene round-trips without data loss for supported features.

## Phase 1 Subtasks

1. Create add-on skeleton: `__init__.py` with `bl_info`, register/unregister, export menu entry
2. Implement `transform_mapper.py` with Z-up to Y-up coordinate conversion and tests
3. Implement `material_mapper.py` for Principled BSDF to MaterialData conversion
4. Implement `entity_mapper.py` mapping Blender object types to EntityType/EntitySnapshot
5. Implement `scene_builder.py` assembling full SceneFile JSON structure
6. Implement `exporter.py` main operator invoking the pipeline
7. Create test suite with mock bpy module validating exported JSON structure
8. Write user documentation: installation guide, supported features, custom property conventions
