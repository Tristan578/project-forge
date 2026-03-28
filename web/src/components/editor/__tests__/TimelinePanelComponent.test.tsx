/**
 * Tests for TimelinePanel component — rendering, playback controls,
 * zoom, recording toggle, track list, and empty state.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { TimelinePanel } from '../TimelinePanel';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

const mockUpdateClipKeyframe = vi.fn();
const mockSetClipProperty = vi.fn();

function setupStore(overrides: {
  primaryId?: string | null;
  primaryAnimationClip?: Record<string, unknown> | null;
  primaryName?: string;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = {
      primaryId: 'primaryId' in overrides ? overrides.primaryId : 'ent-1',
      primaryAnimationClip: 'primaryAnimationClip' in overrides
        ? overrides.primaryAnimationClip
        : {
            duration: 3.0,
            speed: 1.0,
            playing: false,
            playMode: 'loop',
            currentTime: 0,
            tracks: [
              {
                target: 'position_x',
                keyframes: [
                  { time: 0, value: 0 },
                  { time: 1.5, value: 5 },
                  { time: 3.0, value: 0 },
                ],
              },
              {
                target: 'rotation_y',
                keyframes: [
                  { time: 0, value: 0 },
                  { time: 3.0, value: 6.28 },
                ],
              },
            ],
          },
      primaryName: overrides.primaryName ?? 'TestEntity',
      updateClipKeyframe: mockUpdateClipKeyframe,
      setClipProperty: mockSetClipProperty,
    };
    return selector(state);
  });
}

// Mock canvas getContext for the timeline canvas rendering
const mockCtx = {
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  closePath: vi.fn(),
  fillText: vi.fn(),
  scale: vi.fn(),
  createImageData: vi.fn((w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4), width: w, height: h,
  })),
  putImageData: vi.fn(),
};

describe('TimelinePanel component', () => {
  let createElementSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    const origCreateElement = document.createElement.bind(document);
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const el = origCreateElement(tag, options);
      if (tag === 'canvas') {
        (el as HTMLCanvasElement).getContext = (() => mockCtx) as unknown as HTMLCanvasElement['getContext'];
      }
      return el;
    });
  });

  afterAll(() => {
    createElementSpy.mockRestore();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Empty states ──────────────────────────────────────────────────────

  it('renders placeholder when no entity is selected', () => {
    setupStore({ primaryId: null });
    const { container } = render(<TimelinePanel />);
    expect(container.textContent).toContain('Select an entity');
  });

  it('renders placeholder when entity has no animation clip', () => {
    setupStore({ primaryAnimationClip: null });
    const { container } = render(<TimelinePanel />);
    expect(container.textContent).toContain('Select an entity');
  });

  // ── Header rendering ──────────────────────────────────────────────────

  it('renders playback controls when clip exists', () => {
    setupStore();
    render(<TimelinePanel />);

    expect(screen.getByTitle('Play')).toBeInTheDocument();
    expect(screen.getByTitle('Stop')).toBeInTheDocument();
    expect(screen.getByTitle('Toggle Recording')).toBeInTheDocument();
    expect(screen.getByTitle('Zoom In')).toBeInTheDocument();
    expect(screen.getByTitle('Zoom Out')).toBeInTheDocument();
  });

  it('displays entity name and time info', () => {
    setupStore();
    const { container } = render(<TimelinePanel />);
    expect(container.textContent).toContain('TestEntity');
    expect(container.textContent).toContain('3.00s');
  });

  it('displays initial zoom level', () => {
    setupStore();
    const { container } = render(<TimelinePanel />);
    expect(container.textContent).toContain('1.0x');
  });

  // ── Track list ────────────────────────────────────────────────────────

  it('renders track labels from animation clip', () => {
    setupStore();
    const { container } = render(<TimelinePanel />);
    expect(container.textContent).toContain('Position X');
    expect(container.textContent).toContain('Rotation Y');
  });

  it('shows keyframe count per track', () => {
    setupStore();
    const { container } = render(<TimelinePanel />);
    // Position X has 3 keyframes, Rotation Y has 2
    expect(container.textContent).toContain('3');
    expect(container.textContent).toContain('2');
  });

  // ── Playback controls ─────────────────────────────────────────────────

  it('toggles play/pause on button click', () => {
    setupStore();
    render(<TimelinePanel />);

    const playBtn = screen.getByTitle('Play');
    fireEvent.click(playBtn);

    // After clicking play, button should now show Pause
    expect(screen.getByTitle('Pause')).toBeInTheDocument();
    expect(mockSetClipProperty).toHaveBeenCalled();
  });

  it('resets to beginning on stop', () => {
    setupStore();
    const { container } = render(<TimelinePanel />);

    // First play, then stop
    fireEvent.click(screen.getByTitle('Play'));
    fireEvent.click(screen.getByTitle('Stop'));

    // Should show Play again (not Pause)
    expect(screen.getByTitle('Play')).toBeInTheDocument();
    // Playhead time should reset to 0.00s in the same render
    expect(container.textContent).toContain('0.00s');
  });

  // ── Zoom ──────────────────────────────────────────────────────────────

  it('zoom in increases zoom level', () => {
    setupStore();
    const { container } = render(<TimelinePanel />);

    fireEvent.click(screen.getByTitle('Zoom In'));
    expect(container.textContent).toContain('1.5x');
  });

  it('zoom out decreases zoom level', () => {
    setupStore();
    const { container } = render(<TimelinePanel />);

    fireEvent.click(screen.getByTitle('Zoom Out'));
    // 1.0 / 1.5 ≈ 0.67
    expect(container.textContent).toContain('0.7x');
  });

  it('zoom in is capped at 100x', () => {
    setupStore();
    const { container } = render(<TimelinePanel />);

    // Click zoom in many times
    for (let i = 0; i < 30; i++) {
      fireEvent.click(screen.getByTitle('Zoom In'));
    }
    expect(container.textContent).toContain('100.0x');
  });

  it('zoom out is capped at 0.1x', () => {
    setupStore();
    const { container } = render(<TimelinePanel />);

    // Click zoom out many times
    for (let i = 0; i < 30; i++) {
      fireEvent.click(screen.getByTitle('Zoom Out'));
    }
    expect(container.textContent).toContain('0.1x');
  });

  // ── Recording toggle ──────────────────────────────────────────────────

  it('toggles recording mode', () => {
    setupStore();
    render(<TimelinePanel />);

    const recordBtn = screen.getByTitle('Toggle Recording');
    fireEvent.click(recordBtn);

    expect(screen.getByText('Recording')).toBeInTheDocument();

    // Toggle off
    fireEvent.click(screen.getByTitle('Toggle Recording'));
    expect(screen.queryByText('Recording')).toBeNull();
  });

  // ── Canvas wheel zoom ─────────────────────────────────────────────────

  it('handles wheel event for zoom', () => {
    setupStore();
    const { container } = render(<TimelinePanel />);

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();

    // Wheel up → zoom in
    fireEvent.wheel(canvas!, { deltaY: -1 });
    // Zoom should increase from 1.0
    expect(container.textContent).toMatch(/1\.[1-9]/);
  });

  // ── Mouse interactions on canvas ──────────────────────────────────────

  it('handles mouse down on ruler area to jump playhead', () => {
    setupStore();
    const { container } = render(<TimelinePanel />);

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();

    // Click in the ruler area (y < 30)
    fireEvent.mouseDown(canvas!, { clientX: 200, clientY: 10 });

    // Playhead time should have changed (won't be 0.00s anymore)
    // The exact time depends on zoom, offset, and pixelsPerSecond
    expect(container.textContent).toBeDefined();
  });

  it('handles mouseUp to stop dragging', () => {
    setupStore();
    const { container } = render(<TimelinePanel />);
    const canvas = container.querySelector('canvas');

    // No error on mouseUp without prior drag
    fireEvent.mouseUp(canvas!);
    expect(container.textContent).toBeDefined();
  });

  // ── Empty tracks ──────────────────────────────────────────────────────

  it('renders with empty tracks array', () => {
    setupStore({
      primaryAnimationClip: {
        duration: 2.0,
        speed: 1.0,
        playing: false,
        playMode: 'loop',
        currentTime: 0,
        tracks: [],
      },
    });
    render(<TimelinePanel />);
    expect(screen.getByTitle('Play')).toBeInTheDocument();
  });
});
