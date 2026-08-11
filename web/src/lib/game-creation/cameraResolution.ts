/**
 * Shared camera resolution for the game-creation pipeline.
 *
 * Three helpers that were each written twice or more:
 *
 *  - `normalizeCameraMode` — two copies of an eight-pair alias map plus a third
 *    hand-typed copy of the mode list lived in `sceneCreateExecutor`.
 *  - `resolveCameraEntityId` — the name heuristic was inline in
 *    `autoPolishExecutor` and needed a second copy for `camera_setup`.
 *  - `filterCameraNumerics` — the allowlist loop was inline twice in
 *    `sceneCreateExecutor`.
 *
 * Every consumer here is reachable from `/api/game/decompose` through the
 * executor barrel, so this module must never take a VALUE import on `@/stores`
 * or `@/hooks/useEngine` — that edge is traced by Turbopack and breaks the RSC
 * build (see `executors/__tests__/serverSafeImports.test.ts`). Hence the
 * type-only import below and the structural node parameter: callers pass the
 * nodes in, this module never reaches for the store itself.
 */

import { isCameraMode, NUMERIC_CAMERA_FIELDS } from '@/lib/game/gameCameraPayload';
import type { NumericCameraField } from '@/lib/game/gameCameraPayload';
import type { GameCameraMode } from '@/stores/slices/types';

/**
 * Hyphenated/underscored spellings the GDD generator produces, mapped onto the
 * engine's camelCase mode names.
 */
const CAMERA_MODE_ALIASES: Record<string, GameCameraMode> = {
  'side-scroller': 'sideScroller',
  'side_scroller': 'sideScroller',
  'third-person': 'thirdPersonFollow',
  'third_person': 'thirdPersonFollow',
  'first-person': 'firstPerson',
  'first_person': 'firstPerson',
  'top-down': 'topDown',
  'top_down': 'topDown',
};

/**
 * Resolve a model-authored camera mode to one the engine recognizes.
 *
 * Falls back to `thirdPersonFollow` rather than passing the string through: the
 * engine's `from_flat` rejects any mode it does not know, and a rejected
 * `set_game_camera` is a silent no-op (PF-1126).
 */
export function normalizeCameraMode(raw: unknown): GameCameraMode {
  if (typeof raw !== 'string') return 'thirdPersonFollow';
  // Own-key read, though `isCameraMode` would catch the fallout either way: a GDD
  // mode string of `constructor` makes a bare `CAMERA_MODE_ALIASES[key]` return
  // `Object.prototype.constructor`, which is not nullish, so `??` does not fall
  // back and a FUNCTION reaches the narrowing check. It fails there and the
  // default is returned, so the bare form is not exploitable — but it gets there
  // by accident, and the guard says what was meant.
  const key = raw.toLowerCase();
  const aliased = Object.hasOwn(CAMERA_MODE_ALIASES, key) ? CAMERA_MODE_ALIASES[key] : raw;
  return isCameraMode(aliased) ? aliased : 'thirdPersonFollow';
}

/**
 * The camera modes that do NOTHING without a target entity.
 *
 * This is not a style preference — it is the engine's control flow. In
 * `engine/src/core/game_camera.rs`, `target_transform` is `None` whenever
 * `target_entity` is `None`, and the ThirdPersonFollow, FirstPerson,
 * SideScroller, TopDown and Orbital arms are each wrapped in
 * `if let Some(target_t) = target_transform`. So a targetless camera in any of
 * those modes never has its transform touched: it sits motionless for the whole
 * game while `set_game_camera` reports success and the store shows the mode the
 * GDD asked for. That is the same "looks applied, does nothing" symptom PF-1125
 * was filed to fix, one layer further down.
 *
 * `fixed` is the sole mode that works targetless — it reads `look_at`, a Vec3,
 * which is not a numeric field and so cannot arrive through `cameraConfig`.
 */
const CAMERA_MODES_REQUIRING_TARGET: ReadonlySet<GameCameraMode> = new Set<GameCameraMode>([
  'thirdPersonFollow',
  'firstPerson',
  'sideScroller',
  'topDown',
  'orbital',
]);

/** Whether `mode` is inert unless `targetEntity` names a live entity. */
export function cameraModeNeedsTarget(mode: GameCameraMode): boolean {
  return CAMERA_MODES_REQUIRING_TARGET.has(mode);
}

/** The minimum a scene-graph node must expose for camera resolution. */
export interface CameraCandidateNode {
  name: string;
  entityId: string;
}

/**
 * Find the scene's camera entity by name.
 *
 * Callers MUST pass nodes read live at the moment of dispatch, never a snapshot
 * taken at pipeline start: the orchestrator builds the executor context once and
 * every step reuses it, so a snapshot cannot see entities the pipeline itself
 * spawned, and `set_game_camera` against an id that does not exist is a silent
 * no-op (PF-1118).
 */
export function resolveCameraEntityId(nodes: readonly CameraCandidateNode[]): string | null {
  const match = nodes.find((n) => {
    const lower = n.name.toLowerCase();
    // No exact-`camera` disjunct: `'camera'.endsWith('camera')` is already true,
    // so it would read as a third rule that never decides anything.
    return lower.endsWith('camera') || lower.endsWith('_cam');
  });
  if (!match) return null;
  return typeof match.entityId === 'string' && match.entityId.trim().length > 0
    ? match.entityId
    : null;
}

/**
 * Project a GDD-authored camera config onto the numeric fields the engine can
 * actually receive.
 *
 * The allowlist is derived from the translator's own field list rather than
 * re-typed, so a parameter cannot be accepted here without an engine mapping.
 * The hand-written lists this replaces carried two names no engine variant has
 * (`sideScrollerHeight`, `topDownAngle`) and one of them omitted
 * `firstPersonMouseSensitivity`, which a variant does have.
 */
export function filterCameraNumerics(
  raw: unknown,
): Partial<Record<NumericCameraField, number>> {
  const out: Partial<Record<NumericCameraField, number>> = {};
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, unknown>;
  for (const key of NUMERIC_CAMERA_FIELDS) {
    // Own keys only. This object is GDD-derived, so the model controls its keys
    // and a bare read walks the prototype chain.
    if (!Object.hasOwn(obj, key)) continue;
    const val = obj[key];
    // `Number.isFinite`, not a truthiness check: `0` is a legitimate value for
    // several of these, and `NaN`/`Infinity` would deserialize into the engine
    // as a f32 the physics step then propagates through the whole transform.
    if (typeof val === 'number' && Number.isFinite(val)) out[key] = val;
  }
  return out;
}
