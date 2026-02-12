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
