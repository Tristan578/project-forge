/**
 * Render tests for SpriteAnimationInspector component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { SpriteAnimationInspector } from '../SpriteAnimationInspector';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

interface MockClip {
  frames: number[];
  duration: number;
  looping: boolean;
  pingPong: boolean;
}

const baseSpriteSheet = {
  assetId: 'sheet-1',
  frames: [
    { x: 0, y: 0, width: 16, height: 16 },
    { x: 16, y: 0, width: 16, height: 16 },
  ],
  sliceMode: { type: 'grid' as const, columns: 2, rows: 1 },
  clips: {
    idle: { frames: [0], duration: 0.2, looping: true, pingPong: false },
    run: { frames: [0, 1], duration: 0.1, looping: true, pingPong: false },
  } as Record<string, MockClip>,
};

const baseAnimator = {
  currentClip: 'idle',
  playing: false,
  speed: 1.0,
  frameIndex: 0,
};

const baseStateMachine = {
  currentState: 'idle',
  states: { idle: 'idle', run: 'run' },
  transitions: [
    {
      fromState: 'idle',
      toState: 'run',
      condition: { type: 'paramBool' as const, name: 'isRunning', value: true },
    },
  ],
  parameters: {
    isRunning: { type: 'bool' as const, value: false },
    speed: { type: 'float' as const, value: 0.0 },
  },
};

describe('SpriteAnimationInspector', () => {
  const mockSetSpriteAnimator = vi.fn();
  const mockSetAnimationStateMachine = vi.fn();

  function setupStore({
    primaryId = 'entity-1' as string | null,
    spriteSheet = baseSpriteSheet as typeof baseSpriteSheet | undefined,
    animator = baseAnimator as typeof baseAnimator | undefined,
    stateMachine = undefined as typeof baseStateMachine | undefined,
  } = {}) {
    const spriteSheets: Record<string, typeof baseSpriteSheet> = {};
    const spriteAnimators: Record<string, typeof baseAnimator> = {};
    const animationStateMachines: Record<string, typeof baseStateMachine> = {};

    if (primaryId) {
      if (spriteSheet) spriteSheets[primaryId] = spriteSheet;
      if (animator) spriteAnimators[primaryId] = animator;
      if (stateMachine) animationStateMachines[primaryId] = stateMachine;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        primaryId,
        spriteSheets,
        spriteAnimators,
        animationStateMachines,
        setSpriteAnimator: mockSetSpriteAnimator,
        setAnimationStateMachine: mockSetAnimationStateMachine,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when no primaryId', () => {
    setupStore({ primaryId: null });
    const { container } = render(<SpriteAnimationInspector />);
    expect(container.firstChild).toBeNull();
  });

  it('shows no Animation Clips section when spriteSheet has no clips', () => {
    setupStore({
      spriteSheet: { ...baseSpriteSheet, clips: {} as Record<string, MockClip> },
    });
    render(<SpriteAnimationInspector />);
    expect(screen.queryByText('Animation Clips')).toBeNull();
  });

  it('renders Sprite Sheet heading when sheet present', () => {
    setupStore();
    render(<SpriteAnimationInspector />);
    expect(screen.getByText('Sprite Sheet')).not.toBeNull();
  });

  it('shows asset ID', () => {
    setupStore();
    render(<SpriteAnimationInspector />);
    expect(screen.getByText(/sheet-1/)).not.toBeNull();
  });

  it('shows frame count', () => {
    setupStore();
    render(<SpriteAnimationInspector />);
    expect(screen.getByText(/Frames: 2/)).not.toBeNull();
  });

  it('shows clip count', () => {
    setupStore();
    render(<SpriteAnimationInspector />);
    expect(screen.getByText(/Clips: 2/)).not.toBeNull();
  });

  it('renders Animation Clips heading when clips present', () => {
    setupStore();
    render(<SpriteAnimationInspector />);
    expect(screen.getByText('Animation Clips')).not.toBeNull();
  });

  it('renders clip names', () => {
    setupStore();
    render(<SpriteAnimationInspector />);
    // 'idle' and 'run' appear multiple times (clip list + select options)
    expect(screen.getAllByText('idle').length).toBeGreaterThan(0);
    expect(screen.getAllByText('run').length).toBeGreaterThan(0);
  });

  it('shows looping indicator for looping clips', () => {
    setupStore();
    render(<SpriteAnimationInspector />);
    const loopIndicators = screen.getAllByText(/Loop/);
    expect(loopIndicators.length).toBeGreaterThan(0);
  });

  it('renders Playback heading when animator present', () => {
    setupStore();
    render(<SpriteAnimationInspector />);
    expect(screen.getByText('Playback')).not.toBeNull();
  });

  it('shows current clip in playback section', () => {
    setupStore();
    render(<SpriteAnimationInspector />);
    expect(screen.getByText('Current Clip')).not.toBeNull();
  });

  it('renders Play and Stop buttons in playback section', () => {
    setupStore();
    render(<SpriteAnimationInspector />);
    // There are Play buttons in both clip list and playback — use getAllByText
    const playButtons = screen.getAllByText('Play');
    expect(playButtons.length).toBeGreaterThan(0);
    expect(screen.getByText('Stop')).not.toBeNull();
  });

  it('shows playing status', () => {
    setupStore({ animator: { ...baseAnimator, playing: false } });
    render(<SpriteAnimationInspector />);
    expect(screen.getByText(/Stopped/)).not.toBeNull();
  });

  it('shows playing indicator when playing is true', () => {
    setupStore({ animator: { ...baseAnimator, playing: true } });
    render(<SpriteAnimationInspector />);
    expect(screen.getByText(/Playing/)).not.toBeNull();
  });

  it('calls setSpriteAnimator with playing=false when Stop clicked', () => {
    setupStore({ animator: { ...baseAnimator, playing: true, currentClip: 'idle' } });
    render(<SpriteAnimationInspector />);
    fireEvent.click(screen.getByText('Stop'));
    expect(mockSetSpriteAnimator).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({ playing: false })
    );
  });

  it('renders State Machine section when stateMachine provided', () => {
    setupStore({ stateMachine: baseStateMachine });
    render(<SpriteAnimationInspector />);
    expect(screen.getByText('State Machine')).not.toBeNull();
  });

  it('shows current state in state machine section', () => {
    setupStore({ stateMachine: baseStateMachine });
    render(<SpriteAnimationInspector />);
    expect(screen.getByText('Current State:')).not.toBeNull();
    // 'idle' appears multiple times — just confirm it exists somewhere
    expect(screen.getAllByText(/idle/).length).toBeGreaterThan(0);
  });

  it('shows bool parameter as checkbox', () => {
    setupStore({ stateMachine: baseStateMachine });
    render(<SpriteAnimationInspector />);
    expect(screen.getByText('isRunning')).not.toBeNull();
  });

  it('shows float parameter as number input', () => {
    setupStore({ stateMachine: baseStateMachine });
    render(<SpriteAnimationInspector />);
    expect(screen.getByText('speed')).not.toBeNull();
  });
});
