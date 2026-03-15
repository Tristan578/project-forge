/**
 * Render tests for AudioMixerPanel component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { AudioMixerPanel } from '../AudioMixerPanel';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  SlidersHorizontal: (props: Record<string, unknown>) => <span data-testid="sliders-icon" {...props} />,
  Plus: (props: Record<string, unknown>) => <span data-testid="plus-icon" {...props} />,
}));

describe('AudioMixerPanel', () => {
  const mockUpdateAudioBus = vi.fn();
  const mockSetBusEffects = vi.fn();
  const mockCreateAudioBus = vi.fn();

  const defaultBuses = [
    { name: 'master', volume: 0.8, muted: false, soloed: false, effects: [] },
    { name: 'sfx', volume: 1.0, muted: false, soloed: false, effects: [] },
    { name: 'music', volume: 0.6, muted: true, soloed: false, effects: [] },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        audioBuses: defaultBuses,
        updateAudioBus: mockUpdateAudioBus,
        setBusEffects: mockSetBusEffects,
        createAudioBus: mockCreateAudioBus,
      };
      return selector(state);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the Audio Mixer header', () => {
    render(<AudioMixerPanel />);
    expect(screen.getByText('Audio Mixer')).toBeDefined();
  });

  it('renders mixer strips for each bus', () => {
    render(<AudioMixerPanel />);
    expect(screen.getByText('master')).toBeDefined();
    expect(screen.getByText('sfx')).toBeDefined();
    expect(screen.getByText('music')).toBeDefined();
  });

  it('renders volume sliders with aria-labels', () => {
    render(<AudioMixerPanel />);
    expect(screen.getByRole('slider', { name: /master volume/i })).toBeDefined();
    expect(screen.getByRole('slider', { name: /sfx volume/i })).toBeDefined();
    expect(screen.getByRole('slider', { name: /music volume/i })).toBeDefined();
  });

  it('renders mute buttons with aria-label and aria-pressed', () => {
    render(<AudioMixerPanel />);
    const muteButtons = screen.getAllByRole('button', { name: /^Mute /i });
    expect(muteButtons.length).toBe(3);

    // music bus is muted
    const musicMute = screen.getByRole('button', { name: /Mute music/i });
    expect(musicMute.getAttribute('aria-pressed')).toBe('true');

    // master is not muted
    const masterMute = screen.getByRole('button', { name: /Mute master/i });
    expect(masterMute.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders solo buttons for non-master buses', () => {
    render(<AudioMixerPanel />);
    const soloButtons = screen.getAllByRole('button', { name: /^Solo /i });
    // Solo should appear for sfx and music, not master
    expect(soloButtons.length).toBe(2);
    expect(screen.getByRole('button', { name: /Solo sfx/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Solo music/i })).toBeDefined();
  });

  it('displays volume percentage', () => {
    render(<AudioMixerPanel />);
    expect(screen.getByText('80%')).toBeDefined(); // master 0.8
    expect(screen.getByText('100%')).toBeDefined(); // sfx 1.0
    expect(screen.getByText('60%')).toBeDefined(); // music 0.6
  });

  it('renders Add Bus button', () => {
    render(<AudioMixerPanel />);
    expect(screen.getByText('Add Bus')).toBeDefined();
  });

  it('shows add bus dialog when Add Bus is clicked', () => {
    render(<AudioMixerPanel />);
    fireEvent.click(screen.getByText('Add Bus'));
    expect(screen.getByRole('textbox', { name: /new bus name/i })).toBeDefined();
    expect(screen.getByText('Create')).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('creates a new bus when form is submitted', () => {
    render(<AudioMixerPanel />);
    fireEvent.click(screen.getByText('Add Bus'));

    const input = screen.getByRole('textbox', { name: /new bus name/i });
    fireEvent.change(input, { target: { value: 'ambient' } });
    fireEvent.click(screen.getByText('Create'));

    expect(mockCreateAudioBus).toHaveBeenCalledWith('ambient', 1.0);
  });

  it('does not create bus with empty name', () => {
    render(<AudioMixerPanel />);
    fireEvent.click(screen.getByText('Add Bus'));
    fireEvent.click(screen.getByText('Create'));

    expect(mockCreateAudioBus).not.toHaveBeenCalled();
  });

  it('hides add bus dialog when Cancel is clicked', () => {
    render(<AudioMixerPanel />);
    fireEvent.click(screen.getByText('Add Bus'));
    expect(screen.getByRole('textbox', { name: /new bus name/i })).toBeDefined();

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByRole('textbox', { name: /new bus name/i })).toBeNull();
  });

  it('renders with empty bus list', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        audioBuses: [],
        updateAudioBus: mockUpdateAudioBus,
        setBusEffects: mockSetBusEffects,
        createAudioBus: mockCreateAudioBus,
      };
      return selector(state);
    });

    render(<AudioMixerPanel />);
    expect(screen.getByText('Audio Mixer')).toBeDefined();
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
  });
});
