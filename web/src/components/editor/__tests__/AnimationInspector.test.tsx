import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { AnimationInspector } from '../AnimationInspector';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
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
    expect(screen.getByText('Animation')).not.toBeNull();
    expect(screen.getByText('Playing')).not.toBeNull();
    expect(screen.getByText('Speed')).not.toBeNull();
    expect(screen.getByText('Loop')).not.toBeNull();
    // Blend weights section for multiple clips
    expect(screen.getByText('Blend Weights')).not.toBeNull();
  });
});
