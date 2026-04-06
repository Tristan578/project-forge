import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  DEFAULT_BINDINGS,
  getEffectiveKey,
  loadCustomBindings,
  saveCustomBinding,
  resetBinding,
  resetAllBindings,
  getMergedBindings,
  getCanvasKeyMap,
  eventToKeyCombo,
  groupByCategory,
  type KeyBinding,
} from '../keybindings';

describe('DEFAULT_BINDINGS', () => {
  it('should have unique action IDs', () => {
    const actions = DEFAULT_BINDINGS.map(b => b.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('should have all required fields', () => {
    for (const binding of DEFAULT_BINDINGS) {
      expect(binding.action).not.toBe('');
      expect(binding.label).not.toBe('');
      expect(binding.category).not.toBe('');
      expect(binding.defaultKey).not.toBe('');
      expect(binding.customKey).toBeNull();
    }
  });

  it('should include common shortcuts', () => {
    const actions = DEFAULT_BINDINGS.map(b => b.action);
    expect(actions).toContain('undo');
    expect(actions).toContain('redo');
    expect(actions).toContain('save');
    expect(actions).toContain('delete');
  });
});

describe('getEffectiveKey', () => {
  it('should return default key when no custom key', () => {
    const binding: KeyBinding = {
      action: 'test', label: 'Test', category: 'Test',
      defaultKey: 'Ctrl+Z', customKey: null,
    };
    expect(getEffectiveKey(binding)).toBe('Ctrl+Z');
  });

  it('should return custom key when set', () => {
    const binding: KeyBinding = {
      action: 'test', label: 'Test', category: 'Test',
      defaultKey: 'Ctrl+Z', customKey: 'Ctrl+Y',
    };
    expect(getEffectiveKey(binding)).toBe('Ctrl+Y');
  });
});

describe('eventToKeyCombo', () => {
  function makeEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return {
      key: 'a',
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      ...overrides,
    } as KeyboardEvent;
  }

  it('should return null for bare modifier keys', () => {
    expect(eventToKeyCombo(makeEvent({ key: 'Control' }))).toBeNull();
    expect(eventToKeyCombo(makeEvent({ key: 'Shift' }))).toBeNull();
    expect(eventToKeyCombo(makeEvent({ key: 'Alt' }))).toBeNull();
    expect(eventToKeyCombo(makeEvent({ key: 'Meta' }))).toBeNull();
  });

  it('should uppercase single character keys', () => {
    expect(eventToKeyCombo(makeEvent({ key: 'a' }))).toBe('A');
    expect(eventToKeyCombo(makeEvent({ key: 'z' }))).toBe('Z');
  });

  it('should include Ctrl prefix', () => {
    expect(eventToKeyCombo(makeEvent({ key: 'z', ctrlKey: true }))).toBe('Ctrl+Z');
  });

  it('should include Shift prefix', () => {
    expect(eventToKeyCombo(makeEvent({ key: 'z', shiftKey: true }))).toBe('Shift+Z');
  });

  it('should combine modifiers', () => {
    expect(eventToKeyCombo(makeEvent({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+Z');
  });

  it('should handle space key', () => {
    expect(eventToKeyCombo(makeEvent({ key: ' ' }))).toBe('Space');
  });

  it('should handle F-keys', () => {
    expect(eventToKeyCombo(makeEvent({ key: 'F1' }))).toBe('F1');
    expect(eventToKeyCombo(makeEvent({ key: 'F12' }))).toBe('F12');
  });

  it('should handle special keys', () => {
    expect(eventToKeyCombo(makeEvent({ key: 'Delete' }))).toBe('Delete');
    expect(eventToKeyCombo(makeEvent({ key: 'Escape' }))).toBe('Escape');
  });

  it('should normalize Backspace to Delete (Mac laptop keyboard)', () => {
    expect(eventToKeyCombo(makeEvent({ key: 'Backspace' }))).toBe('Delete');
    expect(eventToKeyCombo(makeEvent({ key: 'Backspace', ctrlKey: true }))).toBe('Ctrl+Delete');
  });

  it('should treat Meta as Ctrl', () => {
    expect(eventToKeyCombo(makeEvent({ key: 's', metaKey: true }))).toBe('Ctrl+S');
  });
});

describe('groupByCategory', () => {
  it('should group bindings by category', () => {
    const groups = groupByCategory(DEFAULT_BINDINGS);
    expect(groups['Selection']).toBeDefined();
    expect(groups['Transform']).toBeDefined();
    expect(groups['History']).toBeDefined();
    expect(groups['Scene']).toBeDefined();
  });

  it('should include all bindings', () => {
    const groups = groupByCategory(DEFAULT_BINDINGS);
    const total = Object.values(groups).reduce((sum, arr) => sum + arr.length, 0);
    expect(total).toBe(DEFAULT_BINDINGS.length);
  });

  it('should handle empty array', () => {
    const groups = groupByCategory([]);
    expect(Object.keys(groups)).toHaveLength(0);
  });
});

describe('localStorage functions', () => {
  let mockStore: Record<string, string>;

  beforeEach(() => {
    mockStore = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStore[key] ?? null,
      setItem: (key: string, val: string) => { mockStore[key] = val; },
      removeItem: (key: string) => { delete mockStore[key]; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loadCustomBindings should return empty when nothing stored', () => {
    expect(loadCustomBindings()).toEqual({});
  });

  it('saveCustomBinding should persist a binding', () => {
    saveCustomBinding('undo', 'Ctrl+Y');
    const customs = loadCustomBindings();
    expect(customs['undo']).toBe('Ctrl+Y');
  });

  it('resetBinding should remove a custom binding', () => {
    saveCustomBinding('undo', 'Ctrl+Y');
    resetBinding('undo');
    expect(loadCustomBindings()['undo']).toBeUndefined();
  });

  it('resetAllBindings should clear all custom bindings', () => {
    saveCustomBinding('undo', 'Ctrl+Y');
    saveCustomBinding('redo', 'Ctrl+Shift+Y');
    resetAllBindings();
    expect(loadCustomBindings()).toEqual({});
  });

  it('getMergedBindings should merge customs into defaults', () => {
    saveCustomBinding('undo', 'Ctrl+Y');
    const merged = getMergedBindings();
    const undo = merged.find(b => b.action === 'undo');
    expect(undo!.customKey).toBe('Ctrl+Y');
    expect(undo!.defaultKey).toBe('Ctrl+Z');
  });

  it('getMergedBindings should keep null for unmodified bindings', () => {
    const merged = getMergedBindings();
    const redo = merged.find(b => b.action === 'redo');
    expect(redo!.customKey).toBeNull();
  });
});

describe('context field', () => {
  it('canvas bindings include gizmo modes, delete, undo/redo, focus, deselect', () => {
    const canvasActions = DEFAULT_BINDINGS.filter(b => b.context === 'canvas').map(b => b.action);
    expect(canvasActions).toContain('translate');
    expect(canvasActions).toContain('rotate');
    expect(canvasActions).toContain('scale');
    expect(canvasActions).toContain('delete');
    expect(canvasActions).toContain('undo');
    expect(canvasActions).toContain('redo');
    expect(canvasActions).toContain('focus');
    expect(canvasActions).toContain('deselect');
    expect(canvasActions).toContain('duplicate');
  });

  it('global bindings include save and select-all', () => {
    const globalActions = DEFAULT_BINDINGS.filter(b => b.context === 'global').map(b => b.action);
    expect(globalActions).toContain('save');
    expect(globalActions).toContain('select-all');
  });
});

describe('getCanvasKeyMap', () => {
  it('maps default keys to canvas actions', () => {
    const map = getCanvasKeyMap();
    expect(map.get('W')).toBe('translate');
    expect(map.get('E')).toBe('rotate');
    expect(map.get('R')).toBe('scale');
    expect(map.get('Delete')).toBe('delete');
    expect(map.get('Ctrl+Z')).toBe('undo');
    expect(map.get('Ctrl+Shift+Z')).toBe('redo');
    expect(map.get('F')).toBe('focus');
    expect(map.get('Escape')).toBe('deselect');
    expect(map.get('Ctrl+D')).toBe('duplicate');
  });

  it('does not include global-context bindings', () => {
    const map = getCanvasKeyMap();
    expect(map.has('Ctrl+S')).toBe(false); // save is global
    expect(map.has('Ctrl+A')).toBe(false); // select-all is global
  });
});
