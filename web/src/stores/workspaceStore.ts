import { create } from 'zustand';
import type { DockviewApi, SerializedDockview } from 'dockview-react';
import { LAYOUT_PRESETS, type LayoutPresetId } from '@/lib/workspace/presets';
import { PANEL_DEFINITIONS } from '@/lib/workspace/panelRegistry';

const LAYOUT_STORAGE_KEY = 'forge-workspace-layout';
const CUSTOM_PRESETS_KEY = 'forge-workspace-custom-presets';
const MAX_CUSTOM_PRESETS = 5;

export interface CustomPreset {
  name: string;
  layout: SerializedDockview;
}

interface WorkspaceState {
  /** The dockview API instance, set once on mount */
  api: DockviewApi | null;
  /** Currently active preset (null if user has customized) */
  activePreset: LayoutPresetId | null;
  /** Whether the chat overlay is visible */
  chatOverlayOpen: boolean;
  /** User-saved custom presets */
  customPresets: CustomPreset[];
  /** Current docs navigation path */
  docsPath: string | null;

  // Actions
  setApi: (api: DockviewApi) => void;
  applyPreset: (presetId: LayoutPresetId) => void;
  saveLayout: () => void;
  loadSavedLayout: () => boolean;
  saveCustomPreset: (name: string) => void;
  deleteCustomPreset: (index: number) => void;
  loadCustomPreset: (index: number) => void;
  toggleChatOverlay: () => void;
  setChatOverlayOpen: (open: boolean) => void;
  openScriptEditor: (entityId: string, entityName: string) => void;
  /** Open a panel by ID (or activate if already open) */
  openPanel: (panelId: string) => void;
  /** Check which panels are currently open */
  getOpenPanelIds: () => string[];
  /** Open docs panel and navigate to a specific path */
  navigateDocs: (path: string) => void;
}

function loadCustomPresets(): CustomPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (raw) return JSON.parse(raw) as CustomPreset[];
  } catch { /* ignore */ }
  return [];
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  api: null,
  activePreset: 'default',
  chatOverlayOpen: false,
  customPresets: typeof localStorage !== 'undefined' ? loadCustomPresets() : [],
  docsPath: null,

  setApi: (api) => set({ api }),

  applyPreset: (presetId) => {
    const { api } = get();
    if (!api) return;
    const preset = LAYOUT_PRESETS[presetId];
    if (!preset) return;

    api.clear();
    preset.apply(api);
    set({ activePreset: presetId });

    // Save to localStorage
    try {
      const serialized = api.toJSON();
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(serialized));
    } catch { /* ignore */ }
  },

  saveLayout: () => {
    const { api } = get();
    if (!api) return;
    try {
      const serialized = api.toJSON();
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(serialized));
    } catch { /* ignore */ }
    // Layout was modified by user drag, clear active preset indicator
    set({ activePreset: null });
  },

  loadSavedLayout: () => {
    const { api } = get();
    if (!api) return false;
    try {
      const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw) as SerializedDockview;
      api.fromJSON(data);
      return true;
    } catch {
      return false;
    }
  },

  saveCustomPreset: (name) => {
    const { api, customPresets } = get();
    if (!api) return;
    try {
      const layout = api.toJSON();
      const updated = [...customPresets, { name, layout }].slice(-MAX_CUSTOM_PRESETS);
      set({ customPresets: updated });
      localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated));
    } catch { /* ignore */ }
  },

  deleteCustomPreset: (index) => {
    const { customPresets } = get();
    const updated = customPresets.filter((_, i) => i !== index);
    set({ customPresets: updated });
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated));
  },

  loadCustomPreset: (index) => {
    const { api, customPresets } = get();
    if (!api || !customPresets[index]) return;
    try {
      api.fromJSON(customPresets[index].layout);
      set({ activePreset: null });
    } catch { /* ignore */ }
  },

  toggleChatOverlay: () => set((s) => ({ chatOverlayOpen: !s.chatOverlayOpen })),
  setChatOverlayOpen: (open) => set({ chatOverlayOpen: open }),

  openPanel: (panelId) => {
    const { api } = get();
    if (!api) return;

    // If panel already exists, activate it
    const existing = api.getPanel(panelId);
    if (existing) {
      existing.api.setActive();
      return;
    }

    // Add the panel — find its definition
    const def = PANEL_DEFINITIONS[panelId];
    if (!def) return;

    // Try to place intelligently based on panel type
    const viewport = api.getPanel('scene-viewport');
    const inspector = api.getPanel('inspector');
    const assets = api.getPanel('asset-browser');

    // Right-side panels go with inspector
    if (['scene-settings', 'ui-builder'].includes(panelId) && inspector) {
      api.addPanel({
        id: panelId,
        component: def.component,
        title: def.title,
        position: { direction: 'within', referencePanel: inspector },
      });
    }
    // Bottom panels go with assets
    else if (['audio-mixer'].includes(panelId) && assets) {
      api.addPanel({
        id: panelId,
        component: def.component,
        title: def.title,
        position: { direction: 'within', referencePanel: assets },
      });
    }
    // Left panels
    else if (['scene-hierarchy', 'script-explorer'].includes(panelId)) {
      const hierarchy = api.getPanel('scene-hierarchy');
      const target = hierarchy ?? viewport;
      if (hierarchy) {
        api.addPanel({
          id: panelId,
          component: def.component,
          title: def.title,
          position: { direction: 'within', referencePanel: hierarchy },
        });
      } else if (target) {
        api.addPanel({
          id: panelId,
          component: def.component,
          title: def.title,
          position: { direction: 'left', referencePanel: target },
          initialWidth: 220,
        });
      }
    }
    // Center panels
    else if (viewport) {
      api.addPanel({
        id: panelId,
        component: def.component,
        title: def.title,
        position: { direction: 'within', referencePanel: viewport },
      });
    }
    // Fallback
    else {
      api.addPanel({
        id: panelId,
        component: def.component,
        title: def.title,
      });
    }
  },

  getOpenPanelIds: () => {
    const { api } = get();
    if (!api) return [];
    return api.panels.map((p) => p.id);
  },

  navigateDocs: (path) => {
    set({ docsPath: path });
    get().openPanel('docs');
  },

  openScriptEditor: (_entityId, entityName) => {
    const { api } = get();
    if (!api) return;

    // Check if script-editor panel already exists
    const existing = api.getPanel('script-editor');
    if (existing) {
      // Update title and re-add to same group to activate it
      existing.api.setTitle(`Script: ${entityName}`);
      // Move within the same group to activate the tab
      existing.api.moveTo({ group: existing.api.group, position: 'center' });
      return;
    }

    // Create script-editor in the center group (as tab next to viewport)
    const viewport = api.getPanel('scene-viewport');
    if (viewport) {
      api.addPanel({
        id: 'script-editor',
        component: 'script-editor',
        title: `Script: ${entityName}`,
        position: { direction: 'within', referencePanel: viewport },
      });
    } else {
      // Fallback: add to center
      api.addPanel({
        id: 'script-editor',
        component: 'script-editor',
        title: `Script: ${entityName}`,
      });
    }
  },
}));
