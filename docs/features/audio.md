# Audio

Add sound effects and music with spatial 3D audio, mixer buses, and layered audio.

## Overview
Audio in Project Forge works via the Web Audio API. Each entity can have an audio source with controls for volume, pitch, looping, and spatial positioning. The audio mixer provides buses for grouping and processing sounds.

## Adding Audio

### Editor UI
1. Import an audio file via the Asset Panel (drag & drop `.mp3`, `.ogg`, or `.wav`)
2. Select an entity
3. In the Inspector, enable the **Audio** section
4. Select the imported audio asset

### MCP Commands
```json
{"command": "set_audio", "params": {
  "entityId": "entity_1",
  "assetId": "audio_001",
  "volume": 0.8,
  "pitch": 1.0,
  "loop": true,
  "spatial": true,
  "autoplay": false,
  "bus": "sfx"
}}
```

## Audio Properties

| Property | Range | Description |
|----------|-------|-------------|
| Volume | 0–1 | Playback volume |
| Pitch | 0.25–4.0 | Playback speed/pitch |
| Loop | bool | Repeat when finished |
| Spatial | bool | 3D positional audio |
| Autoplay | bool | Start playing on Play mode |
| Bus | string | Audio bus routing (master, sfx, music, ambient, ui) |
| Ref Distance | > 0 | Distance at full volume (spatial) |
| Max Distance | > 0 | Distance where sound is silent (spatial) |
| Rolloff Factor | > 0 | How quickly sound fades with distance |

## Playback Control
```json
{"command": "play_audio", "params": {"entityId": "entity_1"}}
{"command": "stop_audio", "params": {"entityId": "entity_1"}}
{"command": "pause_audio", "params": {"entityId": "entity_1"}}
```

## Audio Mixer

The mixer provides 5 default buses:
- **Master** — final output (all audio passes through)
- **SFX** — sound effects
- **Music** — background music
- **Ambient** — ambient sounds
- **UI** — interface sounds

### Bus Controls
```json
{"command": "set_audio_bus", "params": {"busName": "music", "volume": 0.6, "muted": false}}
```

### Effects Chains
Each bus can have effects: reverb, delay, EQ, compressor, distortion.
```json
{"command": "set_audio_bus_effects", "params": {
  "busName": "sfx",
  "effects": [
    {"type": "reverb", "decay": 1.5, "mix": 0.3},
    {"type": "compressor", "threshold": -12, "ratio": 4}
  ]
}}
```

## Audio Layering
Layer multiple audio sources on a single entity:
```json
{"command": "audio_add_layer", "params": {
  "entityId": "entity_1",
  "slotName": "footsteps",
  "assetId": "audio_footstep",
  "volume": 0.5,
  "loop": true
}}

{"command": "audio_crossfade", "params": {
  "fromEntityId": "entity_1",
  "toEntityId": "entity_2",
  "durationMs": 2000
}}
```

## Script API
```typescript
forge.audio.play(entityId);
forge.audio.stop(entityId);
forge.audio.setVolume(entityId, 0.5);
forge.audio.setPitch(entityId, 1.2);

// One-shot sound (fire and forget)
forge.audio.playOneShot("explosion_sound", {
  position: [0, 1, 0],
  bus: "sfx",
  volume: 0.8
});

// Crossfade between sources
forge.audio.crossfade(entity1, entity2, 1500);

// Bus control
forge.audio.setBusVolume("music", 0.3);
forge.audio.muteBus("sfx", true);
```

## Tips
- Spatial audio only works during **Play mode** — preview playback in Edit mode is non-spatial
- Use the **Music** bus for looping background tracks and **SFX** for one-shots
- Crossfades create smooth transitions between music tracks
- Import audio as `.ogg` for best compression/quality balance

## Related
- [Scripting](./scripting.md) — trigger sounds from scripts
- [Asset Pipeline](./asset-pipeline.md) — importing audio files
- [Export](./export.md) — audio is included in exports
