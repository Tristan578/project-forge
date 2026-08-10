/**
 * Wire contract for the engine's `set_game_camera` command and its
 * `GAME_CAMERA_CHANGED` / `QUERY_GAME_CAMERA` events.
 *
 * The store's {@link GameCameraData} is an *authoring* vocabulary — "distance",
 * "height", "smoothing" — chosen because that is what the inspector labels read.
 * The engine speaks a different one: `GameCameraMode::from_flat`
 * (engine/src/core/game_camera.rs) reads `offset`, `damping`, `eyeHeight`,
 * `mouseSensitivity`, `zOffset`, `height`, `radius`, `autoRotateSpeed`.
 *
 * There is ZERO name overlap between the two beyond `mode`, so spreading a
 * `GameCameraData` into the dispatch — `{ entityId, ...data }` — sent the engine
 * nothing it could read. `serde` mapped every unknown key to `None` and the camera
 * silently took its defaults. `dispatchCommand` returns `void`, so no exception,
 * no log, and no failing test ever surfaced it (the PF-1097/PF-1109/PF-1111/
 * PF-1115/PF-1118 defect class).
 *
 * This module owns BOTH directions of that translation, so the two vocabularies
 * meet in exactly one place:
 *   - {@link buildSetGameCameraPayload} — authoring → engine wire (every dispatch)
 *   - {@link parseGameCameraWire}       — engine wire → authoring (every event)
 */

import type { GameCameraData, GameCameraMode } from '@/stores/slices/types';

/**
 * Every field the engine's flat wire form accepts, across all six modes.
 *
 * Mirrors `GameCameraMode::from_flat` / `to_flat`. Listed in full — including the
 * parameters no UI exposes yet — because this type is what documents the contract;
 * {@link buildSetGameCameraPayload} emits only the subset {@link GameCameraData}
 * can express.
 */
export interface GameCameraWireParams {
  /** thirdPersonFollow: camera offset from the target, engine default `[0, 2, -5]`. */
  offset?: [number, number, number];
  /** thirdPersonFollow / sideScroller / topDown: follow damping, engine default 5. */
  damping?: number;
  minDistance?: number;
  maxDistance?: number;
  lookAtTarget?: boolean;
  collisionAvoidance?: boolean;
  /** firstPerson: eye height above the target, engine default 1.7. */
  eyeHeight?: number;
  /** firstPerson: DEGREES of rotation per pixel of mouse delta, engine default 0.1. */
  mouseSensitivity?: number;
  fov?: number;
  pitchClamp?: [number, number];
  /** sideScroller: camera distance along Z, engine default 10. */
  zOffset?: number;
  followY?: boolean;
  yBounds?: [number, number];
  /** topDown: camera height above the target, engine default 15. */
  height?: number;
  followRotation?: boolean;
  lookAt?: [number, number, number];
  /** orbital: orbit radius, engine default 8. */
  radius?: number;
  autoRotate?: boolean;
  /** orbital: degrees per second, engine default 15. */
  autoRotateSpeed?: number;
}

/** The exact object shape `dispatchCommand('set_game_camera', …)` accepts. */
export type SetGameCameraPayload = {
  entityId: string;
  mode: GameCameraMode;
  targetEntity: string | null;
} & GameCameraWireParams;

/**
 * Every authoring field this module knows how to translate.
 *
 * The `satisfies Record<keyof GameCameraData, true>` is load-bearing in BOTH
 * directions: a key that is not on `GameCameraData` fails excess-property
 * checking, and a `GameCameraData` field missing from here fails the
 * missing-property check. So adding a camera parameter to the store type breaks
 * the build until its engine mapping is decided here.
 *
 * An object, not an array: `as const satisfies readonly (keyof GameCameraData)[]`
 * would only prove the listed keys are VALID, never that the list is COMPLETE.
 */
const TRANSLATED_FIELDS = {
  mode: true,
  targetEntity: true,
  followDistance: true,
  followHeight: true,
  followSmoothing: true,
  firstPersonHeight: true,
  firstPersonMouseSensitivity: true,
  sideScrollerDistance: true,
  topDownHeight: true,
  orbitalDistance: true,
  orbitalAutoRotateSpeed: true,
} satisfies Record<keyof GameCameraData, true>;

/** Runtime view of {@link TRANSLATED_FIELDS}. */
export const TRANSLATED_CAMERA_FIELDS = Object.keys(TRANSLATED_FIELDS) as (keyof GameCameraData)[];

/**
 * The engine's own per-field defaults, mirrored from `GameCameraMode::from_flat`.
 *
 * These are what the camera actually uses for any parameter the payload omits,
 * so they are also the only correct placeholder for an unset field in the UI.
 * The inspector used to carry its own copy and had drifted on two of them —
 * orbital distance read 5 against the engine's 8, and orbital auto-rotate speed
 * read 0 against the engine's 15 — so an orbital camera the user never touched
 * ran at a distance and speed the panel never showed. Import from here rather
 * than re-typing a number next to a `??`.
 */
export const ENGINE_CAMERA_DEFAULTS = {
  followDistance: 5,
  followHeight: 2,
  followSmoothing: 5,
  firstPersonHeight: 1.7,
  firstPersonMouseSensitivity: 0.1,
  sideScrollerDistance: 10,
  topDownHeight: 15,
  orbitalDistance: 8,
  orbitalAutoRotateSpeed: 15,
} as const satisfies Record<Exclude<keyof GameCameraData, 'mode' | 'targetEntity'>, number>;

const DEFAULT_FOLLOW_HEIGHT = ENGINE_CAMERA_DEFAULTS.followHeight;
const DEFAULT_FOLLOW_DISTANCE = ENGINE_CAMERA_DEFAULTS.followDistance;

/**
 * Read one own, finite number off an authoring object.
 *
 * `Object.hasOwn`, not a bare read: `data[key]` walks the prototype chain, so an
 * object carrying a `__proto__:` key would contribute values the caller never set.
 * Non-finite values are dropped rather than dispatched — `JSON.stringify` turns
 * `NaN` into `null`, which `from_flat` reads as "absent, take the default", so a
 * mistyped input would silently reset the parameter instead of erroring.
 */
function num(data: Partial<GameCameraData>, key: keyof GameCameraData): number | undefined {
  if (!Object.hasOwn(data, key)) return undefined;
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Build a `set_game_camera` payload in the engine's own vocabulary.
 *
 * Use this instead of spreading a store object into the dispatch. A `satisfies
 * SetGameCameraPayload` on a spread is inert — TypeScript's excess-property
 * (freshness) check applies to properties written literally, not to properties
 * introduced by a spread — so `{ entityId, ...data } satisfies SetGameCameraPayload`
 * type-checks happily while carrying keys the engine drops on the floor.
 * Annotating the variable instead is equally inert. Picking is the only
 * construction that actually constrains the result.
 *
 * `entityId` is the CAMERA entity; `targetEntity` is what it follows.
 */
export function buildSetGameCameraPayload(
  entityId: string,
  data: Partial<GameCameraData> & { mode: GameCameraMode },
): SetGameCameraPayload {
  const payload: SetGameCameraPayload = {
    entityId,
    mode: data.mode,
    targetEntity: data.targetEntity ?? null,
  };

  switch (data.mode) {
    case 'thirdPersonFollow': {
      const distance = num(data, 'followDistance');
      const height = num(data, 'followHeight');
      // `offset` is a single vector, so it is all-or-nothing on the wire: sending
      // it with only one component known would reset the other to 0 rather than
      // leave it alone. Fill the gap with the engine's own default — which is
      // exactly `[0, 2, -5]`, i.e. this UI's height 2 / distance 5.
      if (distance !== undefined || height !== undefined) {
        payload.offset = [
          0,
          height ?? DEFAULT_FOLLOW_HEIGHT,
          -(distance ?? DEFAULT_FOLLOW_DISTANCE),
        ];
      }
      const smoothing = num(data, 'followSmoothing');
      if (smoothing !== undefined) payload.damping = smoothing;
      break;
    }
    case 'firstPerson': {
      const eyeHeight = num(data, 'firstPersonHeight');
      if (eyeHeight !== undefined) payload.eyeHeight = eyeHeight;
      const sensitivity = num(data, 'firstPersonMouseSensitivity');
      if (sensitivity !== undefined) payload.mouseSensitivity = sensitivity;
      break;
    }
    case 'sideScroller': {
      const distance = num(data, 'sideScrollerDistance');
      if (distance !== undefined) payload.zOffset = distance;
      break;
    }
    case 'topDown': {
      const height = num(data, 'topDownHeight');
      if (height !== undefined) payload.height = height;
      break;
    }
    case 'orbital': {
      const radius = num(data, 'orbitalDistance');
      if (radius !== undefined) payload.radius = radius;
      // Only the speed is exposed. The engine's `autoRotate` defaults to `true`,
      // but its update is `angle += speed.to_radians() * dt`, so a speed of 0 is
      // an exact no-op — sending the speed alone is faithful to a UI that has no
      // separate on/off control.
      const speed = num(data, 'orbitalAutoRotateSpeed');
      if (speed !== undefined) payload.autoRotateSpeed = speed;
      break;
    }
    case 'fixed':
      // Position comes from the camera entity's own transform.
      break;
  }

  return payload;
}

/** Read one finite number out of an engine wire payload. */
function wireNum(params: Record<string, unknown>, key: string): number | undefined {
  if (!Object.hasOwn(params, key)) return undefined;
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Every mode the engine's `from_flat` recognizes, and the module's single copy
 * of that list.
 *
 * An object with `satisfies Record<GameCameraMode, true>` rather than an array:
 * on an array, `satisfies readonly GameCameraMode[]` only proves each entry is a
 * valid mode, never that the list is complete, so a mode added to the union
 * would silently go unrecognized at runtime. On an object the check runs both
 * ways — a missing key fails the build.
 *
 * Three call sites re-typed this list before PF-1126. They agreed, but nothing
 * made them agree, and the parameter lists beside them had already drifted.
 */
export const CAMERA_MODES = {
  thirdPersonFollow: true,
  firstPerson: true,
  sideScroller: true,
  topDown: true,
  fixed: true,
  orbital: true,
} satisfies Record<GameCameraMode, true>;

/** Narrow an arbitrary string to a camera mode the engine will accept. */
export function isCameraMode(value: unknown): value is GameCameraMode {
  return typeof value === 'string' && Object.hasOwn(CAMERA_MODES, value);
}

/**
 * Translate an engine wire payload back into the store's authoring vocabulary.
 *
 * The engine emits the same flat form `set_game_camera` accepts, so this is the
 * exact inverse of {@link buildSetGameCameraPayload}.
 *
 * `GAME_CAMERA_CHANGED` carries those keys at the top level and can be passed
 * here directly. `QUERY_GAME_CAMERA` does NOT: it nests them one level down
 * under `gameCameraData` (and sends `null` there when the entity has no camera),
 * so a caller must unwrap that key first — handing this the event payload would
 * find no `mode` and return `null`. Nothing on the JS side reads
 * `QUERY_GAME_CAMERA` today, which is why the difference has never been felt.
 *
 * Returns `null` for an unrecognized mode
 * rather than casting a string into the union — the previous handler asserted
 * `payload.mode as GameCameraData['mode']`, which made every engine-side rename
 * invisible to the type checker.
 */
export function parseGameCameraWire(payload: Record<string, unknown>): GameCameraData | null {
  const rawMode = payload.mode;
  if (!isCameraMode(rawMode)) return null;
  const mode = rawMode;

  // An empty string is normalized to null, as the legacy handler did. Nothing
  // downstream distinguishes "" from "no target", and leaving it as a string
  // would make `targetEntity` truthy-but-unresolvable in every consumer.
  const rawTarget = payload.targetEntity;
  const targetEntity = typeof rawTarget === 'string' && rawTarget !== '' ? rawTarget : null;
  const data: GameCameraData = { mode, targetEntity };

  switch (mode) {
    case 'thirdPersonFollow': {
      const offset = payload.offset;
      if (Array.isArray(offset) && offset.length === 3) {
        const [, y, z] = offset as unknown[];
        if (typeof y === 'number' && Number.isFinite(y)) data.followHeight = y;
        if (typeof z === 'number' && Number.isFinite(z)) data.followDistance = -z;
      }
      const damping = wireNum(payload, 'damping');
      if (damping !== undefined) data.followSmoothing = damping;
      break;
    }
    case 'firstPerson': {
      const eyeHeight = wireNum(payload, 'eyeHeight');
      if (eyeHeight !== undefined) data.firstPersonHeight = eyeHeight;
      const sensitivity = wireNum(payload, 'mouseSensitivity');
      if (sensitivity !== undefined) data.firstPersonMouseSensitivity = sensitivity;
      break;
    }
    case 'sideScroller': {
      const zOffset = wireNum(payload, 'zOffset');
      if (zOffset !== undefined) data.sideScrollerDistance = zOffset;
      break;
    }
    case 'topDown': {
      const height = wireNum(payload, 'height');
      if (height !== undefined) data.topDownHeight = height;
      break;
    }
    case 'orbital': {
      const radius = wireNum(payload, 'radius');
      if (radius !== undefined) data.orbitalDistance = radius;
      // `autoRotate: false` and `autoRotateSpeed: 0` are behaviourally identical,
      // and the authoring type has no on/off field — so a disabled orbital camera
      // reads back as speed 0 rather than losing the distinction silently.
      const speed = wireNum(payload, 'autoRotateSpeed');
      if (speed !== undefined) data.orbitalAutoRotateSpeed = payload.autoRotate === false ? 0 : speed;
      break;
    }
    case 'fixed':
      break;
  }

  return data;
}
