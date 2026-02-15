export const FORGE_TYPE_DEFINITIONS = `
declare namespace forge {
  /** Get transform of an entity */
  function getTransform(entityId: string): { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } | null;
  /** Set absolute position */
  function setPosition(entityId: string, x: number, y: number, z: number): void;
  /** Set absolute rotation (euler degrees) */
  function setRotation(entityId: string, x: number, y: number, z: number): void;
  /** Translate relative to current position */
  function translate(entityId: string, dx: number, dy: number, dz: number): void;
  /** Rotate relative to current rotation (euler degrees) */
  function rotate(entityId: string, dx: number, dy: number, dz: number): void;
  /** Spawn a new entity, returns its ID */
  function spawn(type: string, options?: { name?: string; position?: [number, number, number] }): string;
  /** Destroy an entity */
  function destroy(entityId: string): void;
  /** Log a message to the console */
  function log(message: string): void;
  /** Log a warning */
  function warn(message: string): void;
  /** Log an error */
  function error(message: string): void;

  // --- Visual control ---
  /** Set entity base color (RGBA, 0-1 range) */
  function setColor(entityId: string, r: number, g: number, b: number, a?: number): void;
  /** Show or hide an entity */
  function setVisibility(entityId: string, visible: boolean): void;
  /** Set entity emissive glow (RGB + intensity) */
  function setEmissive(entityId: string, r: number, g: number, b: number, intensity?: number): void;

  namespace scene {
    /** Get all entities in the scene */
    function getEntities(): Array<{ id: string; name: string; type: string; position: [number, number, number] }>;
    /** Find entities whose name contains the search string (case-insensitive) */
    function findByName(name: string): string[];
    /** Get entity display name */
    function getEntityName(entityId: string): string | null;
    /** Get entity type (e.g. "cube", "sphere", "point_light") */
    function getEntityType(entityId: string): string | null;
    /** Find all entities within a radius of a world position */
    function getEntitiesInRadius(position: [number, number, number], radius: number): string[];
    /** Stop play mode (return to edit) */
    function reset(): void;
    /** Load a different scene with optional transition effect (play mode only) */
    function load(sceneName: string, transition?: Partial<{
      type: 'fade' | 'wipe' | 'instant';
      duration: number;
      color: string;
      direction: 'left' | 'right' | 'up' | 'down';
      easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
    }>): void;
    /** Restart the current scene */
    function restart(): void;
    /** Get current scene name */
    function getCurrent(): string;
    /** Get list of all scene names */
    function getAll(): string[];
  }

  namespace input {
    /** Check if an action is currently pressed */
    function isPressed(action: string): boolean;
    /** Check if an action was just pressed this frame */
    function justPressed(action: string): boolean;
    /** Check if an action was just released this frame */
    function justReleased(action: string): boolean;
    /** Get axis value (-1 to 1) */
    function getAxis(action: string): number;
    /** Check if the current device supports touch input */
    function isTouchDevice(): boolean;
    /** Trigger haptic feedback (vibration pattern in ms) */
    function vibrate(pattern: number[]): void;
  }

  namespace physics {
    /** Apply a continuous force */
    function applyForce(entityId: string, fx: number, fy: number, fz: number): void;
    /** Apply an instant impulse */
    function applyImpulse(entityId: string, fx: number, fy: number, fz: number): void;
    /** Set linear velocity directly */
    function setVelocity(entityId: string, vx: number, vy: number, vz: number): void;
    /** Get entity IDs currently in contact (proximity-based). Optional radius overrides collider size. */
    function getContacts(entityId: string, radius?: number): string[];
    /** Get distance between two entities */
    function distanceTo(entityIdA: string, entityIdB: string): number;
    /** Register a callback for when this entity collides with another (collision start) */
    function onCollisionEnter(entityId: string, callback: (otherEntityId: string) => void): void;
    /** Register a callback for when this entity stops colliding with another (collision end) */
    function onCollisionExit(entityId: string, callback: (otherEntityId: string) => void): void;
    /** Remove all collision callbacks for this entity */
    function offCollision(entityId: string): void;
  }

  namespace physics2d {
    /** Apply a continuous force (2D) */
    function applyForce(entityId: string, forceX: number, forceY: number): void;
    /** Apply an instant impulse (2D) */
    function applyImpulse(entityId: string, impulseX: number, impulseY: number): void;
    /** Set linear velocity directly (2D) */
    function setVelocity(entityId: string, vx: number, vy: number): void;
    /** Get current velocity (2D) */
    function getVelocity(entityId: string): { x: number; y: number } | null;
    /** Set angular velocity (radians per second) */
    function setAngularVelocity(entityId: string, omega: number): void;
    /** Get current angular velocity (radians per second) */
    function getAngularVelocity(entityId: string): number | null;
    /** Perform a raycast and return the first hit */
    function raycast(originX: number, originY: number, dirX: number, dirY: number, maxDistance?: number): Promise<{
      entityId: string;
      entityName: string;
      point: { x: number; y: number };
      normal: { x: number; y: number };
      distance: number;
    } | null>;
    /** Check if entity is on the ground (downward raycast) */
    function isGrounded(entityId: string, distance?: number): Promise<boolean>;
    /** Set global gravity (default: [0, -9.81]) */
    function setGravity(x: number, y: number): void;
    /** Register a callback for when this entity collides with another (collision start) */
    function onCollisionEnter(callback: (event: { entityId: string; otherEntityId: string; otherEntityName: string }) => void): () => void;
    /** Register a callback for when this entity stops colliding with another (collision end) */
    function onCollisionExit(callback: (event: { entityId: string; otherEntityId: string; otherEntityName: string }) => void): () => void;
  }

  namespace tilemap {
    /** Get tile ID at position (returns null if empty or out of bounds) */
    function getTile(tilemapId: string, x: number, y: number, layer?: number): number | null;
    /** Set a single tile at position (use null to clear) */
    function setTile(tilemapId: string, x: number, y: number, tileId: number | null, layer?: number): void;
    /** Fill a rectangular region with a tile */
    function fillRect(tilemapId: string, x: number, y: number, w: number, h: number, tileId: number | null, layer?: number): void;
    /** Clear a single tile */
    function clearTile(tilemapId: string, x: number, y: number, layer?: number): void;
    /** Convert world coordinates to tile coordinates */
    function worldToTile(tilemapId: string, worldX: number, worldY: number): [number, number];
    /** Convert tile coordinates to world coordinates */
    function tileToWorld(tilemapId: string, tileX: number, tileY: number): [number, number];
    /** Get map dimensions in tiles [width, height] */
    function getMapSize(tilemapId: string): [number, number];
    /** Resize the tilemap (clears tiles outside new bounds) */
    function resize(tilemapId: string, width: number, height: number, anchor?: 'top-left' | 'center'): void;
  }

  namespace audio {
    /** Play audio on an entity */
    function play(entityId: string): void;
    /** Stop audio on an entity */
    function stop(entityId: string): void;
    /** Pause audio on an entity */
    function pause(entityId: string): void;
    /** Set volume (0-1) */
    function setVolume(entityId: string, volume: number): void;
    /** Set pitch (playback rate, 0.25-4.0) */
    function setPitch(entityId: string, pitch: number): void;
    /** Check if audio is playing */
    function isPlaying(entityId: string): boolean;
    /** Set audio bus volume (0-1) */
    function setBusVolume(busName: string, volume: number): void;
    /** Mute/unmute an audio bus */
    function muteBus(busName: string, muted: boolean): void;
    /** Get current bus volume */
    function getBusVolume(busName: string): number;
    /** Check if bus is muted */
    function isBusMuted(busName: string): boolean;

    /** Add a layered audio source to an entity (runtime only) */
    function addLayer(entityId: string, slotName: string, assetId: string, options?: {
      volume?: number; pitch?: number; loop?: boolean; spatial?: boolean; bus?: string;
    }): void;
    /** Remove a layered audio source from an entity */
    function removeLayer(entityId: string, slotName: string): void;
    /** Remove all layers (not primary) from an entity */
    function removeAllLayers(entityId: string): void;
    /** Crossfade between two entity audio sources */
    function crossfade(fromEntityId: string, toEntityId: string, durationMs: number): void;
    /** Play a one-shot sound (fire-and-forget, no entity needed) */
    function playOneShot(assetId: string, options?: {
      position?: [number, number, number]; bus?: string; volume?: number; pitch?: number;
    }): void;
    /** Fade in audio on an entity */
    function fadeIn(entityId: string, durationMs: number): void;
    /** Fade out audio on an entity (stops after fade) */
    function fadeOut(entityId: string, durationMs: number): void;
  }

  namespace particles {
    /** Set a particle preset on an entity */
    function setPreset(entityId: string, preset: string): void;
    /** Enable particle emission on an entity */
    function enable(entityId: string): void;
    /** Disable particle emission on an entity */
    function disable(entityId: string): void;
    /** Trigger a one-shot burst */
    function burst(entityId: string): void;
  }

  namespace animation {
    /** Play an animation clip by name */
    function play(entityId: string, clipName: string, crossfadeSecs?: number): void;
    /** Pause the current animation */
    function pause(entityId: string): void;
    /** Resume a paused animation */
    function resume(entityId: string): void;
    /** Stop all animations */
    function stop(entityId: string): void;
    /** Set playback speed (1.0 = normal) */
    function setSpeed(entityId: string, speed: number): void;
    /** Enable or disable looping */
    function setLoop(entityId: string, looping: boolean): void;
    /** Set blend weight for a specific clip (0.0-1.0) */
    function setBlendWeight(entityId: string, clipName: string, weight: number): void;
    /** Set playback speed for a specific clip */
    function setClipSpeed(entityId: string, clipName: string, speed: number): void;
    /** List available clip names */
    function listClips(entityId: string): string[];
  }

  namespace ui {
    /** Show a text element on the game HUD */
    function showText(id: string, text: string, x: number, y: number, options?: {
      fontSize?: number; color?: string;
    }): void;
    /** Update the text content of an existing HUD element */
    function updateText(id: string, text: string): void;
    /** Remove a HUD text element */
    function removeText(id: string): void;
    /** Clear all HUD elements */
    function clear(): void;

    /** Show a UI Builder screen by name or ID */
    function showScreen(screenNameOrId: string): void;
    /** Hide a UI Builder screen by name or ID */
    function hideScreen(screenNameOrId: string): void;
    /** Toggle a UI Builder screen's visibility */
    function toggleScreen(screenNameOrId: string): void;
    /** Check if a screen is currently visible */
    function isScreenVisible(screenNameOrId: string): boolean;
    /** Hide all UI Builder screens */
    function hideAllScreens(): void;

    /** Update a widget's text content at runtime */
    function setWidgetText(screenNameOrId: string, widgetNameOrId: string, text: string): void;
    /** Update a widget's visibility */
    function setWidgetVisible(screenNameOrId: string, widgetNameOrId: string, visible: boolean): void;
    /** Update a widget's style property at runtime */
    function setWidgetStyle(screenNameOrId: string, widgetNameOrId: string, style: Record<string, unknown>): void;
    /** Get a widget's current bound value */
    function getWidgetValue(screenNameOrId: string, widgetNameOrId: string): unknown;
  }

  namespace time {
    /** Seconds since last frame */
    const delta: number;
    /** Seconds since Play started */
    const elapsed: number;
  }

  namespace state {
    /** Get a shared state value */
    function get(key: string): any;
    /** Set a shared state value */
    function set(key: string, value: any): void;
  }

  namespace screen {
    /** Get current screen orientation */
    const orientation: string;
  }

  namespace camera {
    /** Set the camera mode */
    function setMode(mode: 'thirdPersonFollow' | 'firstPerson' | 'sideScroller' | 'topDown' | 'fixed' | 'orbital'): void;
    /** Set camera follow target by entity ID */
    function setTarget(entityId: string): void;
    /** Trigger camera shake */
    function shake(intensity: number, duration: number): void;
    /** Get the current camera mode */
    function getMode(): string;
    /** Set a camera property */
    function setProperty(property: string, value: number): void;
  }

  namespace dialogue {
    /** Start a dialogue tree by tree ID */
    function start(treeId: string): void;
    /** Check if a dialogue is currently active */
    function isActive(): boolean;
    /** End the current dialogue */
    function end(): void;
    /** Advance to the next node (text nodes only) */
    function advance(): void;
    /** Skip typewriter animation */
    function skip(): void;
    /** Set a dialogue variable */
    function setVariable(treeId: string, key: string, value: any): void;
    /** Get a dialogue variable */
    function getVariable(treeId: string, key: string): any;
    /** Register a callback for dialogue start events */
    function onStart(callback: (treeId: string) => void): void;
    /** Register a callback for dialogue end events */
    function onEnd(callback: () => void): void;
    /** Register a callback for choice selection events */
    function onChoice(callback: (choiceId: string, choiceText: string) => void): void;
  }

  namespace sprite {
    /** Play an animation clip by name */
    function playAnimation(entityId: string, clipName: string): void;
    /** Stop the current animation */
    function stopAnimation(entityId: string): void;
    /** Set animation playback speed */
    function setAnimSpeed(entityId: string, speed: number): void;
    /** Set an animation state machine parameter */
    function setAnimParam(entityId: string, paramName: string, value: number | boolean): void;
    /** Get the current frame index */
    function getCurrentFrame(entityId: string): number;
  }

  namespace skeleton {
    /** Add a bone to the skeleton */
    function addBone(entityId: string, bone: Partial<{ name: string; parentBone: string | null; position: [number, number]; rotation: number; length: number }>): void;
    /** Remove a bone from the skeleton */
    function removeBone(entityId: string, boneName: string): void;
    /** Update bone properties */
    function updateBone(entityId: string, boneName: string, updates: Partial<{ position: [number, number]; rotation: number; scale: [number, number]; length: number }>): void;
    /** Get all bones in the skeleton */
    function getBones(entityId: string): Array<{ name: string; position: [number, number]; rotation: number; scale: [number, number] }> | null;
    /** Play a skeletal animation */
    function playAnimation(entityId: string, animName: string, options?: { loop?: boolean; speed?: number; crossfade?: number }): void;
    /** Stop the current skeletal animation */
    function stopAnimation(entityId: string): void;
    /** Set the active skin */
    function setSkin(entityId: string, skinName: string): void;
    /** Get the current active skin name */
    function getSkin(entityId: string): string | null;
    /** Set an IK constraint target position */
    function setIkTarget(entityId: string, constraintName: string, targetX: number, targetY: number): void;
  }

  namespace skeleton2d {
    /** Create a skeleton for 2D animation */
    function createSkeleton(entityId: string): void;
    /** Add a bone to the skeleton */
    function addBone(entityId: string, boneName: string, parentBone: string | null, x: number, y: number, rotation: number, length: number): void;
    /** Remove a bone from the skeleton */
    function removeBone(entityId: string, boneName: string): void;
    /** Update bone properties */
    function updateBone(entityId: string, boneName: string, x: number, y: number, rotation: number, length: number): void;
    /** Set the active skin */
    function setSkin(entityId: string, skinName: string): void;
    /** Play a skeletal animation */
    function playAnimation(entityId: string, animationName: string): void;
    /** Get all bones in the skeleton */
    function getBones(entityId: string): Array<{ name: string; x: number; y: number; rotation: number; length: number }> | null;
  }
}

/** Entity ID of the entity this script is attached to */
declare const entityId: string;

/** Called once when Play starts */
declare function onStart(): void;
/** Called every frame during Play */
declare function onUpdate(dt: number): void;
/** Called when Play stops */
declare function onDestroy(): void;
`;
