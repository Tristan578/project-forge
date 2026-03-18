/**
 * Keyboard shortcut registry for the cheat sheet overlay.
 *
 * This is the canonical list of all keyboard shortcuts available in the editor,
 * organized by category. It is used by the ShortcutCheatSheet component.
 */

export interface ShortcutEntry {
  /** Human-readable key combo (e.g. "Ctrl+Z", "W", "Delete") */
  key: string;
  /** Optional modifier keys shown separately (for display purposes) */
  modifiers?: string[];
  /** Human-readable action description */
  action: string;
  /** Category for grouping */
  category: string;
}

export const SHORTCUT_CATEGORIES = [
  'General',
  'Navigation',
  'Selection',
  'Transform',
  'Tools',
  'View',
  'Play Mode',
] as const;

export type ShortcutCategory = (typeof SHORTCUT_CATEGORIES)[number];

export const KEYBOARD_SHORTCUTS: ShortcutEntry[] = [
  // General
  { key: 'S', modifiers: ['Ctrl'], action: 'Save scene', category: 'General' },
  { key: 'N', modifiers: ['Ctrl', 'Shift'], action: 'New scene', category: 'General' },
  { key: 'Z', modifiers: ['Ctrl'], action: 'Undo', category: 'General' },
  { key: 'Z', modifiers: ['Ctrl', 'Shift'], action: 'Redo', category: 'General' },
  { key: 'Y', modifiers: ['Ctrl'], action: 'Redo (alternate)', category: 'General' },
  { key: '?', action: 'Toggle shortcut cheat sheet', category: 'General' },
  { key: 'F1', action: 'Open documentation', category: 'General' },

  // Navigation
  { key: 'K', modifiers: ['Ctrl'], action: 'Toggle AI chat overlay', category: 'Navigation' },
  { key: 'I', modifiers: ['Ctrl', 'Shift'], action: 'Toggle Inspector / Chat panel', category: 'Navigation' },
  { key: 'T', modifiers: ['Alt'], action: 'Toggle taskboard panel', category: 'Navigation' },

  // Selection
  { key: 'Click', action: 'Select entity', category: 'Selection' },
  { key: 'Click', modifiers: ['Ctrl'], action: 'Multi-select', category: 'Selection' },
  { key: 'A', modifiers: ['Ctrl'], action: 'Select all', category: 'Selection' },
  { key: 'Escape', action: 'Deselect all', category: 'Selection' },

  // Transform
  { key: 'W', action: 'Translate mode', category: 'Transform' },
  { key: 'E', action: 'Rotate mode', category: 'Transform' },
  { key: 'R', action: 'Scale mode', category: 'Transform' },
  { key: 'D', modifiers: ['Ctrl'], action: 'Duplicate selected', category: 'Transform' },
  { key: 'Delete', action: 'Delete selected', category: 'Transform' },
  { key: 'Backspace', action: 'Delete selected (alternate)', category: 'Transform' },
  { key: 'F', action: 'Focus on selected entity', category: 'Transform' },

  // Tools
  { key: 'G', action: 'Toggle grid', category: 'Tools' },
  { key: 'X', action: 'Toggle coordinate mode (local/world)', category: 'Tools' },

  // View
  { key: '1', action: 'Top view', category: 'View' },
  { key: '2', action: 'Front view', category: 'View' },
  { key: '3', action: 'Right view', category: 'View' },
  { key: '4', action: 'Perspective view', category: 'View' },
  { key: '7', modifiers: ['Alt'], action: 'Top view (alternate)', category: 'View' },
  { key: '1', modifiers: ['Alt'], action: 'Front view (alternate)', category: 'View' },
  { key: '3', modifiers: ['Alt'], action: 'Right view (alternate)', category: 'View' },
  { key: '5', modifiers: ['Alt'], action: 'Perspective view (alternate)', category: 'View' },

  // Play Mode
  { key: 'P', modifiers: ['Ctrl'], action: 'Play / Stop game', category: 'Play Mode' },
];
