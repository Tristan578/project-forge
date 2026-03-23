/**
 * Complexity slice — manages the progressive complexity level for the editor UI.
 *
 * Three levels control which panels and inspector sections are visible:
 *   beginner     – essential controls only (~30% of UI)
 *   intermediate – adds physics, audio, scripting, animation, export (~70% of UI)
 *   expert       – full feature set: particles, shaders, CSG, procedural, perf (100%)
 *
 * The preference is persisted in localStorage under the key 'forge-complexity-level'.
 * Critical features (save, undo, play, AI chat, hierarchy) are ALWAYS visible regardless of level.
 */

export type ComplexityLevel = 'beginner' | 'intermediate' | 'expert';

export interface ComplexityFeatureSet {
  /** Inspector sections that are visible at this level */
  inspectorSections: string[];
  /** Sidebar tools that are visible at this level */
  sidebarTools: string[];
  /** Right-panel tabs that are visible at this level */
  rightPanelTabs: string[];
  /** Workspace panels that are openable at this level */
  workspacePanels: string[];
}

/** Features visible at each complexity level (cumulative — each level includes all previous). */
export const COMPLEXITY_FEATURES: Record<ComplexityLevel, ComplexityFeatureSet> = {
  beginner: {
    inspectorSections: [
      'transform',
      'material',
      'light',
      'sprite',
      'sprite-animation',
      'camera-2d',
    ],
    sidebarTools: ['add-entity', 'select', 'translate', 'rotate', 'scale', 'grid'],
    rightPanelTabs: ['inspector', 'chat'],
    workspacePanels: ['scene-hierarchy'],
  },
  intermediate: {
    inspectorSections: [
      'transform',
      'material',
      'light',
      'sprite',
      'sprite-animation',
      'camera-2d',
      'tilemap',
      'physics',
      'joints',
      'audio',
      'animation',
      'animation-clips',
      'game-components',
      'game-camera',
      'input-bindings',
      'reverb-zone',
      'adaptive-music',
      'skeleton-2d',
      'lod',
    ],
    sidebarTools: [
      'add-entity',
      'select',
      'translate',
      'rotate',
      'scale',
      'grid',
      'coordinate-mode',
      'audio-mixer',
    ],
    rightPanelTabs: ['inspector', 'chat', 'script', 'ui'],
    workspacePanels: ['scene-hierarchy', 'asset-panel', 'script-editor'],
  },
  expert: {
    inspectorSections: [
      'transform',
      'material',
      'light',
      'sprite',
      'sprite-animation',
      'camera-2d',
      'tilemap',
      'physics',
      'joints',
      'audio',
      'animation',
      'animation-clips',
      'game-components',
      'game-camera',
      'input-bindings',
      'reverb-zone',
      'adaptive-music',
      'skeleton-2d',
      'lod',
      'particles',
      'terrain',
      'edit-mode',
    ],
    sidebarTools: [
      'add-entity',
      'select',
      'translate',
      'rotate',
      'scale',
      'grid',
      'coordinate-mode',
      'audio-mixer',
      'csg-union',
      'csg-subtract',
      'csg-intersect',
      'combine-meshes',
    ],
    rightPanelTabs: ['inspector', 'chat', 'script', 'ui'],
    workspacePanels: [
      'scene-hierarchy',
      'asset-panel',
      'script-editor',
      'shader-editor',
    ],
  },
};

/** Human-readable label for each level. */
export const COMPLEXITY_LABELS: Record<ComplexityLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  expert: 'Expert',
};

/** Short description shown in the toggle UI. */
export const COMPLEXITY_DESCRIPTIONS: Record<ComplexityLevel, string> = {
  beginner: 'Essential tools — transform, materials, play, and AI chat',
  intermediate: 'Adds physics, audio, scripting, animation, and export',
  expert: 'Full feature set — particles, shaders, CSG, procedural, and performance tools',
};

const STORAGE_KEY = 'forge-complexity-level';
const VALID_LEVELS: ComplexityLevel[] = ['beginner', 'intermediate', 'expert'];

function isValidLevel(value: unknown): value is ComplexityLevel {
  return VALID_LEVELS.includes(value as ComplexityLevel);
}

function loadStoredLevel(): ComplexityLevel {
  if (typeof localStorage === 'undefined') return 'beginner';
  const stored = localStorage.getItem(STORAGE_KEY);
  return isValidLevel(stored) ? stored : 'beginner';
}

function persistLevel(level: ComplexityLevel): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, level);
  }
}

// ---------------------------------------------------------------------------
// Standalone Zustand store (NOT part of editorStore — this is a global UI pref)
// ---------------------------------------------------------------------------

import { create } from 'zustand';

export interface ComplexityState {
  level: ComplexityLevel;
  features: ComplexityFeatureSet;

  setLevel: (level: ComplexityLevel) => void;
  isInspectorSectionVisible: (sectionId: string) => boolean;
  isSidebarToolVisible: (toolId: string) => boolean;
  isRightPanelTabVisible: (tabId: string) => boolean;
  isWorkspacePanelVisible: (panelId: string) => boolean;
}

export const useComplexityStore = create<ComplexityState>()((set, get) => {
  const initialLevel = loadStoredLevel();

  return {
    level: initialLevel,
    features: COMPLEXITY_FEATURES[initialLevel],

    setLevel: (level) => {
      persistLevel(level);
      set({ level, features: COMPLEXITY_FEATURES[level] });
    },

    isInspectorSectionVisible: (sectionId) => {
      return get().features.inspectorSections.includes(sectionId);
    },

    isSidebarToolVisible: (toolId) => {
      return get().features.sidebarTools.includes(toolId);
    },

    isRightPanelTabVisible: (tabId) => {
      return get().features.rightPanelTabs.includes(tabId);
    },

    isWorkspacePanelVisible: (panelId) => {
      return get().features.workspacePanels.includes(panelId);
    },
  };
});
