# Prefabs

Reusable entity templates — save any configured entity as a prefab and place identical copies anywhere in your scene with a single click.

## Overview

A Prefab is a snapshot of an entity's configuration: its shape, material, physics settings, script, audio, and particle setup. Once saved, a prefab lives in the **Prefab Panel** and can be instantiated repeatedly. Prefabs are stored in your browser's local storage and persist across sessions. The editor also ships with eight built-in prefabs to use as starting points.

## Using Prefabs in the Editor

### Placing a Prefab
1. Open the **Prefab Panel** from the left sidebar or panel menu.
2. Browse or search the prefab list. Built-in prefabs appear at the top.
3. Click a prefab to place it in the scene at the origin, or drag it into the viewport.

### Saving an Entity as a Prefab
1. Select an entity in the **Scene Hierarchy**.
2. Right-click the entity and choose **Save as Prefab**, or click the **Save as Prefab** button in the Inspector Panel's header area.
3. Give the prefab a name, category, and optional description.
4. Click **Save**. The prefab appears in the Prefab Panel immediately.

### Managing Prefabs
- Use the search bar in the Prefab Panel to filter by name.
- Click the trash icon on a custom prefab to delete it. Built-in prefabs cannot be deleted.
- Prefabs can be exported as JSON and imported into other projects via the panel's import/export buttons.

## Built-in Prefabs

| Name | Category | Description |
|---|---|---|
| Basic Player | Characters | Capsule with physics and a character controller script |
| Spinning Collectible | Items | Rotating torus with gold metallic material and a spin script |
| Physics Crate | Props | Wooden cube with dynamic physics and realistic friction |
| Warm Light | Lights | Point light with warm orange-white color and shadows enabled |
| Patrol Enemy | Characters | Red sphere with a patrol-between-waypoints script and physics |
| Bouncy Ball | Props | Small sphere with very high restitution (0.95) for bouncing |
| Glass Panel | Props | Transparent plane with specular transmission and double-sided rendering |
| Fire Effect | Effects | Invisible emitter entity with the fire particle preset pre-configured |

## What a Prefab Stores

A prefab snapshot captures:

- Entity type (cube, sphere, capsule, etc.)
- Entity name
- Transform (position, rotation, scale)
- Material properties
- Light properties (for light entities)
- Physics configuration (body type, collider, restitution, friction, etc.)
- Script source code and enabled state
- Audio configuration
- Particle configuration

The entity's position in the prefab snapshot is used as the default spawn position when placing. You can move the placed instance afterward like any normal entity.

## Tips

- Organize custom prefabs with descriptive category names (for example, "Enemies", "Platforms", "UI Props") so you can find them quickly as your library grows.
- Prefabs are not linked — editing a placed instance does not update the prefab, and updating the prefab does not change already-placed instances. Think of them as stamps, not live references.
- Export your prefab library to JSON and import it into new projects to carry your reusable building blocks across games.
