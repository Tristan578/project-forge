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
 * build (see `__tests__/serverSafeImports.test.ts`). Hence the
 * type-only import below and the structural node parameter: callers pass the
 * nodes in, this module never reaches for the store itself.
 */

import { isCameraMode, NUMERIC_CAMERA_FIELDS } from '@/lib/game/gameCameraPayload';
import type { NumericCameraField } from '@/lib/game/gameCameraPayload';
import type { GameCameraMode } from '@/stores/slices/types';

/**
 * Hyphenated/underscored spellings the GDD generator produces, mapped onto the
 * engine's camelCase mode names.
 *
 * This table must cover what the PRODUCERS actually emit, not what reads like a
 * plausible spelling. `systemDecomposer.ts` picks its camera `defaultType` from
 * a fixed list — `side-scroll`, `top-down`, `first-person`, `third-person`,
 * `orbit` — and the GDD fixtures add `follow` and `fixed`. Three of those
 * (`side-scroll`, `orbit`, `follow`) were missing here, so they fell through to
 * the default: every 2D side-scroller the decomposer produced was normalized to
 * `thirdPersonFollow`, which is the exact case PF-1125 was filed to fix. The
 * fallback made that invisible — an unmapped mode does not throw, it silently
 * becomes a third-person camera.
 *
 * `cameraModeVocabulary.test.ts` reads the producer's own list out of
 * `systemDecomposer.ts` and fails when a spelling appears there without an entry
 * here, so the next mode added to the decomposer cannot repeat this.
 */
const CAMERA_MODE_ALIASES: Record<string, GameCameraMode> = {
  'side-scroll': 'sideScroller',
  'side_scroll': 'sideScroller',
  'sidescroll': 'sideScroller',
  'side-scroller': 'sideScroller',
  'side_scroller': 'sideScroller',
  'sidescroller': 'sideScroller',
  'third-person': 'thirdPersonFollow',
  'third_person': 'thirdPersonFollow',
  // The GDD's most common spelling by far — 5 of the 11 fixtures. It resolved
  // correctly before only by accident, because the unknown-mode fallback happens
  // to be the mode it means.
  'follow': 'thirdPersonFollow',
  'first-person': 'firstPerson',
  'first_person': 'firstPerson',
  'top-down': 'topDown',
  'top_down': 'topDown',
  'orbit': 'orbital',
};

/**
 * Resolve a model-authored camera mode to one the engine recognizes.
 *
 * Falls back rather than passing the string through: the engine's `from_flat`
 * rejects any mode it does not know, and a rejected `set_game_camera` is a
 * silent no-op (PF-1126).
 *
 * The fallback is project-type aware. A 2D game given an unrecognized mode wants
 * `sideScroller`, not a third-person follow camera pointed at a flat scene —
 * `autoPolishExecutor` already branches this way when it repairs a missing
 * camera, and the two disagreeing meant the repair path and the authoring path
 * produced different cameras for the same game.
 */
export function normalizeCameraMode(
  raw: unknown,
  projectType?: '2d' | '3d',
): GameCameraMode {
  const fallback: GameCameraMode = projectType === '2d' ? 'sideScroller' : 'thirdPersonFollow';
  if (typeof raw !== 'string') return fallback;
  // Exact match first, on the ORIGINAL string. The engine's mode names are
  // camelCase, so testing the lowercased form against them would reject
  // `sideScroller` — the alias lookup is lowercased, the mode check must not be.
  if (isCameraMode(raw)) return raw;
  // Own-key read, though `isCameraMode` would catch the fallout either way: a GDD
  // mode string of `constructor` makes a bare `CAMERA_MODE_ALIASES[key]` return
  // `Object.prototype.constructor`, which is not nullish, so `??` does not fall
  // back and a FUNCTION reaches the narrowing check. It fails there and the
  // default is returned, so the bare form is not exploitable — but it gets there
  // by accident, and the guard says what was meant.
  const key = raw.toLowerCase();
  const aliased = Object.hasOwn(CAMERA_MODE_ALIASES, key) ? CAMERA_MODE_ALIASES[key] : raw;
  return isCameraMode(aliased) ? aliased : fallback;
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
  // A GDD-spelled key only fills a field the translator's own names left unset,
  // so an explicit `topDownHeight` always beats an aliased `altitude`.
  for (const [alias, field] of Object.entries(GDD_CONFIG_KEY_ALIASES)) {
    if (out[field] !== undefined) continue;
    if (!Object.hasOwn(obj, alias)) continue;
    const val = obj[alias];
    if (typeof val === 'number' && Number.isFinite(val)) out[field] = val;
  }
  return out;
}

/**
 * GDD config spellings that map onto an engine parameter without changing units.
 *
 * Deliberately short. The GDD's camera `config` vocabulary and the engine's
 * parameter list were written independently and overlap in exactly NOTHING: the
 * keys the generator actually emits are `altitude`, `tilt`, `smoothing`,
 * `offset`, `perspective`, `followX`, `followY`, `leadAhead`, `zoomMin`,
 * `zoomMax`, `canOrbit` and `locked`, while the translator accepts
 * `followDistance`, `followHeight`, `topDownHeight` and friends. So before this
 * map, `filterCameraNumerics` returned `{}` for 100% of real GDD input while the
 * step still reported `applied: true`.
 *
 * `smoothing` is the conspicuous omission, and it is omitted on purpose: the GDD
 * means a 0..1 lerp factor and the engine's `followSmoothing` is a rate per
 * second (`t = (damping * delta).min(1.0)`, default 5). Forwarding the fixtures'
 * `smoothing: 0.1` as a rate would run the follow ~50x slower than default —
 * a camera that visibly lags the player. A wrong number is worse than a reported
 * omission, so the unit-converting entries are tracked separately (PF-1134)
 * rather than guessed at here. Everything unmapped is REPORTED by
 * {@link unmappedCameraConfigKeys}, which is the part PF-1125 is actually about:
 * the drop was silent.
 */
const GDD_CONFIG_KEY_ALIASES: Record<string, NumericCameraField> = {
  altitude: 'topDownHeight',
};

/**
 * The config keys that reached the engine as nothing.
 *
 * A key lands here when it is neither a translator field nor an alias, and also
 * when it names a real field but carries a value that cannot be sent (a string,
 * `NaN`). Both are the same thing from the user's point of view: they asked for
 * something and the camera ignored it.
 */
export function unmappedCameraConfigKeys(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const fields: readonly string[] = NUMERIC_CAMERA_FIELDS;
  return Object.keys(obj).filter((key) => {
    const isAlias = Object.hasOwn(GDD_CONFIG_KEY_ALIASES, key);
    const field = isAlias ? GDD_CONFIG_KEY_ALIASES[key] : key;
    if (!fields.includes(field)) return true;
    const val = obj[key];
    if (typeof val !== 'number' || !Number.isFinite(val)) return true;
    // An alias loses to an explicit spelling of the same field, so it was
    // accepted-then-overridden — which is still "this key did nothing". It only
    // loses to a SENDABLE value, matching `filterCameraNumerics`: an explicit
    // `topDownHeight: NaN` is dropped, and then the alias is what applies.
    if (!isAlias) return false;
    const direct = obj[field];
    return typeof direct === 'number' && Number.isFinite(direct);
  });
}
