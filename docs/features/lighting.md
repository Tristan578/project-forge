# Lighting

Illuminate your scene with point, directional, and spot lights plus ambient lighting and fog.

## Overview
Lighting defines the mood and visibility of your scene. Project Forge supports three light types plus global ambient light and distance fog.

## Light Types

| Type | Icon | Behavior | Use For |
|------|------|----------|---------|
| Point Light | Bulb | Emits in all directions from a point | Lamps, torches, fireflies |
| Directional Light | Sun | Parallel rays from infinite distance | Sunlight, moonlight |
| Spot Light | Cone | Focused cone of light | Flashlights, stage lights |

## Adding Lights

### Editor UI
Click **+** in the sidebar → choose light type. The light appears at the world origin.

### MCP Commands
```json
{"command": "spawn_entity", "params": {"entityType": "point_light", "name": "Torch"}}
{"command": "spawn_entity", "params": {"entityType": "directional_light", "name": "Sun"}}
{"command": "spawn_entity", "params": {"entityType": "spot_light", "name": "Flashlight"}}
```

## Light Properties

Select a light entity to see its properties in the Inspector:

| Property | Applies To | Description |
|----------|-----------|-------------|
| Color | All | Light color (RGB) |
| Intensity | All | Brightness (lumens for point/spot, lux for directional) |
| Range | Point, Spot | Maximum distance of illumination |
| Shadows | All | Enable/disable shadow casting |
| Spot Angle (Inner) | Spot | Inner cone angle (full brightness) |
| Spot Angle (Outer) | Spot | Outer cone angle (falloff edge) |

## MCP Commands
```json
{"command": "update_light", "params": {
  "entityId": "entity_1",
  "color": [1.0, 0.9, 0.8],
  "intensity": 1500.0,
  "range": 20.0,
  "shadows": true
}}
```

## Ambient Light
Global fill light that illuminates all surfaces equally. Set in Scene Settings:

```json
{"command": "set_ambient_light", "params": {"color": [0.2, 0.2, 0.3], "intensity": 0.5}}
```

## Environment Settings
Configure the scene background and atmospheric effects:

```json
{"command": "set_environment", "params": {
  "clearColor": [0.1, 0.1, 0.15, 1.0],
  "fogEnabled": true,
  "fogColor": [0.5, 0.5, 0.6, 1.0],
  "fogStart": 20.0,
  "fogEnd": 100.0
}}
```

## Tips
- A scene needs at least one light source — without it, everything appears black
- Directional lights work best for outdoor scenes; point lights for indoor
- Shadows are more expensive for point lights (6 shadow maps) than directional (1 shadow map)
- Use ambient light sparingly — too much flattens the scene
- Fog adds depth but can hide distant objects

## Related
- [Materials](./materials.md) — how surfaces react to light
- [Post-Processing](./post-processing.md) — bloom makes bright lights glow
- [Scene Management](./scene-management.md) — spawning light entities
