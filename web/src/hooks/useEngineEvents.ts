/**
 * Hook for receiving and dispatching engine events from/to Rust.
 *
 * This hook connects the WASM module's event callback to the Zustand store,
 * translating Rust events into React state updates.
 */

import { useEffect, useCallback } from 'react';
import { useEditorStore, setCommandDispatcher, setCommandBatchDispatcher } from '@/stores/editorStore';
import {
  handleTransformEvent,
  handleMaterialEvent,
  handlePhysicsEvent,
  handleAudioEvent,
  handleAnimationEvent,
  handleGameEvent,
  handleSpriteEvent,
  handleParticleEvent,
  handlePerformanceEvent,
  handleEditModeEvent,
} from './events';
import { createSelectionBatcher, type SelectionPayload } from './selectionBatcher';
import { createPlayModeThrottle } from '@/lib/throttle/playModeThrottle';

/**
 * Events that carry high-frequency runtime data and can be throttled to 10fps
 * during play mode without meaningful loss of user-perceivable fidelity.
 *
 * Events NOT in this set (scene graph changes, selection, mode transitions,
 * collision events, script errors, history changes) are always processed immediately.
 */
const THROTTLED_EVENTS = new Set([
  'TRANSFORM_CHANGED',
  'ANIMATION_STATE_CHANGED',
  'ANIMATION_LIST_CHANGED',
  'PHYSICS_CHANGED',
  'DEBUG_PHYSICS_CHANGED',
  'PHYSICS2D_UPDATED',
]);

interface UseEngineEventsOptions {
  wasmModule: {
    set_event_callback?: (callback: (event: unknown) => void) => void;
    handle_command?: (command: string, payload: unknown) => unknown;
    handle_command_batch?: (batch: unknown) => unknown;
  } | null;
}

/**
 * Hook that connects WASM events to the Zustand store.
 * Should be called once at the app level after WASM is loaded.
 */
export function useEngineEvents({ wasmModule }: UseEngineEventsOptions): void {
  // Create command dispatcher
  const dispatchCommand = useCallback(
    (command: string, payload: unknown) => {
      if (wasmModule?.handle_command) {
        try {
          wasmModule.handle_command(command, payload);
        } catch (error) {
          console.error(`Error dispatching command '${command}':`, error);
        }
      }
    },
    [wasmModule]
  );

  const dispatchCommandBatch = useCallback(
    (commands: Array<{ command: string; payload?: unknown }>) => {
      if (commands.length > 256) {
        console.error(`Batch size ${commands.length} exceeds limit of 256`);
        return { success: false, results: [] };
      }
      if (wasmModule?.handle_command_batch) {
        try {
          const results = wasmModule.handle_command_batch(commands) as Array<{ success: boolean; error?: string }>;
          return {
            success: results.every((r) => r.success),
            results,
          };
        } catch (error) {
          console.error('Error dispatching command batch:', error);
          return { success: false, results: [] };
        }
      }
      return { success: false, results: [] };
    },
    [wasmModule],
  );

  // Register command dispatchers with the store
  useEffect(() => {
    if (wasmModule) {
      setCommandDispatcher(dispatchCommand);
      setCommandBatchDispatcher(dispatchCommandBatch);
    }
  }, [wasmModule, dispatchCommand, dispatchCommandBatch]);

  // Register event callback with WASM
  useEffect(() => {
    if (!wasmModule?.set_event_callback) {
      return;
    }

    // Batch rapid SELECTION_CHANGED events into a single store update.
    // When an entity is selected, the Rust bridge emits SELECTION_CHANGED
    // followed immediately by 15+ component-data events in the same tick.
    // Each WASM→JS call crosses the boundary synchronously, so we coalesce
    // them with queueMicrotask and only apply the final payload.
    const selectionBatcher = createSelectionBatcher((batchedPayload: SelectionPayload) => {
      const set = useEditorStore.setState;
      const get = useEditorStore.getState;
      handleTransformEvent('SELECTION_CHANGED', batchedPayload as unknown as Record<string, unknown>, set, get);
    });

    // Throttle instances for high-frequency play-mode events.
    // One shared throttle is sufficient because all throttled events are
    // display-only updates that share the same 10fps budget.
    const playThrottle = createPlayModeThrottle(100);

    const handleEvent = (rawEvent: unknown) => {
      const parsedEvent = rawEvent as { type: string; payload: Record<string, unknown> };
      const { type, payload } = parsedEvent;

      // Intercept SELECTION_CHANGED and route through the batcher so that
      // rapid back-to-back emissions (one per selection request) coalesce
      // into a single Zustand setState call.
      if (type === 'SELECTION_CHANGED') {
        selectionBatcher.batch(payload as unknown as SelectionPayload);
        return;
      }

      // On mode transitions reset the throttle so the inspector immediately
      // reflects the current engine state after switching back to edit mode.
      if (type === 'ENGINE_MODE_CHANGED') {
        playThrottle.reset();
      }

      const set = useEditorStore.setState;
      const get = useEditorStore.getState;

      // Throttle high-frequency runtime events during play/paused mode to 10fps.
      // This prevents 60fps Bevy ticks from driving 60fps React re-renders for
      // data the user cannot perceive faster than ~10fps in the inspector.
      if (THROTTLED_EVENTS.has(type)) {
        const { engineMode } = useEditorStore.getState();
        const isPlayMode = engineMode === 'play' || engineMode === 'paused';
        if (!playThrottle.shouldUpdate(isPlayMode)) {
          return;
        }
      }

      // Delegate to domain handlers (return true if handled)
      if (handleTransformEvent(type, payload, set, get)) return;
      if (handleMaterialEvent(type, payload, set, get)) return;
      if (handlePhysicsEvent(type, payload, set, get)) return;
      if (handleAudioEvent(type, payload, set, get)) return;
      if (handleAnimationEvent(type, payload, set, get)) return;
      if (handleGameEvent(type, payload, set, get)) return;
      if (handleSpriteEvent(type, payload, set, get)) return;
      if (handleParticleEvent(type, payload, set, get)) return;
      if (handlePerformanceEvent(type, payload, set, get)) return;
      if (handleEditModeEvent(type, payload, set, get)) return;

      console.warn('Unknown engine event:', type);
    };

    wasmModule.set_event_callback(handleEvent);
  }, [wasmModule]);
}
