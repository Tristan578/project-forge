# Script API Reference

Complete reference for the `forge.*` TypeScript API available in entity scripts.
The authoritative type definitions live in
`web/src/lib/scripting/forgeTypes.ts` — this document mirrors them namespace for
namespace. If you add a method there, add it here (a parity test guards the
namespace set).

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
| `forge.setColor(entityId, r, g, b, a?)` | `void` | Set base color (RGBA, 0–1 range) |
| `forge.setVisibility(entityId, visible)` | `void` | Show or hide an entity |
| `forge.setEmissive(entityId, r, g, b, intensity?)` | `void` | Set emissive glow (RGB + intensity) |

## forge.scene

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.scene.getEntities()` | `Array<{id, name, type, position}>` | All entities in the scene |
| `forge.scene.findByName(name)` | `string[]` | IDs whose name contains `name` (case-insensitive) |
| `forge.scene.findByNameExact(name)` | `string[]` | IDs whose name exactly matches (case-sensitive) |
| `forge.scene.getEntityName(entityId)` | `string \| null` | Entity display name |
| `forge.scene.getEntityType(entityId)` | `string \| null` | Entity type (e.g. `"cube"`, `"point_light"`) |
| `forge.scene.getEntitiesInRadius(position, radius)` | `string[]` | IDs within `radius` of a world position |
| `forge.scene.reset()` | `void` | Stop play mode (return to edit) |
| `forge.scene.load(sceneName, transition?)` | `void` | Load another scene (play mode only) |
| `forge.scene.restart()` | `void` | Restart the current scene |
| `forge.scene.getCurrent()` | `string` | Current scene name |
| `forge.scene.getAll()` | `string[]` | All scene names |

`transition` is `Partial<{ type: 'fade'｜'wipe'｜'instant'; duration; color; direction: 'left'｜'right'｜'up'｜'down'; easing }>`.

## forge.input

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.input.isPressed(action)` | `boolean` | Is action held this frame? |
| `forge.input.justPressed(action)` | `boolean` | Was action pressed this frame? |
| `forge.input.justReleased(action)` | `boolean` | Was action released this frame? |
| `forge.input.getAxis(action)` | `number` | Axis value (−1 to 1) |
| `forge.input.isTouchDevice()` | `boolean` | Does the current device support touch? |
| `forge.input.vibrate(pattern)` | `void` | Trigger haptic feedback (vibration pattern in ms) |

## forge.physics

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.physics.applyForce(entityId, fx, fy, fz)` | `void` | Apply continuous force |
| `forge.physics.applyImpulse(entityId, fx, fy, fz)` | `void` | Apply instant impulse |
| `forge.physics.setVelocity(entityId, vx, vy, vz)` | `void` | Set linear velocity directly |
| `forge.physics.isGrounded(entityId)` | `boolean` | Whether the kinematic character controller last reported ground contact. Synchronous — 3D ground contact falls out of the character sweep the engine already ran, so unlike the 2D version it needs no raycast. `false` for an entity with no character controller |
| `forge.physics.getContacts(entityId, radius?)` | `string[]` | IDs currently in contact (radius overrides collider size) |
| `forge.physics.distanceTo(a, b)` | `number` | Distance between two entities |
| `forge.physics.onCollisionEnter(entityId, cb)` | `void` | Callback on collision start; `cb(otherEntityId)` |
| `forge.physics.onCollisionExit(entityId, cb)` | `void` | Callback on collision end; `cb(otherEntityId)` |
| `forge.physics.offCollision(entityId)` | `void` | Remove all collision callbacks for this entity |

## forge.physics2d

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.physics2d.applyForce(entityId, forceX, forceY)` | `void` | Apply continuous force (2D) |
| `forge.physics2d.applyImpulse(entityId, impulseX, impulseY)` | `void` | Apply instant impulse (2D) |
| `forge.physics2d.setVelocity(entityId, vx, vy)` | `void` | Set linear velocity (2D) |
| `forge.physics2d.getVelocity(entityId)` | `{x, y} \| null` | Current velocity (2D) |
| `forge.physics2d.setAngularVelocity(entityId, omega)` | `void` | Set angular velocity (rad/s) |
| `forge.physics2d.getAngularVelocity(entityId)` | `number \| null` | Current angular velocity (rad/s) |
| `forge.physics2d.raycast(ox, oy, dx, dy, maxDistance?)` | `Promise<hit \| null>` | First hit `{entityId, entityName, point, normal, distance}` |
| `forge.physics2d.isGrounded(entityId, distance?)` | `Promise<boolean>` | Downward-raycast ground check. **Returns a Promise** — `await` it. The 3D `forge.physics.isGrounded(entityId)` of the same name is synchronous; see the note below |
| `forge.physics2d.setGravity(x, y)` | `void` | Set global gravity (default `[0, −9.81]`) |
| `forge.physics2d.onCollisionEnter(cb)` | `() => void` | Collision-start callback; returns an unsubscribe fn |
| `forge.physics2d.onCollisionExit(cb)` | `() => void` | Collision-end callback; returns an unsubscribe fn |

> **`isGrounded` has two different contracts.** `forge.physics.isGrounded(entityId)`
> (3D) is **synchronous** and returns a `boolean`; `forge.physics2d.isGrounded(entityId, distance?)`
> (2D) is **asynchronous** and returns a `Promise<boolean>`. They differ because
> the answers come from different places: in 3D the engine already computes
> ground contact inside the character sweep each frame and pushes the changes to
> the script sandbox, while in 2D the answer requires a fresh downward raycast
> that has to round-trip to the engine.
>
> The failure is silent in both directions. Calling the 2D version without
> `await` yields a Promise, which is always truthy — the character can jump in
> mid-air forever. Writing `await` in front of the 3D version is harmless but
> reads as though it could ever be pending. Check which project type your script
> is running in, not which name looks familiar.

## forge.tilemap

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.tilemap.getTile(tilemapId, x, y, layer?)` | `number \| null` | Tile index at position (null if empty/out of bounds) |
| `forge.tilemap.setTile(tilemapId, x, y, tileId, layer?)` | `void` | Paint one tile; `null` erases it instead |
| `forge.tilemap.fillRect(tilemapId, x, y, w, h, tileId, layer?)` | `void` | Fill a `w`×`h` region in one command; `null` erases the region |
| `forge.tilemap.clearTile(tilemapId, x, y, layer?)` | `void` | Erase a single tile |
| `forge.tilemap.worldToTile(tilemapId, worldX, worldY)` | `[number, number]` | World → tile coordinates |
| `forge.tilemap.tileToWorld(tilemapId, tileX, tileY)` | `[number, number]` | Tile → world coordinates |
| `forge.tilemap.getMapSize(tilemapId)` | `[number, number]` | Map dimensions in tiles `[w, h]` |
| `forge.tilemap.resize(tilemapId, width, height, anchor?)` | *throws* | **Not supported** — the engine has no tilemap resize command |

`tilemapId` is the tilemap **entity** id. `tileId` is an index into the tilemap's
tileset, and passing `null` erases rather than painting.

Every coordinate, layer and tile index is floored before it is sent, so
`worldToTile`-style fractional input works. A negative or non-finite argument
**throws** instead of being sent: the engine reads each of these with
`as_u64()`, and a rejection there discards the whole command silently, so the
script would appear to succeed while the tilemap never changed.

`fillRect` sends one command for the whole region and throws if the region
exceeds `TILEMAP_FILL_MAX_CELLS` cells (derived in `scriptWorker.ts` from the
dispatch payload guard, not a hand-written number). A zero-width or
zero-height region is a no-op.

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
| `forge.audio.removeAllLayers(entityId)` | `void` | Remove all layers (not primary) |
| `forge.audio.crossfade(from, to, durationMs)` | `void` | Crossfade between sources |
| `forge.audio.playOneShot(assetId, opts?)` | `void` | Fire-and-forget sound |
| `forge.audio.fadeIn(entityId, durationMs)` | `void` | Fade in audio |
| `forge.audio.fadeOut(entityId, durationMs)` | `void` | Fade out audio (stops after fade) |
| `forge.audio.setMusicIntensity(level)` | `void` | Set adaptive music intensity (0–1) |
| `forge.audio.loadStems(stems)` | `void` | Load multi-stem music for adaptive playback |
| `forge.audio.saveSnapshot(name, crossfadeDurationMs?)` | `void` | Save current mixer state as a snapshot |
| `forge.audio.loadSnapshot(name, durationMs?)` | `void` | Restore a saved mixer snapshot |
| `forge.audio.detectLoopPoints(assetId)` | `Promise<{start, end} \| null>` | Detect seamless loop points |
| `forge.audio.getWaveform(assetId)` | `Promise<number[] \| null>` | Waveform data for visualisation |

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
| `forge.animation.setBlendWeight(entityId, clip, weight)` | `void` | Set clip blend weight (0–1) |
| `forge.animation.setClipSpeed(entityId, clip, speed)` | `void` | Set per-clip speed |
| `forge.animation.listClips(entityId)` | `Promise<string[]>` | List available clips (async) |
| `forge.animation.getClipDuration(entityId, clip)` | `Promise<number \| null>` | Clip duration in seconds (async) |

## forge.ui

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.ui.showText(id, text, x, y, opts?)` | `void` | Show a HUD text element (`opts: {fontSize?, color?}`) |
| `forge.ui.updateText(id, text)` | `void` | Update an existing HUD element |
| `forge.ui.removeText(id)` | `void` | Remove a HUD text element |
| `forge.ui.clear()` | `void` | Clear all HUD elements |
| `forge.ui.showScreen(screen)` | `void` | Show a UI Builder screen by name or ID |
| `forge.ui.hideScreen(screen)` | `void` | Hide a UI Builder screen |
| `forge.ui.toggleScreen(screen)` | `void` | Toggle a screen's visibility |
| `forge.ui.isScreenVisible(screen)` | `boolean` | Is a screen currently visible? |
| `forge.ui.hideAllScreens()` | `void` | Hide all UI Builder screens |
| `forge.ui.setWidgetText(screen, widget, text)` | `void` | Update a widget's text at runtime |
| `forge.ui.setWidgetVisible(screen, widget, visible)` | `void` | Update a widget's visibility |
| `forge.ui.setWidgetStyle(screen, widget, style)` | `void` | Update a widget's style property |
| `forge.ui.getWidgetValue(screen, widget)` | `unknown` | Get a widget's current bound value |

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

## forge.screen

| Property | Type | Description |
|----------|------|-------------|
| `forge.screen.orientation` | `string` | Current screen orientation |

## forge.camera

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.camera.setMode(mode)` | `void` | `'thirdPersonFollow'｜'firstPerson'｜'sideScroller'｜'topDown'｜'fixed'｜'orbital'` |
| `forge.camera.setTarget(entityId)` | `void` | Set follow target by entity ID |
| `forge.camera.shake(intensity, duration)` | `void` | Trigger camera shake |
| `forge.camera.getMode()` | `string` | Current camera mode |
| `forge.camera.setProperty(property, value)` | `void` | Set a camera property |

## forge.dialogue

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.dialogue.start(treeId)` | `void` | Start a dialogue tree |
| `forge.dialogue.isActive()` | `boolean` | Is a dialogue currently active? |
| `forge.dialogue.end()` | `void` | End the current dialogue |
| `forge.dialogue.advance()` | `void` | Advance to the next node (text nodes only) |
| `forge.dialogue.skip()` | `void` | Skip typewriter animation |
| `forge.dialogue.setVariable(treeId, key, value)` | `void` | Set a dialogue variable |
| `forge.dialogue.getVariable(treeId, key)` | `any` | Get a dialogue variable |
| `forge.dialogue.onStart(cb)` | `void` | Callback on dialogue start; `cb(treeId)` |
| `forge.dialogue.onEnd(cb)` | `void` | Callback on dialogue end |
| `forge.dialogue.onChoice(cb)` | `void` | Callback on choice; `cb(choiceId, choiceText)` |

## forge.sprite

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.sprite.playAnimation(entityId, clip)` | `void` | Play an animation clip by name |
| `forge.sprite.stopAnimation(entityId)` | `void` | Stop the current animation |
| `forge.sprite.setAnimSpeed(entityId, speed)` | `void` | Set animation playback speed |
| `forge.sprite.setAnimParam(entityId, param, value)` | `void` | Set a state-machine parameter (`number｜boolean`) |
| `forge.sprite.getCurrentFrame(entityId)` | `number` | Current frame index |

## forge.skeleton

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.skeleton.addBone(entityId, bone)` | `void` | Add a bone (`Partial<{name, parentBone, position, rotation, length}>`) |
| `forge.skeleton.removeBone(entityId, boneName)` | `void` | Remove a bone |
| `forge.skeleton.updateBone(entityId, boneName, updates)` | `void` | Update bone properties |
| `forge.skeleton.getBones(entityId)` | `Array<bone> \| null` | All bones in the skeleton |
| `forge.skeleton.playAnimation(entityId, anim, opts?)` | `void` | Play a skeletal animation (`opts: {loop?, speed?, crossfade?}`) |
| `forge.skeleton.stopAnimation(entityId)` | `void` | Stop the current skeletal animation |
| `forge.skeleton.setSkin(entityId, skinName)` | `void` | Set the active skin |
| `forge.skeleton.getSkin(entityId)` | `string \| null` | Current active skin name |
| `forge.skeleton.setIkTarget(entityId, constraint, x, y)` | `void` | Set an IK constraint target position |

## forge.skeleton2d

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.skeleton2d.createSkeleton(entityId)` | `void` | Create a skeleton for 2D animation |
| `forge.skeleton2d.addBone(entityId, name, parent, x, y, rotation, length)` | `void` | Add a bone |
| `forge.skeleton2d.removeBone(entityId, boneName)` | `void` | Remove a bone |
| `forge.skeleton2d.updateBone(entityId, name, x, y, rotation, length)` | `void` | Update bone properties |
| `forge.skeleton2d.setSkin(entityId, skinName)` | `void` | Set the active skin |
| `forge.skeleton2d.playAnimation(entityId, animationName)` | `void` | Play a skeletal animation |
| `forge.skeleton2d.getBones(entityId)` | `Array<bone> \| null` | All bones in the skeleton |

## forge.ai

All `forge.ai.*` methods are async and route to the AI generation provider.

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.ai.generateTexture(prompt, onProgress?)` | `Promise<{assetId, url} \| null>` | Generate a texture from a prompt |
| `forge.ai.generateModel(prompt, onProgress?)` | `Promise<{assetId, url} \| null>` | Generate a 3D model from a prompt |
| `forge.ai.generateSound(prompt, onProgress?)` | `Promise<{assetId, url} \| null>` | Generate a sound effect from a prompt |
| `forge.ai.generateVoice(text, onProgress?)` | `Promise<{assetId, url} \| null>` | Generate voice audio from text |
| `forge.ai.generateMusic(prompt, onProgress?)` | `Promise<{assetId, url} \| null>` | Generate music from a prompt |

## forge.asset

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.asset.loadImage(url)` | `Promise<{assetId} \| null>` | Load an image and register it as an asset |
| `forge.asset.loadModel(url)` | `Promise<{assetId} \| null>` | Load a 3D model and register it as an asset |

## forge.game

The win surface for the core game loop. `forge.game.win()` flips the win state
once (re-entry is a no-op so the overlay/handlers fire exactly once), and the
engine's own win condition raises the same state from native ECS.

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.game.win()` | `void` | Declare the game won — sets win state and fires all `onWin` handlers |
| `forge.game.setScore(score)` | `void` | Set the player's score for the active play session |
| `forge.game.getScore()` | `number` | Current score for the active play session |
| `forge.game.onWin(cb)` | `void` | Register a callback fired once when the game is won |

## forge.leaderboard

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.leaderboard.submit(name, playerName, score, metadata?)` | `Promise<{rank} \| null>` | Submit a score; returns 1-based rank |
| `forge.leaderboard.getTop(name, limit?)` | `Promise<Array<entry> \| null>` | Top N entries (default 10) |

## forge.i18n

| Function | Returns | Description |
|----------|---------|-------------|
| `forge.i18n.t(stringId, defaultText)` | `string` | Resolve a string ID to its translation (falls back to `defaultText`) |
| `forge.i18n.setLocale(locale)` | `void` | Switch the active locale at runtime (BCP-47, e.g. `"ja"`) |
| `forge.i18n.getLocale()` | `string` | Currently active locale code |
| `forge.i18n.getAvailableLocales()` | `string[]` | All locale codes with translations available |
