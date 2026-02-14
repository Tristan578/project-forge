# Script API Reference

Complete reference for the `forge.*` TypeScript API available in entity scripts.

## Global Variables

| Variable | Type | Description |
|----------|------|-------------|
| `entityId` | `string` | The ID of the entity this script is attached to |

## Lifecycle Functions

| Function | Called When | Parameter |
|----------|-----------|-----------|
| `onStart()` | Play mode starts | — |
| `onUpdate(dt)` | Every frame | `dt`: seconds since last frame |
| `onDestroy()` | Play mode stops | — |

## forge (Core)

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.getTransform(entityId)` | `{position, rotation, scale} \| null` | Get entity transform |
| `forge.setPosition(entityId, x, y, z)` | `void` | Set absolute position |
| `forge.setRotation(entityId, x, y, z)` | `void` | Set absolute rotation (euler degrees) |
| `forge.translate(entityId, dx, dy, dz)` | `void` | Move relative to current position |
| `forge.rotate(entityId, dx, dy, dz)` | `void` | Rotate relative to current rotation |
| `forge.spawn(type, options?)` | `string` | Spawn entity, returns its ID. Options: `{name?, position?}` |
| `forge.destroy(entityId)` | `void` | Remove an entity |
| `forge.log(message)` | `void` | Log to console |
| `forge.warn(message)` | `void` | Log warning |
| `forge.error(message)` | `void` | Log error |

## forge.input

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.input.isPressed(action)` | `boolean` | Is action held this frame? |
| `forge.input.justPressed(action)` | `boolean` | Was action pressed this frame? |
| `forge.input.justReleased(action)` | `boolean` | Was action released this frame? |
| `forge.input.getAxis(action)` | `number` | Axis value (-1 to 1) |

## forge.physics

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.physics.applyForce(entityId, fx, fy, fz)` | `void` | Apply continuous force |
| `forge.physics.applyImpulse(entityId, fx, fy, fz)` | `void` | Apply instant impulse |
| `forge.physics.setVelocity(entityId, vx, vy, vz)` | `void` | Set linear velocity directly |

## forge.audio

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.audio.play(entityId)` | `void` | Start playback |
| `forge.audio.stop(entityId)` | `void` | Stop playback |
| `forge.audio.pause(entityId)` | `void` | Pause playback |
| `forge.audio.setVolume(entityId, volume)` | `void` | Set volume (0–1) |
| `forge.audio.setPitch(entityId, pitch)` | `void` | Set pitch (0.25–4.0) |
| `forge.audio.isPlaying(entityId)` | `boolean` | Check playback state |
| `forge.audio.setBusVolume(bus, volume)` | `void` | Set bus volume |
| `forge.audio.muteBus(bus, muted)` | `void` | Mute/unmute bus |
| `forge.audio.getBusVolume(bus)` | `number` | Get bus volume |
| `forge.audio.isBusMuted(bus)` | `boolean` | Check bus mute state |
| `forge.audio.addLayer(entityId, slot, assetId, opts?)` | `void` | Add layered audio |
| `forge.audio.removeLayer(entityId, slot)` | `void` | Remove layer |
| `forge.audio.removeAllLayers(entityId)` | `void` | Remove all layers |
| `forge.audio.crossfade(from, to, durationMs)` | `void` | Crossfade between sources |
| `forge.audio.playOneShot(assetId, opts?)` | `void` | Fire-and-forget sound |
| `forge.audio.fadeIn(entityId, durationMs)` | `void` | Fade in audio |
| `forge.audio.fadeOut(entityId, durationMs)` | `void` | Fade out audio |

## forge.particles

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.particles.setPreset(entityId, preset)` | `void` | Apply particle preset |
| `forge.particles.enable(entityId)` | `void` | Enable emission |
| `forge.particles.disable(entityId)` | `void` | Disable emission |
| `forge.particles.burst(entityId)` | `void` | Trigger one-shot burst |

## forge.animation

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.animation.play(entityId, clip, crossfade?)` | `void` | Play animation clip |
| `forge.animation.pause(entityId)` | `void` | Pause animation |
| `forge.animation.resume(entityId)` | `void` | Resume paused animation |
| `forge.animation.stop(entityId)` | `void` | Stop all animations |
| `forge.animation.setSpeed(entityId, speed)` | `void` | Set global speed |
| `forge.animation.setLoop(entityId, loop)` | `void` | Set looping |
| `forge.animation.setBlendWeight(entityId, clip, weight)` | `void` | Set clip blend weight |
| `forge.animation.setClipSpeed(entityId, clip, speed)` | `void` | Set per-clip speed |
| `forge.animation.listClips(entityId)` | `string[]` | List available clips |

## forge.time

| Property | Type | Description |
|----------|------|-------------|
| `forge.time.delta` | `number` | Seconds since last frame |
| `forge.time.elapsed` | `number` | Seconds since Play started |

## forge.state

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.state.get(key)` | `any` | Get shared state value |
| `forge.state.set(key, value)` | `void` | Set shared state value |
