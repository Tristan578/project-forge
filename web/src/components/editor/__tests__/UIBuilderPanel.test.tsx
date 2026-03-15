/**
 * Tests for UIBuilderPanel — empty state, active screen content,
 * keyboard shortcuts for undo/redo, and child sub-components rendering.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { UIBuilderPanel } from '../UIBuilderPanel';
import { useUIBuilderStore } from '@/stores/uiBuilderStore';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/uiBuilderStore', () => ({
  useUIBuilderStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

// Stub all sub-components so they do not pull in deep dependencies
vi.mock('../ui-builder/ScreenList', () => ({
  ScreenList: () => <div data-testid="screen-list">ScreenList</div>,
}));

vi.mock('../ui-builder/WidgetPalette', () => ({
  WidgetPalette: () => <div data-testid="widget-palette">WidgetPalette</div>,
}));

vi.mock('../ui-builder/WidgetTree', () => ({
  WidgetTree: () => <div data-testid="widget-tree">WidgetTree</div>,
}));

vi.mock('../ui-builder/WidgetPropertyPanel', () => ({
  WidgetPropertyPanel: () => <div data-testid="widget-property-panel">WidgetPropertyPanel</div>,
}));

vi.mock('../ui-builder/WidgetStyleEditor', () => ({
  WidgetStyleEditor: () => <div data-testid="widget-style-editor">WidgetStyleEditor</div>,
}));

vi.mock('../ui-builder/ScreenSettingsPanel', () => ({
  ScreenSettingsPanel: () => <div data-testid="screen-settings-panel">ScreenSettingsPanel</div>,
}));

const mockUiUndo = vi.fn();
const mockUiRedo = vi.fn();

function setupStores(overrides: {
  activeScreenId?: string | null;
  selectedWidgetId?: string | null;
  engineMode?: string;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useUIBuilderStore).mockImplementation((selector: any) =>
    selector({
      activeScreenId: overrides.activeScreenId ?? null,
      selectedWidgetId: overrides.selectedWidgetId ?? null,
      uiUndo: mockUiUndo,
      uiRedo: mockUiRedo,
    })
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) =>
    selector({
      engineMode: overrides.engineMode ?? 'edit',
    })
  );
}

describe('UIBuilderPanel', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  // ── Empty state (no active screen) ────────────────────────────────────

  it('shows empty-state message when no screen is active', () => {
    setupStores({ activeScreenId: null });
    render(<UIBuilderPanel />);
    expect(screen.getByText(/select or create a screen/i)).toBeDefined();
  });

  it('renders ScreenList in the header even with no active screen', () => {
    setupStores({ activeScreenId: null });
    render(<UIBuilderPanel />);
    expect(screen.getByTestId('screen-list')).toBeDefined();
  });

  // ── Active screen (no selected widget) ────────────────────────────────

  it('renders WidgetPalette when a screen is active', () => {
    setupStores({ activeScreenId: 'screen-1' });
    render(<UIBuilderPanel />);
    expect(screen.getByTestId('widget-palette')).toBeDefined();
  });

  it('renders WidgetTree when a screen is active', () => {
    setupStores({ activeScreenId: 'screen-1' });
    render(<UIBuilderPanel />);
    expect(screen.getByTestId('widget-tree')).toBeDefined();
  });

  it('renders ScreenSettingsPanel when screen is active but no widget is selected', () => {
    setupStores({ activeScreenId: 'screen-1', selectedWidgetId: null });
    render(<UIBuilderPanel />);
    expect(screen.getByTestId('screen-settings-panel')).toBeDefined();
  });

  it('does not render WidgetPropertyPanel when no widget is selected', () => {
    setupStores({ activeScreenId: 'screen-1', selectedWidgetId: null });
    render(<UIBuilderPanel />);
    expect(screen.queryByTestId('widget-property-panel')).toBeNull();
  });

  // ── Active screen + selected widget ───────────────────────────────────

  it('renders WidgetPropertyPanel when a widget is selected', () => {
    setupStores({ activeScreenId: 'screen-1', selectedWidgetId: 'widget-42' });
    render(<UIBuilderPanel />);
    expect(screen.getByTestId('widget-property-panel')).toBeDefined();
  });

  it('renders WidgetStyleEditor when a widget is selected', () => {
    setupStores({ activeScreenId: 'screen-1', selectedWidgetId: 'widget-42' });
    render(<UIBuilderPanel />);
    expect(screen.getByTestId('widget-style-editor')).toBeDefined();
  });

  it('does not render ScreenSettingsPanel when a widget is selected', () => {
    setupStores({ activeScreenId: 'screen-1', selectedWidgetId: 'widget-42' });
    render(<UIBuilderPanel />);
    expect(screen.queryByTestId('screen-settings-panel')).toBeNull();
  });

  // ── UI Settings button ────────────────────────────────────────────────

  it('renders the UI Settings button', () => {
    setupStores();
    render(<UIBuilderPanel />);
    expect(screen.getByTitle('UI Settings')).toBeDefined();
  });

  // ── Keyboard shortcuts ─────────────────────────────────────────────────

  it('calls uiUndo on Ctrl+Z when screen is active and widget is selected', () => {
    setupStores({
      activeScreenId: 'screen-1',
      selectedWidgetId: 'widget-1',
      engineMode: 'edit',
    });
    render(<UIBuilderPanel />);
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(mockUiUndo).toHaveBeenCalled();
  });

  it('calls uiRedo on Ctrl+Y when screen is active and widget is selected', () => {
    setupStores({
      activeScreenId: 'screen-1',
      selectedWidgetId: 'widget-1',
      engineMode: 'edit',
    });
    render(<UIBuilderPanel />);
    fireEvent.keyDown(document, { key: 'y', ctrlKey: true });
    expect(mockUiRedo).toHaveBeenCalled();
  });

  it('does NOT call uiUndo when no widget is selected', () => {
    setupStores({ activeScreenId: 'screen-1', selectedWidgetId: null, engineMode: 'edit' });
    render(<UIBuilderPanel />);
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(mockUiUndo).not.toHaveBeenCalled();
  });

  it('does NOT call uiUndo when engine is in play mode', () => {
    setupStores({
      activeScreenId: 'screen-1',
      selectedWidgetId: 'widget-1',
      engineMode: 'play',
    });
    render(<UIBuilderPanel />);
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(mockUiUndo).not.toHaveBeenCalled();
  });

  it('does NOT call uiUndo when no active screen', () => {
    setupStores({ activeScreenId: null, selectedWidgetId: null, engineMode: 'edit' });
    render(<UIBuilderPanel />);
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(mockUiUndo).not.toHaveBeenCalled();
  });
});
