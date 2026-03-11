/**
 * Render tests for AdaptiveMusicInspector component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import AdaptiveMusicInspector from '../AdaptiveMusicInspector';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({
      audioBuses: [],
      updateAudioBus: vi.fn(),
    })),
  }),
}));

vi.mock('lucide-react', () => ({
  Play: (props: Record<string, unknown>) => <span data-testid="play-icon" {...props} />,
  Pause: (props: Record<string, unknown>) => <span data-testid="pause-icon" {...props} />,
  Save: (props: Record<string, unknown>) => <span data-testid="save-icon" {...props} />,
  Upload: (props: Record<string, unknown>) => <span data-testid="upload-icon" {...props} />,
}));

describe('AdaptiveMusicInspector', () => {
  const mockSetAdaptiveMusicIntensity = vi.fn();
  const mockSetCurrentMusicSegment = vi.fn();

  function setupStore({
    intensity = 0.5,
    currentSegment = 'main',
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        adaptiveMusicIntensity: intensity,
        setAdaptiveMusicIntensity: mockSetAdaptiveMusicIntensity,
        currentMusicSegment: currentSegment,
        setCurrentMusicSegment: mockSetCurrentMusicSegment,
        audioBuses: [],
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Adaptive Music heading', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('Adaptive Music')).toBeDefined();
  });

  it('renders Play button initially', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByLabelText('Play')).toBeDefined();
  });

  it('toggles to Pause when Play clicked', () => {
    render(<AdaptiveMusicInspector />);
    fireEvent.click(screen.getByLabelText('Play'));
    expect(screen.getByLabelText('Pause')).toBeDefined();
  });

  it('renders Intensity label', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('Intensity')).toBeDefined();
  });

  it('renders intensity slider with current value', () => {
    setupStore({ intensity: 0.75 });
    render(<AdaptiveMusicInspector />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.value).toBe('0.75');
  });

  it('shows intensity percentage', () => {
    setupStore({ intensity: 0.5 });
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('50%')).toBeDefined();
  });

  it('calls setAdaptiveMusicIntensity when slider changed', () => {
    render(<AdaptiveMusicInspector />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '0.8' } });
    expect(mockSetAdaptiveMusicIntensity).toHaveBeenCalledWith(0.8);
  });

  it('renders Stems section', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('Stems')).toBeDefined();
  });

  it('renders pad/bass/melody/drums inputs', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('pad')).toBeDefined();
    expect(screen.getByText('bass')).toBeDefined();
    expect(screen.getByText('melody')).toBeDefined();
    expect(screen.getByText('drums')).toBeDefined();
  });

  it('renders BPM input', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('BPM')).toBeDefined();
  });

  it('renders Configure Stems button', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('Configure Stems')).toBeDefined();
  });

  it('renders Segments section', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('Segments')).toBeDefined();
  });

  it('renders segment buttons', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('intro')).toBeDefined();
    expect(screen.getByText('main')).toBeDefined();
    expect(screen.getByText('combat')).toBeDefined();
    expect(screen.getByText('calm')).toBeDefined();
    expect(screen.getByText('outro')).toBeDefined();
  });

  it('calls setCurrentMusicSegment when segment button clicked', () => {
    render(<AdaptiveMusicInspector />);
    fireEvent.click(screen.getByText('combat'));
    expect(mockSetCurrentMusicSegment).toHaveBeenCalledWith('combat');
  });

  it('renders Audio Snapshots section', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('Audio Snapshots')).toBeDefined();
  });

  it('renders snapshot name input', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByPlaceholderText('Snapshot name')).toBeDefined();
  });

  it('renders Create snapshot button', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByLabelText('Create snapshot')).toBeDefined();
  });
});
