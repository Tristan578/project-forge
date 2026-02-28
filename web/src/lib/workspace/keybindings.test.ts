import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getMergedBindings,
  getEffectiveKey,
  saveCustomBinding,
  resetBinding,
  resetAllBindings,
  eventToKeyCombo,
  groupByCategory,
  DEFAULT_BINDINGS,
} from './keybindings';

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { for (const key in store) delete store[key]; }),
  length: 0,
  key: vi.fn(() => null),
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('keybindings', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('returns default bindings when no customizations', () => {
    const bindings = getMergedBindings();
    expect(bindings.length).toBe(DEFAULT_BINDINGS.length);
    expect(bindings.every((b) => b.customKey === null)).toBe(true);
  });

  it('getEffectiveKey returns default when no custom', () => {
    const binding = DEFAULT_BINDINGS[0];
    expect(getEffectiveKey(binding)).toBe(binding.defaultKey);
  });

  it('getEffectiveKey returns custom when set', () => {
    const binding = { ...DEFAULT_BINDINGS[0], customKey: 'Ctrl+X' };
    expect(getEffectiveKey(binding)).toBe('Ctrl+X');
  });

  it('saves and loads custom bindings', () => {
    saveCustomBinding('undo', 'Ctrl+Y');
    const bindings = getMergedBindings();
    const undo = bindings.find((b) => b.action === 'undo');
    expect(undo?.customKey).toBe('Ctrl+Y');
  });

  it('resets a single binding', () => {
    saveCustomBinding('undo', 'Ctrl+Y');
    resetBinding('undo');
    const bindings = getMergedBindings();
    const undo = bindings.find((b) => b.action === 'undo');
    expect(undo?.customKey).toBeNull();
  });

  it('resets all bindings', () => {
    saveCustomBinding('undo', 'Ctrl+Y');
    saveCustomBinding('redo', 'Ctrl+Shift+Y');
    resetAllBindings();
    const bindings = getMergedBindings();
    expect(bindings.every((b) => b.customKey === null)).toBe(true);
  });

  it('groups bindings by category', () => {
    const grouped = groupByCategory(DEFAULT_BINDINGS);
    expect(Object.keys(grouped)).toContain('Selection');
    expect(Object.keys(grouped)).toContain('Transform');
    expect(Object.keys(grouped)).toContain('History');
    expect(grouped['Transform'].length).toBe(3);
  });

  describe('eventToKeyCombo', () => {
    function makeEvent(key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): KeyboardEvent {
      return {
        key,
        ctrlKey: mods.ctrl ?? false,
        shiftKey: mods.shift ?? false,
        altKey: mods.alt ?? false,
        metaKey: false,
      } as unknown as KeyboardEvent;
    }

    it('converts simple key', () => {
      expect(eventToKeyCombo(makeEvent('w'))).toBe('W');
    });

    it('converts Ctrl+key', () => {
      expect(eventToKeyCombo(makeEvent('z', { ctrl: true }))).toBe('Ctrl+Z');
    });

    it('converts Ctrl+Shift+key', () => {
      expect(eventToKeyCombo(makeEvent('z', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+Z');
    });

    it('converts F-keys', () => {
      expect(eventToKeyCombo(makeEvent('F1'))).toBe('F1');
    });

    it('converts Delete', () => {
      expect(eventToKeyCombo(makeEvent('Delete'))).toBe('Delete');
    });

    it('converts Space', () => {
      expect(eventToKeyCombo(makeEvent(' '))).toBe('Space');
    });

    it('returns null for bare modifier keys', () => {
      expect(eventToKeyCombo(makeEvent('Control'))).toBeNull();
      expect(eventToKeyCombo(makeEvent('Shift'))).toBeNull();
    });
  });
});
