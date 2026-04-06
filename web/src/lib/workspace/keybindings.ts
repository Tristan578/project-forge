/**
 * Keyboard shortcut customization system.
 *
 * Stores user-customized keybindings in localStorage,
 * falling back to defaults when no override exists.
 */

const STORAGE_KEY = 'forge-keybindings';

export interface KeyBinding {
  /** Unique action identifier */
  action: string;
  /** Human-readable label */
  label: string;
  /** Category for grouping in UI */
  category: string;
  /** Default key combo (e.g. "Ctrl+Z", "W", "Delete") */
  defaultKey: string;
  /** User-customized key combo (null = use default) */
  customKey: string | null;
  /** Where this binding is active ("canvas" = 3D viewport, "global" = everywhere) */
  context?: 'canvas' | 'global';
}

/** All available shortcut actions with their defaults. */
export const DEFAULT_BINDINGS: KeyBinding[] = [
  // Selection
  { action: 'select-all', label: 'Select all', category: 'Selection', defaultKey: 'Ctrl+A', customKey: null, context: 'global' },
  { action: 'deselect', label: 'Deselect all', category: 'Selection', defaultKey: 'Escape', customKey: null, context: 'canvas' },

  // Transform
  { action: 'translate', label: 'Translate mode', category: 'Transform', defaultKey: 'W', customKey: null, context: 'canvas' },
  { action: 'rotate', label: 'Rotate mode', category: 'Transform', defaultKey: 'E', customKey: null, context: 'canvas' },
  { action: 'scale', label: 'Scale mode', category: 'Transform', defaultKey: 'R', customKey: null, context: 'canvas' },

  // History
  { action: 'undo', label: 'Undo', category: 'History', defaultKey: 'Ctrl+Z', customKey: null, context: 'canvas' },
  { action: 'redo', label: 'Redo', category: 'History', defaultKey: 'Ctrl+Shift+Z', customKey: null, context: 'canvas' },

  // Scene
  { action: 'save', label: 'Save scene', category: 'Scene', defaultKey: 'Ctrl+S', customKey: null, context: 'global' },
  { action: 'duplicate', label: 'Duplicate selected', category: 'Scene', defaultKey: 'Ctrl+D', customKey: null, context: 'canvas' },
  { action: 'delete', label: 'Delete selected', category: 'Scene', defaultKey: 'Delete', customKey: null, context: 'canvas' },
  { action: 'focus', label: 'Focus on selected', category: 'Scene', defaultKey: 'F', customKey: null, context: 'canvas' },

  // View
  { action: 'view-top', label: 'Top view', category: 'View', defaultKey: '1', customKey: null },
  { action: 'view-front', label: 'Front view', category: 'View', defaultKey: '2', customKey: null },
  { action: 'view-right', label: 'Right view', category: 'View', defaultKey: '3', customKey: null },
  { action: 'view-perspective', label: 'Perspective view', category: 'View', defaultKey: '4', customKey: null },
  { action: 'toggle-grid', label: 'Toggle grid', category: 'View', defaultKey: 'G', customKey: null },

  // Panels
  { action: 'toggle-chat', label: 'Toggle AI chat', category: 'Panels', defaultKey: 'Ctrl+K', customKey: null },
  { action: 'open-docs', label: 'Open docs', category: 'Panels', defaultKey: 'F1', customKey: null },
  { action: 'show-shortcuts', label: 'Show shortcuts', category: 'Panels', defaultKey: '?', customKey: null },
  { action: 'toggle-taskboard', label: 'Toggle taskboard', category: 'Panels', defaultKey: 'Alt+T', customKey: null },
];

/** Get the effective key for a binding (custom or default). */
export function getEffectiveKey(binding: KeyBinding): string {
  return binding.customKey ?? binding.defaultKey;
}

/** Load saved customizations from localStorage. */
export function loadCustomBindings(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Save a custom binding for an action. */
export function saveCustomBinding(action: string, key: string): void {
  try {
    const customs = loadCustomBindings();
    customs[action] = key;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customs));
  } catch {
    // ignore
  }
}

/** Remove a custom binding (reset to default). */
export function resetBinding(action: string): void {
  try {
    const customs = loadCustomBindings();
    delete customs[action];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customs));
  } catch {
    // ignore
  }
}

/** Reset all bindings to defaults. */
export function resetAllBindings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Get all bindings with any saved customizations merged in. */
export function getMergedBindings(): KeyBinding[] {
  const customs = loadCustomBindings();
  return DEFAULT_BINDINGS.map((b) => ({
    ...b,
    customKey: customs[b.action] ?? null,
  }));
}

/**
 * Convert a KeyboardEvent into a human-readable key combo string.
 * e.g. "Ctrl+Shift+Z", "W", "F1", "Delete"
 */
export function eventToKeyCombo(e: KeyboardEvent): string | null {
  const key = e.key;

  // Ignore bare modifier keys
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');

  // Normalize key names
  let normalized = key;
  if (key === ' ') normalized = 'Space';
  else if (key === 'Backspace') normalized = 'Delete'; // Mac "delete" key sends Backspace
  else if (key === 'Escape') normalized = 'Escape';
  else if (key.length === 1) normalized = key.toUpperCase();
  // F-keys and special keys keep their name

  parts.push(normalized);
  return parts.join('+');
}

/** Get a map of key combo → action for canvas-context bindings. */
export function getCanvasKeyMap(): Map<string, string> {
  const bindings = getMergedBindings();
  const map = new Map<string, string>();
  for (const b of bindings) {
    if (b.context === 'canvas') {
      map.set(getEffectiveKey(b), b.action);
    }
  }
  return map;
}

/** Group bindings by category. */
export function groupByCategory(bindings: KeyBinding[]): Record<string, KeyBinding[]> {
  const groups: Record<string, KeyBinding[]> = {};
  for (const b of bindings) {
    if (!groups[b.category]) groups[b.category] = [];
    groups[b.category].push(b);
  }
  return groups;
}
