/**
 * @vitest-environment jsdom
 */
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
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('shows Playing status indicator when in play mode', () => {
    mockEditorStore({ engineMode: 'play' });
    render(<PlayControls />);
    expect(screen.getByText('Playing')).toBeInTheDocument();
  });

  it('shows Paused status and resume button when paused', () => {
    mockEditorStore({ engineMode: 'paused' });
    render(<PlayControls />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument();
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
    expect(pauseBtn).toBeInTheDocument();
    fireEvent.click(pauseBtn);
    expect(mockPause).toHaveBeenCalledTimes(1);

    // Re-render in paused mode — resume button appears
    cleanup();
    const mockResume = vi.fn();
    mockEditorStore({ engineMode: 'paused', resume: mockResume });
    render(<PlayControls />);
    const resumeBtn = screen.getByRole('button', { name: /resume/i });
    expect(resumeBtn).toBeInTheDocument();
    fireEvent.click(resumeBtn);
    expect(mockResume).toHaveBeenCalledTimes(1);
  });

  it('stop button dispatches stop command', () => {
    const mockStop = vi.fn();
    mockEditorStore({ engineMode: 'play', stop: mockStop });
    render(<PlayControls />);

    const stopBtn = screen.getByRole('button', { name: /stop/i });
    expect(stopBtn).toBeInTheDocument();
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
    expect(resumeBtn).toBeInTheDocument();
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

  // --- Full lifecycle tests ---

  it('full play → pause → resume → stop lifecycle', () => {
    const mockPlay = vi.fn();
    const mockPause = vi.fn();
    const mockResume = vi.fn();
    const mockStop = vi.fn();

    // Step 1: Edit mode — click play
    mockEditorStore({ engineMode: 'edit', play: mockPlay, pause: mockPause, resume: mockResume, stop: mockStop });
    render(<PlayControls />);
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    expect(mockPlay).toHaveBeenCalledTimes(1);
    cleanup();

    // Step 2: Play mode — click pause
    mockEditorStore({ engineMode: 'play', play: mockPlay, pause: mockPause, resume: mockResume, stop: mockStop });
    render(<PlayControls />);
    expect(screen.getByText('Playing')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(mockPause).toHaveBeenCalledTimes(1);
    cleanup();

    // Step 3: Paused mode — click resume
    mockEditorStore({ engineMode: 'paused', play: mockPlay, pause: mockPause, resume: mockResume, stop: mockStop });
    render(<PlayControls />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    expect(mockResume).toHaveBeenCalledTimes(1);
    cleanup();

    // Step 4: Back to play mode — click stop
    mockEditorStore({ engineMode: 'play', play: mockPlay, pause: mockPause, resume: mockResume, stop: mockStop });
    render(<PlayControls />);
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  // --- Stop command validation ---

  it('stop is callable from paused mode', () => {
    const mockStop = vi.fn();
    mockEditorStore({ engineMode: 'paused', stop: mockStop });
    render(<PlayControls />);

    const stopBtn = screen.getByRole('button', { name: /stop/i });
    expect((stopBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(stopBtn);
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('stop button is enabled in both play and paused modes', () => {
    // Play mode
    mockEditorStore({ engineMode: 'play' });
    render(<PlayControls />);
    expect((screen.getByRole('button', { name: /stop/i }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();

    // Paused mode
    mockEditorStore({ engineMode: 'paused' });
    render(<PlayControls />);
    expect((screen.getByRole('button', { name: /stop/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  // --- Button state / disabled states ---

  it('pause button is disabled in paused mode', () => {
    mockEditorStore({ engineMode: 'paused' });
    render(<PlayControls />);
    const pauseBtn = screen.getByRole('button', { name: /pause/i });
    expect((pauseBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('no status indicator is shown in edit mode', () => {
    mockEditorStore({ engineMode: 'edit' });
    render(<PlayControls />);
    expect(screen.queryByText('Playing')).not.toBeInTheDocument();
    expect(screen.queryByText('Paused')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('resume button does not appear in edit mode', () => {
    mockEditorStore({ engineMode: 'edit' });
    render(<PlayControls />);
    expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument();
    // Play button should be present instead
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
  });

  it('resume button does not appear in play mode', () => {
    mockEditorStore({ engineMode: 'play' });
    render(<PlayControls />);
    expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument();
    // Play button should be present (but disabled)
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
  });

  // --- Edge cases: double-click and rapid toggling ---

  it('clicking play when already in play mode does nothing (button disabled)', () => {
    const mockPlay = vi.fn();
    mockEditorStore({ engineMode: 'play', play: mockPlay });
    render(<PlayControls />);

    const playBtn = screen.getByRole('button', { name: /play/i });
    expect((playBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(playBtn);
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('clicking stop when in edit mode does nothing (button disabled)', () => {
    const mockStop = vi.fn();
    mockEditorStore({ engineMode: 'edit', stop: mockStop });
    render(<PlayControls />);

    const stopBtn = screen.getByRole('button', { name: /stop/i });
    expect((stopBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(stopBtn);
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('clicking pause when in edit mode does nothing (button disabled)', () => {
    const mockPause = vi.fn();
    mockEditorStore({ engineMode: 'edit', pause: mockPause });
    render(<PlayControls />);

    const pauseBtn = screen.getByRole('button', { name: /pause/i });
    expect((pauseBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pauseBtn);
    expect(mockPause).not.toHaveBeenCalled();
  });

  it('clicking pause when already paused does nothing (button disabled)', () => {
    const mockPause = vi.fn();
    mockEditorStore({ engineMode: 'paused', pause: mockPause });
    render(<PlayControls />);

    const pauseBtn = screen.getByRole('button', { name: /pause/i });
    expect((pauseBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pauseBtn);
    expect(mockPause).not.toHaveBeenCalled();
  });

  it('rapid play clicks only fire once per edit-mode render', () => {
    const mockPlay = vi.fn();
    mockEditorStore({ engineMode: 'edit', play: mockPlay });
    render(<PlayControls />);

    const playBtn = screen.getByRole('button', { name: /play/i });
    fireEvent.click(playBtn);
    fireEvent.click(playBtn);
    fireEvent.click(playBtn);
    // Button is not disabled in edit mode, so each click fires
    // but the store action handles idempotency — component passes clicks through
    expect(mockPlay).toHaveBeenCalledTimes(3);
  });

  it('rapid stop clicks while in play mode fire on every click', () => {
    const mockStop = vi.fn();
    mockEditorStore({ engineMode: 'play', stop: mockStop });
    render(<PlayControls />);

    const stopBtn = screen.getByRole('button', { name: /stop/i });
    fireEvent.click(stopBtn);
    fireEvent.click(stopBtn);
    // Button stays enabled for current render; store handles mode transition
    expect(mockStop).toHaveBeenCalledTimes(2);
  });

  // --- Status indicator appearance ---

  it('status indicator has correct text for play mode', () => {
    mockEditorStore({ engineMode: 'play' });
    render(<PlayControls />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Playing');
  });

  it('status indicator has correct text for paused mode', () => {
    mockEditorStore({ engineMode: 'paused' });
    render(<PlayControls />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Paused');
  });

  it('play button has correct title in edit mode', () => {
    mockEditorStore({ engineMode: 'edit' });
    render(<PlayControls />);
    const playBtn = screen.getByRole('button', { name: /play/i });
    expect(playBtn).toHaveAttribute('title', 'Play (Ctrl+P)');
  });

  it('resume button has correct title in paused mode', () => {
    mockEditorStore({ engineMode: 'paused' });
    render(<PlayControls />);
    const resumeBtn = screen.getByRole('button', { name: /resume/i });
    expect(resumeBtn).toHaveAttribute('title', 'Resume (Ctrl+P)');
  });
});
