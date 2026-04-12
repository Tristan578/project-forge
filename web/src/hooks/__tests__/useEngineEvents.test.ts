import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEngineEvents } from '../useEngineEvents';
import { useEditorStore, setCommandDispatcher } from '@/stores/editorStore';
import * as events from '../events';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    setState: vi.fn(),
    getState: vi.fn(),
  },
  setCommandDispatcher: vi.fn(),
  setCommandBatchDispatcher: vi.fn(),
}));

vi.mock('../events', () => ({
  handleTransformEvent: vi.fn().mockReturnValue(false),
  handleMaterialEvent: vi.fn().mockReturnValue(false),
  handlePhysicsEvent: vi.fn().mockReturnValue(false),
  handleAudioEvent: vi.fn().mockReturnValue(false),
  handleAnimationEvent: vi.fn().mockReturnValue(false),
  handleGameEvent: vi.fn().mockReturnValue(false),
  handleSpriteEvent: vi.fn().mockReturnValue(false),
  handleParticleEvent: vi.fn().mockReturnValue(false),
  handlePerformanceEvent: vi.fn().mockReturnValue(false),
  handleEditModeEvent: vi.fn().mockReturnValue(false),
}));

describe('useEngineEvents', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let wasmModule: any;

  beforeEach(() => {
    vi.clearAllMocks();
    wasmModule = {
      set_event_callback: vi.fn(),
      handle_command: vi.fn(),
    };
    
    // Silence console.warn for unknown events
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('registers command dispatcher on mount', () => {
    renderHook(() => useEngineEvents({ wasmModule }));
    expect(setCommandDispatcher).toHaveBeenCalled();
    
    // Test that the dispatcher works
    const dispatcher = vi.mocked(setCommandDispatcher).mock.calls[0][0];
    dispatcher('test_command', { foo: 'bar' });
    expect(wasmModule.handle_command).toHaveBeenCalledWith('test_command', { foo: 'bar' });
  });

  it('catches and logs errors during command dispatch', () => {
    wasmModule.handle_command.mockImplementation(() => { throw new Error('WASM crash'); });
    renderHook(() => useEngineEvents({ wasmModule }));
    
    const dispatcher = vi.mocked(setCommandDispatcher).mock.calls[0][0];
    dispatcher('crash_command', {});
    
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Error dispatching command 'crash_command':"), 
      expect.any(Error)
    );
  });

  it('registers event callback with WASM', () => {
    renderHook(() => useEngineEvents({ wasmModule }));
    expect(wasmModule.set_event_callback).toHaveBeenCalled();
  });

  it('delegates parsed events to domain handlers', () => {
    renderHook(() => useEngineEvents({ wasmModule }));
    const callback = wasmModule.set_event_callback.mock.calls[0][0];

    // Simulate an event that the transform handler understands
    vi.mocked(events.handleTransformEvent).mockReturnValueOnce(true);
    callback({ type: 'entity_moved', payload: { id: '1', position: [0, 1, 0] } });

    expect(events.handleTransformEvent).toHaveBeenCalledWith(
      'entity_moved', 
      { id: '1', position: [0, 1, 0] },
      useEditorStore.setState,
      useEditorStore.getState
    );
    
    // It should stop after the first handler returns true, so material handler shouldn't be called
    expect(events.handleMaterialEvent).not.toHaveBeenCalled();
  });

  it('warns on unknown engine event', () => {
    renderHook(() => useEngineEvents({ wasmModule }));
    const callback = wasmModule.set_event_callback.mock.calls[0][0];

    callback({ type: 'unknown_event', payload: {} });

    // All handlers return false by default in our mock
    expect(events.handleTransformEvent).toHaveBeenCalled();
    expect(events.handleEditModeEvent).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('Unknown engine event:', 'unknown_event');
  });

  it('does nothing if wasmModule is null', () => {
    renderHook(() => useEngineEvents({ wasmModule: null }));
    expect(setCommandDispatcher).not.toHaveBeenCalled();
  });
});
