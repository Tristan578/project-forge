/**
 * Tests for AnimationClipInspector — create/remove clip, properties, tracks,
 * keyframes, preview controls, add track flow.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { AnimationClipInspector } from '../AnimationClipInspector';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

const mockCreateAnimationClip = vi.fn();
const mockAddClipKeyframe = vi.fn();
const mockRemoveClipKeyframe = vi.fn();
const mockUpdateClipKeyframe = vi.fn();
const mockSetClipProperty = vi.fn();
const mockPreviewClip = vi.fn();
const mockRemoveAnimationClip = vi.fn();

const defaultClip = {
  duration: 2.0,
  playMode: 'loop',
  speed: 1.0,
  autoplay: false,
  tracks: [
    {
      target: 'position_x',
      keyframes: [
        { time: 0, value: 0, interpolation: 'linear' },
        { time: 1, value: 5, interpolation: 'ease_in' },
      ],
    },
  ],
};

function setupStore(overrides: {
  primaryId?: string | null;
  primaryAnimationClip?: typeof defaultClip | null;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = {
      primaryId: 'primaryId' in overrides ? overrides.primaryId : 'ent-1',
      primaryAnimationClip: 'primaryAnimationClip' in overrides ? overrides.primaryAnimationClip : defaultClip,
      createAnimationClip: mockCreateAnimationClip,
      addClipKeyframe: mockAddClipKeyframe,
      removeClipKeyframe: mockRemoveClipKeyframe,
      updateClipKeyframe: mockUpdateClipKeyframe,
      setClipProperty: mockSetClipProperty,
      previewClip: mockPreviewClip,
      removeAnimationClip: mockRemoveAnimationClip,
    };
    return selector(state);
  });
}

describe('AnimationClipInspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── No entity ─────────────────────────────────────────────────────────

  it('renders nothing when no entity selected', () => {
    setupStore({ primaryId: null });
    const { container } = render(<AnimationClipInspector />);
    expect(container.innerHTML).toBe('');
  });

  // ── No clip ───────────────────────────────────────────────────────────

  it('shows Add Animation Clip button when no clip', () => {
    setupStore({ primaryAnimationClip: null });
    render(<AnimationClipInspector />);
    expect(screen.getByText('Add Animation Clip')).not.toBeNull();
  });

  it('creates clip on Add button click', () => {
    setupStore({ primaryAnimationClip: null });
    render(<AnimationClipInspector />);
    fireEvent.click(screen.getByText('Add Animation Clip'));
    expect(mockCreateAnimationClip).toHaveBeenCalledWith('ent-1');
  });

  // ── Header ────────────────────────────────────────────────────────────

  it('renders Keyframe Animation header', () => {
    setupStore();
    render(<AnimationClipInspector />);
    expect(screen.getByText('Keyframe Animation')).not.toBeNull();
  });

  it('shows track count badge', () => {
    setupStore();
    render(<AnimationClipInspector />);
    expect(screen.getByText('1 track')).not.toBeNull();
  });

  // ── Clip properties ───────────────────────────────────────────────────

  it('renders duration input with correct value', () => {
    setupStore();
    render(<AnimationClipInspector />);
    expect(screen.getByText('Duration (s)')).not.toBeNull();
    const durationInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    expect(durationInput.value).toBe('2');
  });

  it('changes duration', () => {
    setupStore();
    render(<AnimationClipInspector />);
    const durationInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(durationInput, { target: { value: '3.5' } });
    expect(mockSetClipProperty).toHaveBeenCalledWith('ent-1', 3.5, undefined, undefined, undefined);
  });

  it('renders play mode select', () => {
    setupStore();
    render(<AnimationClipInspector />);
    expect(screen.getByText('Play Mode')).not.toBeNull();
    const selects = document.querySelectorAll('select');
    const playModeSelect = Array.from(selects).find((s) =>
      Array.from(s.options).some((o) => o.textContent === 'Loop'),
    ) as HTMLSelectElement;
    expect(playModeSelect.value).toBe('loop');
  });

  it('changes play mode', () => {
    setupStore();
    render(<AnimationClipInspector />);
    const selects = document.querySelectorAll('select');
    const playModeSelect = Array.from(selects).find((s) =>
      Array.from(s.options).some((o) => o.textContent === 'Ping Pong'),
    ) as HTMLSelectElement;
    fireEvent.change(playModeSelect, { target: { value: 'ping_pong' } });
    expect(mockSetClipProperty).toHaveBeenCalledWith('ent-1', undefined, 'ping_pong', undefined, undefined);
  });

  it('renders speed slider', () => {
    setupStore();
    render(<AnimationClipInspector />);
    expect(screen.getByText('Speed')).not.toBeNull();
    expect(screen.getByText('1.0x')).not.toBeNull();
  });

  it('changes speed', () => {
    setupStore();
    render(<AnimationClipInspector />);
    const rangeInput = document.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(rangeInput, { target: { value: '2.0' } });
    expect(mockSetClipProperty).toHaveBeenCalledWith('ent-1', undefined, undefined, 2.0, undefined);
  });

  it('renders autoplay checkbox', () => {
    setupStore();
    render(<AnimationClipInspector />);
    expect(screen.getByText('Autoplay in Play mode')).not.toBeNull();
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('toggles autoplay', () => {
    setupStore();
    render(<AnimationClipInspector />);
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(mockSetClipProperty).toHaveBeenCalledWith('ent-1', undefined, undefined, undefined, true);
  });

  // ── Preview controls ──────────────────────────────────────────────────

  it('renders Preview and Stop buttons', () => {
    setupStore();
    render(<AnimationClipInspector />);
    expect(screen.getByText('Preview')).not.toBeNull();
    // Stop button exists among buttons
    const buttons = document.querySelectorAll('button');
    const stopBtn = Array.from(buttons).find((b) => b.textContent?.includes('Stop'));
    expect(stopBtn).toBeDefined();
  });

  it('calls previewClip play on Preview click', () => {
    setupStore();
    render(<AnimationClipInspector />);
    fireEvent.click(screen.getByText('Preview'));
    expect(mockPreviewClip).toHaveBeenCalledWith('ent-1', 'play');
  });

  it('calls previewClip stop on Stop click', () => {
    setupStore();
    render(<AnimationClipInspector />);
    const buttons = document.querySelectorAll('button');
    const stopBtn = Array.from(buttons).find((b) => b.textContent?.includes('Stop'))!;
    fireEvent.click(stopBtn);
    expect(mockPreviewClip).toHaveBeenCalledWith('ent-1', 'stop');
  });

  // ── Track rendering ───────────────────────────────────────────────────

  it('renders track with target label', () => {
    setupStore();
    render(<AnimationClipInspector />);
    expect(screen.getByText('Position X')).not.toBeNull();
  });

  it('shows keyframe count on track', () => {
    setupStore();
    render(<AnimationClipInspector />);
    expect(screen.getByText('2 keyframes')).not.toBeNull();
  });

  it('expands track on click to show keyframes', () => {
    setupStore();
    render(<AnimationClipInspector />);
    fireEvent.click(screen.getByText('Position X'));
    // After expanding, keyframe values should be visible
    expect(screen.getByText('Add Keyframe')).not.toBeNull();
  });

  // ── Add track flow ────────────────────────────────────────────────────

  it('renders Add Track button', () => {
    setupStore();
    render(<AnimationClipInspector />);
    // The outer Add Track button (not in expanded track)
    const buttons = document.querySelectorAll('button');
    const addTrackBtn = Array.from(buttons).find((b) => b.textContent?.includes('Add Track'));
    expect(addTrackBtn).toBeDefined();
  });

  it('opens add track form on click', () => {
    setupStore();
    render(<AnimationClipInspector />);
    const buttons = document.querySelectorAll('button');
    const addTrackBtn = Array.from(buttons).find((b) => b.textContent?.includes('Add Track'))!;
    fireEvent.click(addTrackBtn);
    expect(screen.getByText('Property')).not.toBeNull();
    expect(screen.getByText('Select property...')).not.toBeNull();
  });

  // ── Remove clip ───────────────────────────────────────────────────────

  it('renders Remove Animation Clip button', () => {
    setupStore();
    render(<AnimationClipInspector />);
    expect(screen.getByText('Remove Animation Clip')).not.toBeNull();
  });

  it('removes clip on click', () => {
    setupStore();
    render(<AnimationClipInspector />);
    fireEvent.click(screen.getByText('Remove Animation Clip'));
    expect(mockRemoveAnimationClip).toHaveBeenCalledWith('ent-1');
  });
});
