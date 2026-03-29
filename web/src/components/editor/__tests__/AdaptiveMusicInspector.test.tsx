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
  useEditorStore: Object.assign(vi.fn(() => ({})), {
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
    expect(screen.getByText('Adaptive Music').textContent).toBe('Adaptive Music');
  });

  it('renders Play button initially', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByLabelText('Play')).toBeInTheDocument();
  });

  it('toggles to Pause when Play clicked', () => {
    render(<AdaptiveMusicInspector />);
    fireEvent.click(screen.getByLabelText('Play'));
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
  });

  it('renders Intensity label', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('Intensity').textContent).toBe('Intensity');
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
    expect(screen.getByText('50%').textContent).toBe('50%');
  });

  it('calls setAdaptiveMusicIntensity when slider changed', () => {
    render(<AdaptiveMusicInspector />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '0.8' } });
    expect(mockSetAdaptiveMusicIntensity).toHaveBeenCalledWith(0.8);
  });

  it('renders Stems section', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('Stems').textContent).toBe('Stems');
  });

  it('renders pad/bass/melody/drums inputs', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('pad').textContent).toBe('pad');
    expect(screen.getByText('bass').textContent).toBe('bass');
    expect(screen.getByText('melody').textContent).toBe('melody');
    expect(screen.getByText('drums').textContent).toBe('drums');
  });

  it('renders BPM input', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('BPM').textContent).toBe('BPM');
  });

  it('renders Configure Stems button', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('Configure Stems').textContent).toBe('Configure Stems');
  });

  it('renders Segments section', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('Segments').textContent).toBe('Segments');
  });

  it('renders segment buttons', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('intro').textContent).toBe('intro');
    expect(screen.getByText('main').textContent).toBe('main');
    expect(screen.getByText('combat').textContent).toBe('combat');
    expect(screen.getByText('calm').textContent).toBe('calm');
    expect(screen.getByText('outro').textContent).toBe('outro');
  });

  it('calls setCurrentMusicSegment when segment button clicked', () => {
    render(<AdaptiveMusicInspector />);
    fireEvent.click(screen.getByText('combat'));
    expect(mockSetCurrentMusicSegment).toHaveBeenCalledWith('combat');
  });

  it('renders Audio Snapshots section', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByText('Audio Snapshots').textContent).toBe('Audio Snapshots');
  });

  it('renders snapshot name input', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByPlaceholderText('Snapshot name').tagName.toLowerCase()).toMatch(/input|textarea/);
  });

  it('renders Create snapshot button', () => {
    render(<AdaptiveMusicInspector />);
    expect(screen.getByLabelText('Create snapshot')).toBeInTheDocument();
  });
});
