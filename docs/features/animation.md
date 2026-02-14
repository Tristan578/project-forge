# Animation

Play and blend skeletal animations from imported glTF models.

## Overview
Project Forge supports skeletal animation playback from glTF/GLB files. Import an animated model, and its animation clips become available for playback, crossfading, and blending.

## Importing Animated Models

1. Drag a `.glb` or `.gltf` file into the Asset Panel
2. The model spawns in the scene with its animations registered

## Animation Inspector

When you select an entity with animations, the Inspector shows the **Animation** section:
- **Clip Dropdown** — select which animation to play
- **Play / Pause / Stop** buttons
- **Speed** slider (0.1x – 3.0x)
- **Loop** toggle
- **Blend Weights** — per-clip weight sliders for blending multiple animations

## MCP Commands
```json
{"command": "play_animation", "params": {"entityId": "entity_1", "clipName": "Walk", "crossfadeSecs": 0.3}}
{"command": "pause_animation", "params": {"entityId": "entity_1"}}
{"command": "stop_animation", "params": {"entityId": "entity_1"}}
{"command": "set_animation_speed", "params": {"entityId": "entity_1", "speed": 1.5}}
{"command": "set_animation_loop", "params": {"entityId": "entity_1", "looping": true}}
{"command": "set_animation_blend_weight", "params": {"entityId": "entity_1", "clipName": "Walk", "weight": 0.7}}
{"command": "set_clip_speed", "params": {"entityId": "entity_1", "clipName": "Run", "speed": 1.2}}
{"command": "crossfade_animation", "params": {"entityId": "entity_1", "fromClip": "Walk", "toClip": "Run", "durationSecs": 0.5}}
```

## Script API
```typescript
forge.animation.play(entityId, "Walk", 0.3);  // Play with crossfade
forge.animation.pause(entityId);
forge.animation.stop(entityId);
forge.animation.setSpeed(entityId, 1.5);
forge.animation.setLoop(entityId, true);

// Blending
forge.animation.setBlendWeight(entityId, "Walk", 0.5);
forge.animation.setBlendWeight(entityId, "Run", 0.5);
forge.animation.setClipSpeed(entityId, "Run", 1.2);

// List available clips
const clips = forge.animation.listClips(entityId);
```

## Tips
- Animation clips come from the glTF file — you can't create new clips in the editor
- **Crossfade** creates smooth transitions between clips (e.g., Walk → Run)
- **Blend weights** let you mix multiple animations simultaneously (e.g., upper body attack + lower body walk)
- Speed can be set globally (all clips) or per-clip
- Animations play during **Play mode** only

## Related
- [Asset Pipeline](./asset-pipeline.md) — importing glTF models
- [Scripting](./scripting.md) — script-driven animation control
