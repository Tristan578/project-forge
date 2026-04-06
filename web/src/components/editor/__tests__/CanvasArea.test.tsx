/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@/test/utils/componentTestUtils';
import { CanvasArea } from '../CanvasArea';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/chatStore', () => ({
  useChatStore: vi.fn((selector: (s: unknown) => unknown) => selector({
    rightPanelTab: 'chat',
  })),
}));

vi.mock('@/hooks/useViewport', () => ({
  useViewport: vi.fn(() => ({
    dimensions: { width: 1280, height: 720, dpr: 1, breakpoint: 'laptop' },
    isReady: false,
    error: null,
    sendCommand: vi.fn(),
  })),
}));

vi.mock('@/hooks/useEngineEvents', () => ({
  useEngineEvents: vi.fn(),
}));

vi.mock('@/hooks/usePointerLock', () => ({
  usePointerLock: vi.fn(),
}));

const mockHandleCommand = vi.fn();
vi.mock('@/hooks/useEngine', () => ({
  getWasmModule: vi.fn(() => ({ handle_command: mockHandleCommand })),
}));

vi.mock('../InitOverlay', () => ({
  InitOverlay: () => null,
}));

vi.mock('../ViewPresetButtons', () => ({
  ViewPresetButtons: () => null,
}));

vi.mock('../ui-builder/UICanvasOverlay', () => ({
  UICanvasOverlay: () => null,
}));

vi.mock('../ui-builder/UIRuntimeRenderer', () => ({
  UIRuntimeRenderer: () => null,
}));

import { useEditorStore } from '@/stores/editorStore';

function mockEditorStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    hudElements: [],
    engineMode: 'edit',
    selectedIds: new Set(['entity-1']),
    primaryId: 'entity-1',
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
  // Mock getState for imperative access (used in Delete/Duplicate handlers)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (useEditorStore as any).getState = () => state;
}

describe('CanvasArea', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders a canvas element', () => {
    mockEditorStore();
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
    expect(canvas?.id).toBe('game-canvas');
  });

  it('does not show dimension indicator when not ready', () => {
    mockEditorStore();
    const { container } = render(<CanvasArea />);
    // isReady is false, so no dimension indicator
    expect(container.textContent).not.toContain('1280');
  });

  // -- ARIA attributes (#8252) --

  it('canvas has tabIndex=-1 when not ready', () => {
    mockEditorStore();
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas');
    expect(canvas?.tabIndex).toBe(-1);
  });

  it('canvas has role="application"', () => {
    mockEditorStore();
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas');
    expect(canvas?.getAttribute('role')).toBe('application');
  });

  it('canvas has descriptive aria-label', () => {
    mockEditorStore();
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas');
    expect(canvas?.getAttribute('aria-label')).toContain('3D viewport');
  });

  // -- Keyboard shortcuts (#8253) --

  it('W key dispatches set_gizmo_mode translate', () => {
    mockEditorStore();
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.keyDown(canvas, { key: 'w' });
    expect(mockHandleCommand).toHaveBeenCalledWith('set_gizmo_mode', { mode: 'translate' });
  });

  it('E key dispatches set_gizmo_mode rotate', () => {
    mockEditorStore();
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.keyDown(canvas, { key: 'e' });
    expect(mockHandleCommand).toHaveBeenCalledWith('set_gizmo_mode', { mode: 'rotate' });
  });

  it('R key dispatches set_gizmo_mode scale', () => {
    mockEditorStore();
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.keyDown(canvas, { key: 'r' });
    expect(mockHandleCommand).toHaveBeenCalledWith('set_gizmo_mode', { mode: 'scale' });
  });

  it('Delete key dispatches delete_entities', () => {
    mockEditorStore();
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.keyDown(canvas, { key: 'Delete' });
    expect(mockHandleCommand).toHaveBeenCalledWith('delete_entities', { entityIds: ['entity-1'] });
  });

  it('Ctrl+D dispatches duplicate_entity with primaryId', () => {
    mockEditorStore();
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.keyDown(canvas, { key: 'd', ctrlKey: true });
    expect(mockHandleCommand).toHaveBeenCalledWith('duplicate_entity', { entityId: 'entity-1' });
  });

  it('Ctrl+D does nothing when no primaryId', () => {
    mockEditorStore({ primaryId: null });
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.keyDown(canvas, { key: 'd', ctrlKey: true });
    expect(mockHandleCommand).not.toHaveBeenCalledWith('duplicate_entity', expect.anything());
  });

  it('Ctrl+Z dispatches undo', () => {
    mockEditorStore();
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(mockHandleCommand).toHaveBeenCalledWith('undo', {});
  });

  it('Ctrl+Shift+Z dispatches redo', () => {
    mockEditorStore();
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(mockHandleCommand).toHaveBeenCalledWith('redo', {});
  });

  it('F key dispatches focus_camera with primaryId', () => {
    mockEditorStore();
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.keyDown(canvas, { key: 'f' });
    expect(mockHandleCommand).toHaveBeenCalledWith('focus_camera', { entityId: 'entity-1' });
  });

  it('F key does nothing when no primaryId', () => {
    mockEditorStore({ primaryId: null });
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.keyDown(canvas, { key: 'f' });
    expect(mockHandleCommand).not.toHaveBeenCalledWith('focus_camera', expect.anything());
  });

  it('Escape dispatches clear_selection in edit mode', () => {
    mockEditorStore();
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(mockHandleCommand).toHaveBeenCalledWith('clear_selection', {});
  });

  it('Escape in play mode dispatches stop', () => {
    mockEditorStore({ engineMode: 'play' });
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(mockHandleCommand).toHaveBeenCalledWith('stop', {});
  });

  it('keyboard shortcuts are no-op in play mode (except Escape)', () => {
    mockEditorStore({ engineMode: 'play' });
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.keyDown(canvas, { key: 'w' });
    fireEvent.keyDown(canvas, { key: 'Delete' });
    // Only Escape should work in play mode
    expect(mockHandleCommand).not.toHaveBeenCalledWith('set_gizmo_mode', expect.anything());
    expect(mockHandleCommand).not.toHaveBeenCalledWith('delete_entities', expect.anything());
  });

  // Regression: Sentry bug — paused mode must also block edit shortcuts
  it('keyboard shortcuts are no-op in paused mode (except Escape)', () => {
    mockEditorStore({ engineMode: 'paused' });
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.keyDown(canvas, { key: 'w' });
    fireEvent.keyDown(canvas, { key: 'Delete' });
    fireEvent.keyDown(canvas, { key: 'f' });
    expect(mockHandleCommand).not.toHaveBeenCalledWith('set_gizmo_mode', expect.anything());
    expect(mockHandleCommand).not.toHaveBeenCalledWith('delete_entities', expect.anything());
    expect(mockHandleCommand).not.toHaveBeenCalledWith('focus_camera', expect.anything());
  });

  it('Escape in paused mode dispatches stop', () => {
    mockEditorStore({ engineMode: 'paused' });
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(mockHandleCommand).toHaveBeenCalledWith('stop', {});
  });
});
