# Particles

Create visual effects with GPU-accelerated particle systems.

## Overview
Particle systems emit streams of small sprites to create effects like fire, smoke, rain, sparks, and magic. On WebGPU, particles render on the GPU via bevy_hanabi for high performance. On WebGL2, particle data is stored but not rendered.

## Adding Particles

### Editor UI
1. Select an entity
2. In the Inspector, enable the **Particles** section
3. Choose a preset or customize parameters

### MCP Commands
```json
{"command": "set_particle_preset", "params": {"entityId": "entity_1", "preset": "fire"}}
{"command": "set_particle_enabled", "params": {"entityId": "entity_1", "enabled": true}}
```

## Presets

9 built-in presets:

| Preset | Description |
|--------|-------------|
| Fire | Flickering orange-red flame |
| Smoke | Rising grey smoke plumes |
| Sparks | Fast, bright yellow sparks |
| Rain | Falling droplets |
| Snow | Gentle falling snowflakes |
| Explosion | Burst of debris and fire |
| Magic Sparkle | Shimmering colorful particles |
| Dust | Floating dust motes |
| Trail | Particles that follow entity movement |

## Custom Parameters

| Property | Description |
|----------|-------------|
| Spawn Rate | Particles per second |
| Lifetime | How long each particle lives (seconds) |
| Initial Speed | Starting velocity range |
| Acceleration | Gravity/force applied to particles |
| Drag | Air resistance |
| Emission Shape | Sphere, circle, or point |
| Emission Radius | Size of the emission area |
| Start Color / End Color | Color over particle lifetime |
| Start Size / End Size | Size over particle lifetime |
| Simulation Space | Local (moves with entity) or Global (stays in world) |

### MCP Commands
```json
{"command": "update_particle", "params": {
  "entityId": "entity_1",
  "spawnRate": 50.0,
  "lifetime": 2.0,
  "speed": 3.0,
  "acceleration": [0, -2, 0],
  "drag": 0.1,
  "emissionShape": "sphere",
  "emissionRadius": 0.5,
  "startColor": [1.0, 0.5, 0.0, 1.0],
  "endColor": [1.0, 0.0, 0.0, 0.0],
  "startSize": 0.2,
  "endSize": 0.0,
  "simulationSpace": "global"
}}
```

## Script API
```typescript
// Apply a preset
forge.particles.setPreset(entityId, "explosion");

// Enable/disable emission
forge.particles.enable(entityId);
forge.particles.disable(entityId);

// Trigger a one-shot burst
forge.particles.burst(entityId);
```

## Playback Control
```json
{"command": "particle_play", "params": {"entityId": "entity_1"}}
{"command": "particle_stop", "params": {"entityId": "entity_1"}}
{"command": "particle_burst", "params": {"entityId": "entity_1"}}
```

## Tips
- GPU particles require **WebGPU** — they won't render on WebGL2 browsers
- Particles run during **Play mode** — use the Inspector preview to see them in Edit mode
- Explosion preset uses burst mode — it fires once and stops
- Trail preset works best with `simulationSpace: "global"` so particles stay behind as the entity moves
- Particle changes support **undo/redo**

## Related
- [Custom Shaders](./custom-shaders.md) — shader-based effects
- [Post-Processing](./post-processing.md) — bloom enhances bright particles
- [Scripting](./scripting.md) — trigger particles from scripts
