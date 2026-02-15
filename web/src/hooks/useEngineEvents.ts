/**
 * Hook for receiving and dispatching engine events from/to Rust.
 *
 * This hook connects the WASM module's event callback to the Zustand store,
 * translating Rust events into React state updates.
 */

import { useEffect, useCallback } from 'react';
import { useEditorStore, setCommandDispatcher } from '@/stores/editorStore';
import {
  handleTransformEvent,
  handleMaterialEvent,
  handlePhysicsEvent,
  handleAudioEvent,
  handleAnimationEvent,
  handleGameEvent,
  handleSpriteEvent,
  handleParticleEvent,
} from './events';

interface UseEngineEventsOptions {
  wasmModule: {
    set_event_callback?: (callback: (event: unknown) => void) => void;
    handle_command?: (command: string, payload: unknown) => unknown;
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

  // Register command dispatcher with the store
  useEffect(() => {
    if (wasmModule) {
      setCommandDispatcher(dispatchCommand);
    }
  }, [wasmModule, dispatchCommand]);

  // Register event callback with WASM
  useEffect(() => {
    if (!wasmModule?.set_event_callback) {
      return;
    }

    const handleEvent = (rawEvent: unknown) => {
      const parsedEvent = rawEvent as { type: string; payload: Record<string, unknown> };
      const { type, payload } = parsedEvent;

      console.log('[Engine Event]', type, payload);

      const set = useEditorStore.setState;
      const get = useEditorStore.getState;

      // Delegate to domain handlers (return true if handled)
      if (handleTransformEvent(type, payload, set, get)) return;
      if (handleMaterialEvent(type, payload, set, get)) return;
      if (handlePhysicsEvent(type, payload, set, get)) return;
      if (handleAudioEvent(type, payload, set, get)) return;
      if (handleAnimationEvent(type, payload, set, get)) return;
      if (handleGameEvent(type, payload, set, get)) return;
      if (handleSpriteEvent(type, payload, set, get)) return;
      if (handleParticleEvent(type, payload, set, get)) return;

      console.warn('Unknown engine event:', type);
    };

    wasmModule.set_event_callback(handleEvent);
    console.log('[useEngineEvents] Event callback registered');
  }, [wasmModule]);
}
