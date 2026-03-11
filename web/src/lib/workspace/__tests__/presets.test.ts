/**
 * Tests for workspace layout presets.
 *
 * Covers: preset structure, apply() function calls, panel IDs/positions,
 * PANEL_DEFINITIONS integration via panelOpts, all three presets.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dockview-react (not available in test env)
// ---------------------------------------------------------------------------

vi.mock('dockview-react', () => ({
  // Only types are needed — no runtime code
}));

// ---------------------------------------------------------------------------
// Mock panelRegistry
// ---------------------------------------------------------------------------

vi.mock('@/lib/workspace/panelRegistry', () => ({
  PANEL_DEFINITIONS: {
    'scene-viewport': { id: 'scene-viewport', component: 'scene-viewport', minWidth: 400, minHeight: 300, renderer: 'always' },
    'scene-hierarchy': { id: 'scene-hierarchy', component: 'scene-hierarchy', minWidth: 180 },
    'inspector': { id: 'inspector', component: 'inspector', minWidth: 240 },
    'scene-settings': { id: 'scene-settings', component: 'scene-settings' },
    'ui-builder': { id: 'ui-builder', component: 'ui-builder' },
    'asset-browser': { id: 'asset-browser', component: 'asset-browser' },
    'audio-mixer': { id: 'audio-mixer', component: 'audio-mixer' },
    'script-editor': { id: 'script-editor', component: 'script-editor', minWidth: 300, renderer: 'always' },
    'script-explorer': { id: 'script-explorer', component: 'script-explorer' },
  },
}));

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

import { LAYOUT_PRESETS } from '@/lib/workspace/presets';
import type { LayoutPresetId } from '@/lib/workspace/presets';

// ---------------------------------------------------------------------------
// Mock DockviewApi factory
// ---------------------------------------------------------------------------

function makeMockApi() {
  const panels: Record<string, unknown> = {};
  const panelCalls: Array<{ id: string; args: Record<string, unknown> }> = [];

  const mockApi = {
    addPanel: vi.fn((opts: Record<string, unknown>) => {
      const panelId = opts.id as string;
      const mockPanel = {
        api: {
          setActive: vi.fn(),
        },
        id: panelId,
      };
      panels[panelId] = mockPanel;
      panelCalls.push({ id: panelId, args: opts });
      return mockPanel;
    }),
    _panels: panels,
    _panelCalls: panelCalls,
  };

  return mockApi;
}

type MockApi = ReturnType<typeof makeMockApi>;

// ---------------------------------------------------------------------------
// LAYOUT_PRESETS structure
// ---------------------------------------------------------------------------

describe('LAYOUT_PRESETS structure', () => {
  it('exports all three presets', () => {
    expect(LAYOUT_PRESETS.default).toBeDefined();
    expect(LAYOUT_PRESETS.scripting).toBeDefined();
    expect(LAYOUT_PRESETS.presentation).toBeDefined();
  });

  it('each preset has id, name, description, and apply function', () => {
    const ids: LayoutPresetId[] = ['default', 'scripting', 'presentation'];
    for (const id of ids) {
      const preset = LAYOUT_PRESETS[id];
      expect(preset.id).toBe(id);
      expect(typeof preset.name).toBe('string');
      expect(preset.name.length).toBeGreaterThan(0);
      expect(typeof preset.description).toBe('string');
      expect(preset.description.length).toBeGreaterThan(0);
      expect(typeof preset.apply).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// Default preset
// ---------------------------------------------------------------------------

describe('LAYOUT_PRESETS.default', () => {
  let api: MockApi;

  beforeEach(() => {
    api = makeMockApi();
    LAYOUT_PRESETS.default.apply(api as never);
  });

  it('adds scene-viewport as first panel', () => {
    const calls = api._panelCalls;
    expect(calls[0].id).toBe('scene-viewport');
    expect(calls[0].args.component).toBe('scene-viewport');
  });

  it('adds scene-hierarchy panel', () => {
    const ids = api._panelCalls.map((c) => c.id);
    expect(ids).toContain('scene-hierarchy');
  });

  it('adds inspector panel', () => {
    const ids = api._panelCalls.map((c) => c.id);
    expect(ids).toContain('inspector');
  });

  it('adds scene-settings panel as inactive', () => {
    const call = api._panelCalls.find((c) => c.id === 'scene-settings');
    expect(call).toBeDefined();
    expect(call?.args.inactive).toBe(true);
  });

  it('adds ui-builder panel as inactive', () => {
    const call = api._panelCalls.find((c) => c.id === 'ui-builder');
    expect(call).toBeDefined();
    expect(call?.args.inactive).toBe(true);
  });

  it('adds asset-browser panel', () => {
    const ids = api._panelCalls.map((c) => c.id);
    expect(ids).toContain('asset-browser');
  });

  it('adds audio-mixer panel as inactive', () => {
    const call = api._panelCalls.find((c) => c.id === 'audio-mixer');
    expect(call).toBeDefined();
    expect(call?.args.inactive).toBe(true);
  });

  it('calls setActive on the viewport panel', () => {
    const viewportPanel = api._panels['scene-viewport'] as { api: { setActive: ReturnType<typeof vi.fn> } };
    expect(viewportPanel.api.setActive).toHaveBeenCalled();
  });

  it('positions scene-hierarchy to the left of viewport', () => {
    const call = api._panelCalls.find((c) => c.id === 'scene-hierarchy');
    const pos = call?.args.position as { direction: string } | undefined;
    expect(pos?.direction).toBe('left');
  });

  it('positions inspector to the right of viewport', () => {
    const call = api._panelCalls.find((c) => c.id === 'inspector');
    const pos = call?.args.position as { direction: string } | undefined;
    expect(pos?.direction).toBe('right');
  });

  it('positions asset-browser below viewport', () => {
    const call = api._panelCalls.find((c) => c.id === 'asset-browser');
    const pos = call?.args.position as { direction: string } | undefined;
    expect(pos?.direction).toBe('down');
  });

  it('includes initialWidth for scene-hierarchy', () => {
    const call = api._panelCalls.find((c) => c.id === 'scene-hierarchy');
    expect(call?.args.initialWidth).toBeDefined();
    expect(typeof call?.args.initialWidth).toBe('number');
  });

  it('includes initialWidth for inspector', () => {
    const call = api._panelCalls.find((c) => c.id === 'inspector');
    expect(call?.args.initialWidth).toBeDefined();
  });

  it('applies minimumWidth from PANEL_DEFINITIONS for viewport', () => {
    const call = api._panelCalls.find((c) => c.id === 'scene-viewport');
    expect(call?.args.minimumWidth).toBe(400);
    expect(call?.args.minimumHeight).toBe(300);
  });

  it('applies renderer from PANEL_DEFINITIONS for viewport', () => {
    const call = api._panelCalls.find((c) => c.id === 'scene-viewport');
    expect(call?.args.renderer).toBe('always');
  });
});

// ---------------------------------------------------------------------------
// Scripting preset
// ---------------------------------------------------------------------------

describe('LAYOUT_PRESETS.scripting', () => {
  let api: MockApi;

  beforeEach(() => {
    api = makeMockApi();
    LAYOUT_PRESETS.scripting.apply(api as never);
  });

  it('adds script-editor as first panel', () => {
    expect(api._panelCalls[0].id).toBe('script-editor');
  });

  it('adds scene-viewport as inactive tab behind script-editor', () => {
    const call = api._panelCalls.find((c) => c.id === 'scene-viewport');
    expect(call).toBeDefined();
    expect(call?.args.inactive).toBe(true);
  });

  it('adds script-explorer panel', () => {
    const ids = api._panelCalls.map((c) => c.id);
    expect(ids).toContain('script-explorer');
  });

  it('adds scene-hierarchy as inactive behind script-explorer', () => {
    const call = api._panelCalls.find((c) => c.id === 'scene-hierarchy');
    expect(call).toBeDefined();
    expect(call?.args.inactive).toBe(true);
  });

  it('adds inspector panel', () => {
    const ids = api._panelCalls.map((c) => c.id);
    expect(ids).toContain('inspector');
  });

  it('adds asset-browser panel', () => {
    const ids = api._panelCalls.map((c) => c.id);
    expect(ids).toContain('asset-browser');
  });

  it('calls setActive on the script-editor panel', () => {
    const editorPanel = api._panels['script-editor'] as { api: { setActive: ReturnType<typeof vi.fn> } };
    expect(editorPanel.api.setActive).toHaveBeenCalled();
  });

  it('positions script-explorer to the left of editor', () => {
    const call = api._panelCalls.find((c) => c.id === 'script-explorer');
    const pos = call?.args.position as { direction: string } | undefined;
    expect(pos?.direction).toBe('left');
  });

  it('positions inspector to the right of editor', () => {
    const call = api._panelCalls.find((c) => c.id === 'inspector');
    const pos = call?.args.position as { direction: string } | undefined;
    expect(pos?.direction).toBe('right');
  });
});

// ---------------------------------------------------------------------------
// Presentation preset
// ---------------------------------------------------------------------------

describe('LAYOUT_PRESETS.presentation', () => {
  let api: MockApi;

  beforeEach(() => {
    api = makeMockApi();
    LAYOUT_PRESETS.presentation.apply(api as never);
  });

  it('adds scene-viewport as first panel', () => {
    expect(api._panelCalls[0].id).toBe('scene-viewport');
  });

  it('adds inspector panel', () => {
    const ids = api._panelCalls.map((c) => c.id);
    expect(ids).toContain('inspector');
  });

  it('adds asset-browser panel', () => {
    const ids = api._panelCalls.map((c) => c.id);
    expect(ids).toContain('asset-browser');
  });

  it('does NOT add audio-mixer or scene-hierarchy (minimal UI)', () => {
    const ids = api._panelCalls.map((c) => c.id);
    expect(ids).not.toContain('audio-mixer');
    expect(ids).not.toContain('scene-hierarchy');
  });

  it('calls setActive on the viewport panel', () => {
    const viewportPanel = api._panels['scene-viewport'] as { api: { setActive: ReturnType<typeof vi.fn> } };
    expect(viewportPanel.api.setActive).toHaveBeenCalled();
  });

  it('asset-browser has smaller initialHeight than default', () => {
    const presCall = api._panelCalls.find((c) => c.id === 'asset-browser');
    expect(presCall?.args.initialHeight).toBeDefined();
    expect(presCall?.args.initialHeight as number).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------------------
// panelOpts integration
// ---------------------------------------------------------------------------

describe('panelOpts integration', () => {
  it('applies PANEL_DEFINITIONS options for known panels', () => {
    // Apply any preset with the mock — known panels should receive options
    // from PANEL_DEFINITIONS via panelOpts (e.g. minWidth/minHeight).
    // Here we confirm that scene-viewport gets its configured minWidth.
    const api = makeMockApi();
    LAYOUT_PRESETS.default.apply(api as never);
    const viewportCall = api._panelCalls.find((c) => c.id === 'scene-viewport');
    // PANEL_DEFINITIONS['scene-viewport'] has minWidth: 400
    expect(viewportCall?.args.minimumWidth).toBe(400);
  });

  it('panel without minWidth/minHeight gets undefined opts', () => {
    const api = makeMockApi();
    LAYOUT_PRESETS.default.apply(api as never);
    const audioCall = api._panelCalls.find((c) => c.id === 'audio-mixer');
    // audio-mixer has no minWidth in mock PANEL_DEFINITIONS
    expect(audioCall?.args.minimumWidth).toBeUndefined();
    expect(audioCall?.args.minimumHeight).toBeUndefined();
  });
});
