import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { AnimationInspector } from '../AnimationInspector';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('lucide-react', () => {
  const stub = () => null;
  return new Proxy({ __esModule: true }, {
    get: (target, name) => (name in target ? (target as Record<string, unknown>)[name] : stub),
  });
});

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

import { useEditorStore } from '@/stores/editorStore';

function mockEditorStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    primaryId: 'ent-1',
    primaryAnimation: null,
    playAnimation: vi.fn(),
    pauseAnimation: vi.fn(),
    resumeAnimation: vi.fn(),
    stopAnimation: vi.fn(),
    seekAnimation: vi.fn(),
    setAnimationSpeed: vi.fn(),
    setAnimationLoop: vi.fn(),
    setAnimationBlendWeight: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('AnimationInspector', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('returns null when no animation data exists', () => {
    mockEditorStore();
    const { container } = render(<AnimationInspector />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when animation has no available clips', () => {
    mockEditorStore({
      primaryAnimation: {
        availableClips: [],
        activeClipName: null,
        isPlaying: false,
        isPaused: false,
        isFinished: false,
        elapsedSecs: 0,
        speed: 1.0,
        isLooping: false,
      },
    });
    const { container } = render(<AnimationInspector />);
    expect(container.innerHTML).toBe('');
  });

  it('renders animation controls when clips are available', () => {
    mockEditorStore({
      primaryAnimation: {
        availableClips: [
          { name: 'Walk', durationSecs: 1.5 },
          { name: 'Run', durationSecs: 0.8 },
        ],
        activeClipName: 'Walk',
        isPlaying: true,
        isPaused: false,
        isFinished: false,
        elapsedSecs: 0.5,
        speed: 1.0,
        isLooping: true,
      },
    });
    render(<AnimationInspector />);
    expect(screen.getByText('Animation')).toBeDefined();
    expect(screen.getByText('Playing')).toBeDefined();
    expect(screen.getByText('Speed')).toBeDefined();
    expect(screen.getByText('Loop')).toBeDefined();
    // Blend weights section for multiple clips
    expect(screen.getByText('Blend Weights')).toBeDefined();
  });
});
