/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { SmartCameraPanel } from '../SmartCameraPanel';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => {
  const mockEditorState = {
    primaryId: null,
    sceneGraph: { nodes: {}, rootIds: [] },
    allGameCameras: {},
  };
  const mockUseEditorStore = Object.assign(vi.fn(() => ({})), {
    getState: vi.fn(() => mockEditorState),
  });
  return {
    useEditorStore: mockUseEditorStore,
    getCommandDispatcher: vi.fn(() => vi.fn()),
  };
});

vi.mock('@/lib/ai/smartCamera', () => {
  const preset = {
    mode: 'follow',
    fov: 70,
    followDistance: 5,
    followHeight: 2,
    followSmoothing: 0.1,
    lookAhead: 0.5,
    deadZone: { x: 0.1, y: 0.1 },
    shake: { enabled: false, trauma: 0, decay: 0.8 },
    genre: 'action',
  };
  return {
    CAMERA_PRESETS: { action: preset },
    PRESET_KEYS: ['action'],
    detectOptimalCamera: vi.fn(() => preset),
    smartModeToEngine: vi.fn(() => ({})),
    interpolatePresets: vi.fn(() => preset),
  };
});

describe('SmartCameraPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) =>
      selector({ primaryId: null, sceneGraph: { nodes: {}, rootIds: [] }, allGameCameras: {} })
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    const { container } = render(<SmartCameraPanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
