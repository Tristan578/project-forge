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

/** Engine defaults for the two components that compose `offset`, kept in sync with `from_flat`. */
const DEFAULT_FOLLOW_HEIGHT = 2;
const DEFAULT_FOLLOW_DISTANCE = 5;

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

const CAMERA_MODES: readonly GameCameraMode[] = [
  'thirdPersonFollow',
  'firstPerson',
  'sideScroller',
  'topDown',
  'fixed',
  'orbital',
];

/**
 * Translate an engine wire payload back into the store's authoring vocabulary.
 *
 * The engine answers `GAME_CAMERA_CHANGED` and `QUERY_GAME_CAMERA` in the same
 * flat form `set_game_camera` accepts, so this is the exact inverse of
 * {@link buildSetGameCameraPayload}. Returns `null` for an unrecognized mode
 * rather than casting a string into the union — the previous handler asserted
 * `payload.mode as GameCameraData['mode']`, which made every engine-side rename
 * invisible to the type checker.
 */
export function parseGameCameraWire(payload: Record<string, unknown>): GameCameraData | null {
  const rawMode = payload.mode;
  if (typeof rawMode !== 'string') return null;
  const mode = CAMERA_MODES.find(m => m === rawMode);
  if (!mode) return null;

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
