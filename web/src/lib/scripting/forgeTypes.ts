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
