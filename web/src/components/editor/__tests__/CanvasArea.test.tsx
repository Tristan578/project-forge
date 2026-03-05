import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { CanvasArea } from '../CanvasArea';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
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

vi.mock('@/hooks/useEngine', () => ({
  getWasmModule: vi.fn(() => null),
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
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('CanvasArea', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders a canvas element', () => {
    mockEditorStore();
    const { container } = render(<CanvasArea />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeDefined();
    expect(canvas?.id).toBe('game-canvas');
  });

  it('does not show dimension indicator when not ready', () => {
    mockEditorStore();
    const { container } = render(<CanvasArea />);
    // isReady is false, so no dimension indicator
    expect(container.textContent).not.toContain('1280');
  });
});
