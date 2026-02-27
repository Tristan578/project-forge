# Keyframe Animation

A per-entity animation clip system that lets you record and playback changes to transform, material, and light properties over time, with easing control and multiple playback modes.

## Overview

Keyframe Animation lets you animate almost any numeric property of an entity by recording values at specific time positions (keyframes). The engine interpolates between keyframes during playback. Each entity can have one animation clip with multiple tracks — one per animated property.

## Using Keyframe Animation in the Editor

1. Select an entity in the **Scene Hierarchy**.
2. In the **Inspector Panel**, scroll to the **Keyframe Animation** section.
3. Click **Add Animation Clip** to create a new clip for this entity.
4. Set the **Duration** (in seconds) and choose a **Play Mode**.
5. Click **Add Track** to choose which property to animate.
6. Expand the track by clicking its header.
7. Click **+ Add Keyframe** on the track to add a new keyframe. Enter the time and value.
8. Repeat for as many keyframes as needed.
9. Click **Preview** to watch the animation in the editor. Click **Stop** to reset.

## Clip Properties

| Property | Description |
|---|---|
| Duration (s) | Total length of the animation clip |
| Play Mode | Once (plays to the end and stops), Loop (repeats), Ping Pong (plays forward then backward) |
| Speed | Playback rate multiplier (0.1x - 5.0x) |
| Autoplay | Start playing automatically when the game enters Play mode |

## Animatable Properties (Tracks)

### Transform
| Track | Description |
|---|---|
| Position X/Y/Z | World position on each axis |
| Rotation X/Y/Z | Euler rotation on each axis (degrees) |
| Scale X/Y/Z | Scale on each axis |

### Material
| Track | Description |
|---|---|
| Base Color R/G/B/A | RGBA channels of the surface color |
| Emissive R/G/B | RGB channels of the emissive glow |
| Metallic | Metallic value (0-1) |
| Roughness | Roughness value (0-1) |
| Opacity | Transparency (0-1) |

### Light
| Track | Description |
|---|---|
| Intensity | Light brightness |
| Color R/G/B | RGB channels of the light color |
| Range | Light radius |

## Keyframe Properties

Each keyframe on a track has three values:

| Field | Description |
|---|---|
| Time | Time in seconds where this keyframe occurs (read-only after creation) |
| Value | The property value at this time |
| Interpolation | How to transition from this keyframe to the next |

### Interpolation Modes

| Mode | Description |
|---|---|
| Step | No interpolation — snaps instantly at the keyframe time |
| Linear | Straight-line interpolation between values |
| Ease In | Slow start, fast end |
| Ease Out | Fast start, slow end |
| Ease In/Out | Slow at both ends, fast in the middle |

## Script API

```typescript
// Play an animation clip by name (cross-fade from current over 0.2s)
forge.animation.play(entityId, "bounce", 0.2);

// Pause and resume
forge.animation.pause(entityId);
forge.animation.resume(entityId);

// Stop all animations
forge.animation.stop(entityId);

// Change playback speed
forge.animation.setSpeed(entityId, 2.0);

// Toggle looping
forge.animation.setLoop(entityId, true);

// List all clips on this entity
const clips = forge.animation.listClips(entityId);
```

## Tips

- For a floating coin animation, use a **Position Y** track with two keyframes: 0s at Y=1.0 and 0.8s at Y=1.4, with **Ease In/Out** interpolation on both, and **Ping Pong** play mode.
- You can animate a light's **Intensity** track between 0 and 1500 with **Loop** mode to create a flickering flame effect.
- Combine keyframe animation with the **Autoplay** setting so your scene immediately looks alive when you enter play mode.
