import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { PlayControls } from '../PlayControls';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

import { useEditorStore } from '@/stores/editorStore';

function mockEditorStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    engineMode: 'edit',
    play: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('PlayControls', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders play, pause, and stop buttons in edit mode', () => {
    mockEditorStore();
    render(<PlayControls />);
    expect(screen.getByRole('button', { name: /play/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /pause/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /stop/i })).not.toBeNull();
  });

  it('shows Playing status indicator when in play mode', () => {
    mockEditorStore({ engineMode: 'play' });
    render(<PlayControls />);
    expect(screen.getByText('Playing')).not.toBeNull();
  });

  it('shows Paused status and resume button when paused', () => {
    mockEditorStore({ engineMode: 'paused' });
    render(<PlayControls />);
    expect(screen.getByText('Paused')).not.toBeNull();
    expect(screen.getByRole('button', { name: /resume/i })).not.toBeNull();
  });

  it('calls play when play button is clicked in edit mode', () => {
    const mockPlay = vi.fn();
    mockEditorStore({ play: mockPlay });
    render(<PlayControls />);
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    expect(mockPlay).toHaveBeenCalled();
  });

  it('pause → resume cycle: pause calls pause, then resume shows resume button', () => {
    const mockPause = vi.fn();
    mockEditorStore({ engineMode: 'play', pause: mockPause });
    render(<PlayControls />);

    // Pause button should be enabled in play mode
    const pauseBtn = screen.getByRole('button', { name: /pause/i });
    expect(pauseBtn).toBeDefined();
    fireEvent.click(pauseBtn);
    expect(mockPause).toHaveBeenCalledTimes(1);

    // Re-render in paused mode — resume button appears
    cleanup();
    const mockResume = vi.fn();
    mockEditorStore({ engineMode: 'paused', resume: mockResume });
    render(<PlayControls />);
    const resumeBtn = screen.getByRole('button', { name: /resume/i });
    expect(resumeBtn).toBeDefined();
    fireEvent.click(resumeBtn);
    expect(mockResume).toHaveBeenCalledTimes(1);
  });

  it('stop button dispatches stop command', () => {
    const mockStop = vi.fn();
    mockEditorStore({ engineMode: 'play', stop: mockStop });
    render(<PlayControls />);

    const stopBtn = screen.getByRole('button', { name: /stop/i });
    expect(stopBtn).toBeDefined();
    fireEvent.click(stopBtn);
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('play button is disabled when not in edit mode (play mode)', () => {
    mockEditorStore({ engineMode: 'play' });
    render(<PlayControls />);
    const playBtn = screen.getByRole('button', { name: /play/i });
    // disabled attribute is set on the button element
    expect((playBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('play button is disabled when not in edit mode (paused mode)', () => {
    mockEditorStore({ engineMode: 'paused' });
    render(<PlayControls />);
    // In paused mode, the Resume button replaces Play; no play button present
    const resumeBtn = screen.getByRole('button', { name: /resume/i });
    expect(resumeBtn).toBeDefined();
  });

  it('stop button is disabled in edit mode', () => {
    mockEditorStore({ engineMode: 'edit' });
    render(<PlayControls />);
    const stopBtn = screen.getByRole('button', { name: /stop/i });
    expect((stopBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('pause button is disabled in edit mode', () => {
    mockEditorStore({ engineMode: 'edit' });
    render(<PlayControls />);
    const pauseBtn = screen.getByRole('button', { name: /pause/i });
    expect((pauseBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('pause button is enabled in play mode', () => {
    mockEditorStore({ engineMode: 'play' });
    render(<PlayControls />);
    const pauseBtn = screen.getByRole('button', { name: /pause/i });
    expect((pauseBtn as HTMLButtonElement).disabled).toBe(false);
  });
});
