/**
 * Unit tests for the scriptSlice — entity scripts and input bindings.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createScriptSlice, setScriptDispatcher, type ScriptSlice } from '../slices/scriptSlice';
import type { ScriptLogEntry, InputBinding } from '../slices/types';

function createTestStore() {
  const store = { state: {} as ScriptSlice };
  const set = (partial: Partial<ScriptSlice> | ((s: ScriptSlice) => Partial<ScriptSlice>)) => {
    if (typeof partial === 'function') Object.assign(store.state, partial(store.state));
    else Object.assign(store.state, partial);
  };
  const get = () => store.state;
  store.state = createScriptSlice(set as never, get as never, {} as never);
  return { getState: () => store.state };
}

describe('scriptSlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    setScriptDispatcher(mockDispatch as (command: string, payload: unknown) => void);
    store = createTestStore();
  });

  describe('Initial state', () => {
    it('should have null primary script', () => {
      expect(store.getState().primaryScript).toBeNull();
    });

    it('should have empty allScripts', () => {
      expect(store.getState().allScripts).toEqual({});
    });

    it('should have empty script logs', () => {
      expect(store.getState().scriptLogs).toEqual([]);
    });

    it('should have empty input bindings', () => {
      expect(store.getState().inputBindings).toEqual([]);
    });

    it('should have null input preset', () => {
      expect(store.getState().inputPreset).toBeNull();
    });
  });

  describe('Script CRUD', () => {
    it('setScript updates allScripts and dispatches', () => {
      store.getState().setScript('ent-1', 'console.log("hi")', true, 'basic');
      expect(store.getState().allScripts['ent-1']).toEqual({ source: 'console.log("hi")', enabled: true, template: 'basic' });
      expect(mockDispatch).toHaveBeenCalledWith('set_script', { entityId: 'ent-1', source: 'console.log("hi")', enabled: true, template: 'basic' });
    });

    it('removeScript removes from allScripts and dispatches', () => {
      store.getState().setScript('ent-1', 'code', true);
      mockDispatch.mockClear();
      store.getState().removeScript('ent-1');
      expect(store.getState().allScripts['ent-1']).toBeUndefined();
      expect(mockDispatch).toHaveBeenCalledWith('remove_script', { entityId: 'ent-1' });
    });

    it('removeScript preserves other scripts', () => {
      store.getState().setScript('ent-1', 'a', true);
      store.getState().setScript('ent-2', 'b', true);
      store.getState().removeScript('ent-1');
      expect(store.getState().allScripts['ent-2']).toBeDefined();
    });

    it('applyScriptTemplate sets enabled=true and dispatches set_script', () => {
      store.getState().applyScriptTemplate('ent-1', 'fps-controller', 'template code');
      expect(store.getState().allScripts['ent-1']).toEqual({ source: 'template code', enabled: true, template: 'fps-controller' });
      expect(mockDispatch).toHaveBeenCalledWith('set_script', { entityId: 'ent-1', source: 'template code', enabled: true, template: 'fps-controller' });
    });
  });

  describe('Primary script', () => {
    it('setPrimaryScript sets without dispatch', () => {
      const script = { source: 'code', enabled: true };
      store.getState().setPrimaryScript(script);
      expect(store.getState().primaryScript).toEqual(script);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('setPrimaryScript accepts null', () => {
      store.getState().setPrimaryScript({ source: 'code', enabled: true });
      store.getState().setPrimaryScript(null);
      expect(store.getState().primaryScript).toBeNull();
    });

    it('setEntityScript sets primaryScript without dispatch', () => {
      const script = { source: 'code', enabled: false };
      store.getState().setEntityScript('ent-1', script);
      expect(store.getState().primaryScript).toEqual(script);
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('Script logs', () => {
    const logEntry: ScriptLogEntry = { entityId: 'ent-1', level: 'info', message: 'test', timestamp: 1000 };

    it('addScriptLog appends entry', () => {
      store.getState().addScriptLog(logEntry);
      expect(store.getState().scriptLogs).toHaveLength(1);
      expect(store.getState().scriptLogs[0]).toEqual(logEntry);
    });

    it('addScriptLog caps at 200 entries', () => {
      for (let i = 0; i < 210; i++) {
        store.getState().addScriptLog({ ...logEntry, timestamp: i });
      }
      expect(store.getState().scriptLogs).toHaveLength(200);
      // Oldest entries dropped — first entry should be timestamp 10
      expect(store.getState().scriptLogs[0].timestamp).toBe(10);
    });

    it('clearScriptLogs empties the array', () => {
      store.getState().addScriptLog(logEntry);
      store.getState().clearScriptLogs();
      expect(store.getState().scriptLogs).toEqual([]);
    });
  });

  describe('Input bindings', () => {
    const binding: InputBinding = { actionName: 'jump', actionType: 'digital', sources: ['Space'] };

    it('setInputBinding adds new binding and dispatches', () => {
      store.getState().setInputBinding(binding);
      expect(store.getState().inputBindings).toHaveLength(1);
      expect(store.getState().inputBindings[0]).toEqual(binding);
      expect(mockDispatch).toHaveBeenCalledWith('set_input_binding', binding);
    });

    it('setInputBinding replaces existing binding with same actionName', () => {
      store.getState().setInputBinding(binding);
      const updated = { ...binding, sources: ['Space', 'KeyW'] };
      store.getState().setInputBinding(updated);
      expect(store.getState().inputBindings).toHaveLength(1);
      expect(store.getState().inputBindings[0].sources).toEqual(['Space', 'KeyW']);
    });

    it('removeInputBinding removes by actionName and dispatches', () => {
      store.getState().setInputBinding(binding);
      mockDispatch.mockClear();
      store.getState().removeInputBinding('jump');
      expect(store.getState().inputBindings).toHaveLength(0);
      expect(mockDispatch).toHaveBeenCalledWith('remove_input_binding', { actionName: 'jump' });
    });

    it('setInputPreset updates preset and dispatches', () => {
      store.getState().setInputPreset('fps');
      expect(store.getState().inputPreset).toBe('fps');
      expect(mockDispatch).toHaveBeenCalledWith('set_input_preset', { preset: 'fps' });
    });

    it('setInputBindings bulk-sets bindings and preset without dispatch', () => {
      const bindings = [binding, { actionName: 'fire', actionType: 'digital' as const, sources: ['Mouse0'] }];
      store.getState().setInputBindings(bindings, 'fps');
      expect(store.getState().inputBindings).toHaveLength(2);
      expect(store.getState().inputPreset).toBe('fps');
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('Dispatcher not set', () => {
    it('does not throw when dispatcher is null', () => {
      setScriptDispatcher(null as never);
      store = createTestStore();
      expect(() => store.getState().setScript('e', 'code', true)).not.toThrow();
      expect(() => store.getState().removeScript('e')).not.toThrow();
      expect(() => store.getState().setInputPreset('fps')).not.toThrow();
    });
  });
});
