import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createScriptSlice, setScriptDispatcher, type ScriptSlice } from '../scriptSlice';

describe('scriptSlice', () => {
  let store: ReturnType<typeof createSliceStore<ScriptSlice>>;
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    mockDispatch = createMockDispatch();
    setScriptDispatcher(mockDispatch);
    store = createSliceStore(createScriptSlice);
  });

  afterEach(() => {
    setScriptDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  describe('Initial state', () => {
    it('should start with empty scripts and logs', () => {
      expect(store.getState().primaryScript).toBeNull();
      expect(store.getState().allScripts).toEqual({});
      expect(store.getState().scriptLogs).toEqual([]);
      expect(store.getState().inputBindings).toEqual([]);
      expect(store.getState().inputPreset).toBeNull();
    });
  });

  describe('setScript', () => {
    it('should add script to allScripts', () => {
      store.getState().setScript('ent-1', 'console.log("hi")', true, 'basic');

      expect(store.getState().allScripts['ent-1']).toEqual({
        source: 'console.log("hi")',
        enabled: true,
        template: 'basic',
      });
    });

    it('should dispatch set_script', () => {
      store.getState().setScript('ent-1', 'code', false);
      expect(mockDispatch).toHaveBeenCalledWith('set_script', {
        entityId: 'ent-1',
        source: 'code',
        enabled: false,
        template: undefined,
      });
    });

    it('should overwrite existing script', () => {
      store.getState().setScript('ent-1', 'v1', true);
      store.getState().setScript('ent-1', 'v2', false);

      expect(store.getState().allScripts['ent-1']).toEqual({
        source: 'v2',
        enabled: false,
        template: undefined,
      });
    });
  });

  describe('removeScript', () => {
    it('should remove script from allScripts', () => {
      store.getState().setScript('ent-1', 'code', true);
      store.getState().removeScript('ent-1');

      expect(store.getState().allScripts['ent-1']).toBeUndefined();
    });

    it('should dispatch remove_script', () => {
      store.getState().removeScript('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('remove_script', { entityId: 'ent-1' });
    });

    it('should not affect other scripts', () => {
      store.getState().setScript('ent-1', 'a', true);
      store.getState().setScript('ent-2', 'b', true);
      store.getState().removeScript('ent-1');

      expect(store.getState().allScripts['ent-2']).toEqual(expect.objectContaining({ source: 'b' }));
    });
  });

  describe('applyScriptTemplate', () => {
    it('should set script with template and enabled=true', () => {
      store.getState().applyScriptTemplate('ent-1', 'fps-controller', 'template code');

      expect(store.getState().allScripts['ent-1']).toEqual({
        source: 'template code',
        enabled: true,
        template: 'fps-controller',
      });
    });

    it('should dispatch set_script with template', () => {
      store.getState().applyScriptTemplate('ent-1', 'tpl-1', 'src');
      expect(mockDispatch).toHaveBeenCalledWith('set_script', {
        entityId: 'ent-1',
        source: 'src',
        enabled: true,
        template: 'tpl-1',
      });
    });
  });

  describe('setPrimaryScript / setEntityScript', () => {
    it('should set primaryScript', () => {
      const script = { source: 'code', enabled: true };
      store.getState().setPrimaryScript(script);
      expect(store.getState().primaryScript).toEqual(script);
    });

    it('should clear primaryScript with null', () => {
      store.getState().setPrimaryScript({ source: 'x', enabled: true });
      store.getState().setPrimaryScript(null);
      expect(store.getState().primaryScript).toBeNull();
    });

    it('setEntityScript should set primaryScript', () => {
      const script = { source: 'entity-code', enabled: false };
      store.getState().setEntityScript('any-id', script);
      expect(store.getState().primaryScript).toEqual(script);
    });
  });

  describe('addScriptLog / clearScriptLogs', () => {
    it('should add log entries', () => {
      store.getState().addScriptLog({ entityId: 'e1', level: 'info', message: 'hello', timestamp: 1 });
      store.getState().addScriptLog({ entityId: 'e1', level: 'error', message: 'oops', timestamp: 2 });

      expect(store.getState().scriptLogs).toHaveLength(2);
      expect(store.getState().scriptLogs[0].message).toBe('hello');
    });

    it('should cap at 200 entries', () => {
      for (let i = 0; i < 210; i++) {
        store.getState().addScriptLog({ entityId: 'e1', level: 'info', message: `log-${i}`, timestamp: i });
      }

      expect(store.getState().scriptLogs).toHaveLength(200);
      // First 10 should be trimmed
      expect(store.getState().scriptLogs[0].message).toBe('log-10');
    });

    it('should clear all logs', () => {
      store.getState().addScriptLog({ entityId: 'e1', level: 'info', message: 'x', timestamp: 1 });
      store.getState().clearScriptLogs();
      expect(store.getState().scriptLogs).toEqual([]);
    });
  });

  describe('setInputBinding / removeInputBinding', () => {
    it('should add a new binding', () => {
      store.getState().setInputBinding({ actionName: 'jump', actionType: 'digital', sources: ['Space'] });
      expect(store.getState().inputBindings).toHaveLength(1);
      expect(store.getState().inputBindings[0].actionName).toBe('jump');
    });

    it('should update existing binding by actionName', () => {
      store.getState().setInputBinding({ actionName: 'jump', actionType: 'digital', sources: ['Space'] });
      store.getState().setInputBinding({ actionName: 'jump', actionType: 'digital', sources: ['W'] });

      expect(store.getState().inputBindings).toHaveLength(1);
      expect(store.getState().inputBindings[0].sources).toEqual(['W']);
    });

    it('should dispatch set_input_binding', () => {
      const binding = { actionName: 'fire', actionType: 'digital' as const, sources: ['Mouse0'] };
      store.getState().setInputBinding(binding);
      expect(mockDispatch).toHaveBeenCalledWith('set_input_binding', binding);
    });

    it('should remove binding by actionName', () => {
      store.getState().setInputBinding({ actionName: 'jump', actionType: 'digital', sources: ['Space'] });
      store.getState().setInputBinding({ actionName: 'fire', actionType: 'digital', sources: ['Mouse0'] });
      store.getState().removeInputBinding('jump');

      expect(store.getState().inputBindings).toHaveLength(1);
      expect(store.getState().inputBindings[0].actionName).toBe('fire');
    });

    it('should dispatch remove_input_binding', () => {
      store.getState().removeInputBinding('jump');
      expect(mockDispatch).toHaveBeenCalledWith('remove_input_binding', { actionName: 'jump' });
    });
  });

  describe('setInputPreset / setInputBindings', () => {
    it('should set input preset', () => {
      store.getState().setInputPreset('fps');
      expect(store.getState().inputPreset).toBe('fps');
    });

    it('should dispatch set_input_preset', () => {
      store.getState().setInputPreset('platformer');
      expect(mockDispatch).toHaveBeenCalledWith('set_input_preset', { preset: 'platformer' });
    });

    it('should set bindings and preset together', () => {
      const bindings = [{ actionName: 'jump', actionType: 'digital' as const, sources: ['Space'] }];
      store.getState().setInputBindings(bindings, 'topdown');

      expect(store.getState().inputBindings).toEqual(bindings);
      expect(store.getState().inputPreset).toBe('topdown');
    });
  });
});
