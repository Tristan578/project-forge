/**
 * Game slice - manages game components, game cameras, mobile controls, HUD, and engine mode.
 */

import { StateCreator } from 'zustand';
import type { GameComponentData, GameCameraData, MobileTouchConfig, HudElement, EngineMode, SceneGraph } from './types';
import type { LoadingScreenConfig } from '@/lib/export/loadingScreen';
import type { AccessibilityProfile } from '@/lib/ai/accessibilityGenerator';
import { createDefaultProfile } from '@/lib/ai/accessibilityGenerator';
import type { ExportPreset } from '@/lib/export/presets';
import { validateWinnability, formatWinnabilityMessage } from '@/lib/playMode/winnabilityValidator';
import {
  toWireComponent,
  toEngineComponentType,
  toStoreComponentType,
  normalizeGameComponentWithReport,
  gameComponentFields,
} from '@/lib/engine/gameComponentWire';
import {
  componentAdjustmentsOf,
  nextComponentAdjustments,
  withComponentAdjustments,
  type GameComponentAdjustments,
  type GameComponentFieldCorrection,
  type GameComponentWriteReport,
} from '@/lib/engine/gameComponentCorrections';
import { buildSetGameCameraPayload } from '@/lib/game/gameCameraPayload';

export interface GameSlice {
  allGameComponents: Record<string, GameComponentData[]>;
  primaryGameComponents: GameComponentData[] | null;
  /**
   * Which game-component fields hold a different value than the one asked for,
   * and what was asked for (PF-1148). entityId -> component type -> field.
   *
   * Ephemeral editor state: it records how a value came to be during this
   * session, which is not part of the game. It is never written into a
   * component, a wire payload or a scene file — the components in
   * `allGameComponents` stay exactly the shape the engine and the export read.
   * Set by `addGameComponent` / `updateGameComponent`, cleared per field when
   * that field is next written without a correction, and pruned against the
   * engine's own report in `gameEvents.ts`.
   */
  gameComponentAdjustments: GameComponentAdjustments;
  allGameCameras: Record<string, GameCameraData>;
  activeGameCameraId: string | null;
  mobileTouchConfig: MobileTouchConfig;
  hudElements: HudElement[];
  engineMode: EngineMode;
  loadingScreenConfig: LoadingScreenConfig | null;
  accessibilityProfile: AccessibilityProfile | null;
  exportPreset: { presetKey: string; config: ExportPreset } | null;
  /** True once the active play session has been won (engine win condition met or `forge.game.win()`). */
  gameWon: boolean;
  /** Current player score for the active play session, surfaced to the HUD. */
  gameScore: number;

  /**
   * `report` is what building `component` did to the caller's request — pass
   * the result of `buildStoreComponentWithReport` when the values came from a
   * tool call. The store adds whatever its own normalization changes on top, so
   * a raw inspector value is covered without one.
   */
  addGameComponent: (entityId: string, component: GameComponentData, report?: GameComponentWriteReport) => void;
  updateGameComponent: (entityId: string, component: GameComponentData, report?: GameComponentWriteReport) => void;
  removeGameComponent: (entityId: string, componentName: string) => void;
  setGameCamera: (entityId: string, data: GameCameraData) => void;
  removeGameCamera: (entityId: string) => void;
  setActiveGameCamera: (entityId: string | null) => void;
  cameraShake: (entityId: string, intensity: number, duration: number) => void;
  setEntityGameCamera: (entityId: string, data: GameCameraData | null) => void;
  setActiveGameCameraId: (entityId: string | null) => void;
  setMobileTouchConfig: (config: MobileTouchConfig) => void;
  updateMobileTouchConfig: (partial: Partial<MobileTouchConfig>) => void;
  setHudElements: (elements: HudElement[]) => void;
  setLoadingScreenConfig: (config: LoadingScreenConfig | null) => void;
  setAccessibilityProfile: (profile: AccessibilityProfile | null) => void;
  updateAccessibilityProfile: (partial: Partial<AccessibilityProfile>) => void;
  setExportPreset: (presetKey: string, config: ExportPreset) => void;
  clearExportPreset: () => void;
  setGameWon: (won: boolean) => void;
  setGameScore: (score: number) => void;
  play: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  setEngineMode: (mode: EngineMode) => void;
}

let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setGameDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

/**
 * Cross-slice reader for the pre-play winnability gate. `play()` lives in this
 * slice but the validator needs the scene graph (a different slice), so the
 * composition root wires a reader that returns the full state it needs. When
 * unset (e.g. before the engine mounts, or in slice-only unit tests) the gate
 * is skipped and `play()` behaves exactly as before.
 */
type WinnabilityState = { sceneGraph: SceneGraph; allGameComponents: Record<string, GameComponentData[]> };
let readWinnabilityState: (() => WinnabilityState) | null = null;

export function setWinnabilityStateReader(reader: (() => WinnabilityState) | null): void {
  readWinnabilityState = reader;
}

/**
 * The caller's corrections and the store's own, as one list.
 *
 * A caller's record describes the ORIGINAL request, so it is kept whenever the
 * store's normalization agrees with what it says was applied. For a component
 * built by `buildStoreComponentWithReport` that is always, because normalizing
 * a valid component changes nothing. If the store did move the value further,
 * its own record is the true one. Records for a different component type are
 * someone else's report and are ignored.
 */
function mergeCorrections(
  type: GameComponentData['type'],
  fromCaller: readonly GameComponentFieldCorrection[],
  fromStore: readonly GameComponentFieldCorrection[],
): GameComponentFieldCorrection[] {
  const byField = new Map<string, GameComponentFieldCorrection>();
  for (const c of fromCaller) if (c.component === type) byField.set(c.field, c);
  for (const c of fromStore) byField.set(c.field, c);
  return [...byField.values()];
}

/** Best-effort unique id; `crypto.randomUUID` is unavailable in non-secure contexts. */
function messageId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `wnbl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Surface an actionable message into the chat panel without coupling slices.
 * Posted as `role: 'system'` so it renders as a notice to the user (ChatMessage)
 * but is filtered out of the AI request payload (chatStore.buildApiMessages) —
 * the gate's feedback never re-enters the model's context as if the AI said it.
 */
function surfaceWinnabilityMessage(message: string): void {
  // Compute the impure id/timestamp once, outside the updater, so the message
  // is identical no matter how many times the store runs the updater.
  const entry = { id: messageId(), role: 'system' as const, content: message, timestamp: Date.now() };
  import('@/stores/chatStore').then(({ useChatStore }) => {
    // Updater form: read-modify-write atomically so a concurrent chat write
    // (e.g. a streaming token) can't be clobbered between get and set.
    useChatStore.setState((state) => ({
      messages: [...state.messages, entry],
      rightPanelTab: 'chat',
      // We switch the user TO the chat tab in this same update, so the message
      // is immediately on-screen — there is nothing "unread". Setting it true
      // would flag an unread badge on the very tab they're now viewing, and
      // contradicts chatStore's invariant (tab === 'chat' ⟹ unread false; see
      // chatStore setRightPanelTab + the rightPanelTab !== 'chat' append rule).
      hasUnreadMessages: false,
    }));
  }).catch(() => { /* chat surface is best-effort */ });
}

export const createGameSlice: StateCreator<GameSlice, [], [], GameSlice> = (set, get) => ({
  allGameComponents: {},
  primaryGameComponents: null,
  gameComponentAdjustments: {},
  allGameCameras: {},
  activeGameCameraId: null,
  mobileTouchConfig: {
    enabled: true,
    autoDetect: true,
    preset: 'platformer',
    joystick: { position: 'bottom-left', size: 120, deadZone: 0.15, opacity: 0.6, mode: 'floating', actions: { horizontal: 'move_right', vertical: 'move_forward' } },
    buttons: [{ id: 'jump', action: 'jump', position: { x: 85, y: 75 }, size: 80, icon: '↑', opacity: 0.6 }],
    preferredOrientation: 'any',
    autoReduceQuality: true,
  },
  hudElements: [],
  engineMode: 'edit',
  loadingScreenConfig: null,
  accessibilityProfile: null,
  exportPreset: null,
  gameWon: false,
  gameScore: 0,

  addGameComponent: (entityId, raw, report) => {
    // Normalize BEFORE the store write so the store and the engine hold the same
    // numbers — the engine rounds and clamps its `u32` fields, and a divergence
    // there is silent (see gameComponentWire.ts).
    const normalized = normalizeGameComponentWithReport(raw);
    const component = normalized.component;
    const corrections = mergeCorrections(component.type, report?.corrections ?? [], normalized.corrections);
    set(state => {
      // Replace any existing component of the same type rather than appending.
      // `build_game_component` keys on `componentType` and OVERWRITES, so the
      // engine holds exactly one per type — an unconditional push made the store
      // hold two after any re-run of a step that adds a component (the
      // generation pipeline is retryable), and nothing would report the
      // divergence because `dispatchCommand` returns void. This matches
      // `updateGameComponent`, which already keys on `type`.
      const existing = state.allGameComponents[entityId] || [];
      // A whole new component, so the old markers go with the old component:
      // only what THIS write corrected is marked.
      const adjustments = nextComponentAdjustments({
        previous: undefined,
        previousFields: undefined,
        nextFields: gameComponentFields(component),
        corrections,
        supplied: report?.supplied ?? [],
      });
      return {
        allGameComponents: {
          ...state.allGameComponents,
          [entityId]: [...existing.filter(c => c.type !== component.type), component],
        },
        gameComponentAdjustments: withComponentAdjustments(
          state.gameComponentAdjustments,
          entityId,
          component.type,
          adjustments,
        ),
      };
    });
    // The engine wants `{ entityId, componentType, properties }`, not the store's
    // tagged union — see gameComponentWire.ts. Dispatching the store shape makes
    // handle_add_game_component reject with "Missing componentType", and because
    // dispatchCommand returns void that rejection is invisible here: the store
    // would keep a component the engine never received.
    if (dispatchCommand) dispatchCommand('add_game_component', { entityId, ...toWireComponent(component) });
  },
  updateGameComponent: (entityId, raw, report) => {
    const normalized = normalizeGameComponentWithReport(raw);
    const component = normalized.component;
    const corrections = mergeCorrections(component.type, report?.corrections ?? [], normalized.corrections);
    set(state => {
      const list = state.allGameComponents[entityId] || [];
      const previous = list.find(c => c.type === component.type);
      // Per field: a marker survives only while its field is neither written
      // explicitly nor changed. The inspector sends the whole component on every
      // edit, so "changed" is what tells the Pause edit apart from the Speed one.
      const adjustments = nextComponentAdjustments({
        previous: componentAdjustmentsOf(state.gameComponentAdjustments, entityId, component.type),
        previousFields: previous ? gameComponentFields(previous) : undefined,
        nextFields: gameComponentFields(component),
        corrections,
        supplied: report?.supplied ?? [],
      });
      return {
        allGameComponents: {
          ...state.allGameComponents,
          [entityId]: list.map(c => c.type === component.type ? component : c),
        },
        gameComponentAdjustments: withComponentAdjustments(
          state.gameComponentAdjustments,
          entityId,
          component.type,
          adjustments,
        ),
      };
    });
    if (dispatchCommand) dispatchCommand('update_game_component', { entityId, ...toWireComponent(component) });
  },
  removeGameComponent: (entityId, componentName) => {
    // Callers disagree on vocabulary: the inspector removes by the engine's
    // snake_case name while the store's own entries are keyed by the camelCase
    // discriminant. Normalize both sides — comparing the two spellings directly
    // never matches, which is why the inspector's Remove button did nothing.
    const storeType = toStoreComponentType(componentName);
    if (storeType) {
      set(state => ({
        allGameComponents: {
          ...state.allGameComponents,
          [entityId]: (state.allGameComponents[entityId] || []).filter(c => c.type !== storeType),
        },
        gameComponentAdjustments: withComponentAdjustments(
          state.gameComponentAdjustments,
          entityId,
          storeType,
          undefined,
        ),
      }));
    }
    // An unrecognized name is still forwarded so the engine sees exactly what the
    // caller asked for (it will ignore it) rather than a silently rewritten name.
    const engineName = toEngineComponentType(componentName) ?? componentName;
    if (dispatchCommand) dispatchCommand('remove_game_component', { entityId, componentName: engineName });
  },
  setGameCamera: (entityId, data) => {
    set(state => ({ allGameCameras: { ...state.allGameCameras, [entityId]: data } }));
    // Spreading `data` here sent the engine nothing it could read — the store's
    // authoring vocabulary (`followDistance`, `topDownHeight`, …) shares no key
    // with the engine's wire form beyond `mode`, and the mode itself was the
    // camelCase variant, which `serde` rejected outright. See gameCameraPayload.ts.
    if (dispatchCommand) dispatchCommand('set_game_camera', buildSetGameCameraPayload(entityId, data));
  },
  removeGameCamera: (entityId) => {
    set(state => {
      const { [entityId]: _, ...rest } = state.allGameCameras;
      return { allGameCameras: rest };
    });
    if (dispatchCommand) dispatchCommand('remove_game_camera', { entityId });
  },
  setActiveGameCamera: (entityId) => {
    set({ activeGameCameraId: entityId });
    if (dispatchCommand) dispatchCommand('set_active_game_camera', { entityId });
  },
  cameraShake: (entityId, intensity, duration) => {
    if (dispatchCommand) dispatchCommand('camera_shake', { entityId, intensity, duration });
  },
  // Inbound engine event. The entityId was previously ignored entirely, so a
  // camera change on ANY entity overwrote the inspector's primary camera and
  // `allGameCameras` was never populated from the engine at all. The inspector
  // now derives its view from this record keyed by the selected entity, so there
  // is no parallel `primaryGameCamera` field to keep in sync (and no reason for
  // this slice to reach across into the selection slice to do it).
  setEntityGameCamera: (entityId, data) => set(state => {
    // The set branch defines the key in an object literal rather than assigning
    // `record[entityId] = data`. A plain assignment is `Set`, which walks the
    // prototype chain, so an entityId of `"__proto__"` would hit the inherited
    // setter instead: the camera would silently fail to store AND the record
    // would be reparented to it, after which every miss-lookup resolves through
    // the prototype and returns that camera for entities that have none. A
    // computed key in a literal is `DefineOwnProperty` and does neither.
    //
    // `"__proto__"` is a reachable entity id, not a hypothetical: `zEntityId` is
    // `z.string().min(1)`, and the engine's `is_valid_override_id` rejects only
    // empty, over-64-byte and control-character ids — so a model can name an
    // entity that and the engine will emit `GAME_CAMERA_CHANGED` for it.
    if (data) return { allGameCameras: { ...state.allGameCameras, [entityId]: data } };
    const { [entityId]: _removed, ...rest } = state.allGameCameras;
    return { allGameCameras: rest };
  }),
  setActiveGameCameraId: (entityId) => set({ activeGameCameraId: entityId }),
  setMobileTouchConfig: (config) => set({ mobileTouchConfig: config }),
  updateMobileTouchConfig: (partial) => {
    const state = get();
    set({ mobileTouchConfig: { ...state.mobileTouchConfig, ...partial } });
  },
  setHudElements: (elements) => set({ hudElements: elements }),
  setLoadingScreenConfig: (config) => set({ loadingScreenConfig: config }),
  setAccessibilityProfile: (profile) => set({ accessibilityProfile: profile }),
  updateAccessibilityProfile: (partial) => {
    const current = get().accessibilityProfile ?? createDefaultProfile();
    // Deep merge each top-level section to preserve nested required fields
    set({
      accessibilityProfile: {
        colorblindMode: { ...current.colorblindMode, ...partial.colorblindMode },
        screenReader: { ...current.screenReader, ...partial.screenReader },
        inputRemapping: { ...current.inputRemapping, ...partial.inputRemapping },
        subtitles: { ...current.subtitles, ...partial.subtitles },
        fontSize: { ...current.fontSize, ...partial.fontSize },
      },
    });
  },
  setExportPreset: (presetKey, config) => set({ exportPreset: { presetKey, config } }),
  clearExportPreset: () => set({ exportPreset: null }),
  setGameWon: (won) => set({ gameWon: won }),
  setGameScore: (score) => set({ gameScore: score }),
  play: () => {
    // Pre-play winnability gate: block entry and explain why if the scene
    // can never be won, so the user isn't dropped into an unwinnable game.
    // This is a UX safety net, not a security control — if the check itself
    // throws, fail OPEN (fall through to dispatch) rather than trapping the
    // user out of Play.
    if (readWinnabilityState) {
      try {
        const { sceneGraph, allGameComponents } = readWinnabilityState();
        // Respect the scene's authored completion mode: a sandbox/endless/
        // narrative scene is not blocked for lacking a win condition. Absent
        // (legacy) => 'win' via the validator default.
        const report = validateWinnability(sceneGraph, allGameComponents, sceneGraph.completionMode);
        if (!report.winnable) {
          surfaceWinnabilityMessage(formatWinnabilityMessage(report));
          return;
        }
      } catch {
        /* gate failure must never block Play — proceed as if winnable */
      }
    }
    // Each play session starts fresh: clear any win/score carried over from a prior run.
    // Runs only after the winnability gate passes — a blocked Play leaves state untouched.
    set({ gameWon: false, gameScore: 0 });
    if (dispatchCommand) dispatchCommand('play', {});
    import('@/lib/analytics/events').then(m => m.trackPlayModeStarted()).catch(() => { /* analytics non-critical */ });
  },
  stop: () => {
    set({ gameWon: false, gameScore: 0 });
    if (dispatchCommand) dispatchCommand('stop', {});
  },
  pause: () => {
    if (dispatchCommand) dispatchCommand('pause', {});
  },
  resume: () => {
    if (dispatchCommand) dispatchCommand('resume', {});
  },
  setEngineMode: (mode) => set({ engineMode: mode }),
});
