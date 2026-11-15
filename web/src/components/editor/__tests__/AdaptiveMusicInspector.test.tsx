/**
 * Render tests for AdaptiveMusicInspector component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import AdaptiveMusicInspector from '../AdaptiveMusicInspector';
import { useEditorStore } from '@/stores/editorStore';
import { audioManager } from '@/lib/audio/audioManager';
import { toast } from 'sonner';

vi.mock('@/lib/audio/audioManager', () => ({
  audioManager: {
    // Default: a track is registered, so the slider path applies cleanly.
    setMusicIntensity: vi.fn(() => true),
    setAdaptiveMusic: vi.fn(),
    // Default: every entered asset ID is "loaded", so Configure Stems tests
    // that don't care about the unloaded-asset path see the plain success case.
    getBuffer: vi.fn(() => ({})),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

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

  it('forwards slider changes to audioManager.setMusicIntensity with the default trackId', () => {
    render(<AdaptiveMusicInspector />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '0.8' } });
    expect(audioManager.setMusicIntensity).toHaveBeenCalledWith('default', 0.8);
  });

  it('clamps out-of-range slider values before forwarding to audioManager and store', () => {
    render(<AdaptiveMusicInspector />);
    const slider = screen.getByRole('slider');
    // The DOM range input caps at max="1", so drive the handler directly via a
    // synthetic value above the range to prove the clamp, not the browser cap.
    fireEvent.change(slider, { target: { value: '1.5' } });
    expect(audioManager.setMusicIntensity).toHaveBeenCalledWith('default', 1);
    expect(mockSetAdaptiveMusicIntensity).toHaveBeenCalledWith(1);
    // No unclamped value ever reaches the manager.
    expect(audioManager.setMusicIntensity).not.toHaveBeenCalledWith('default', 1.5);
  });

  it('does not forward a NaN slider value to audioManager or the store', () => {
    render(<AdaptiveMusicInspector />);
    const slider = screen.getByRole('slider');
    // An empty value yields parseFloat('') === NaN; the previous mix must hold.
    fireEvent.change(slider, { target: { value: '' } });
    expect(audioManager.setMusicIntensity).not.toHaveBeenCalled();
    expect(mockSetAdaptiveMusicIntensity).not.toHaveBeenCalled();
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

  it('registers the default adaptive track when Configure Stems runs with a stem asset', () => {
    setupStore({ intensity: 0.5 });
    render(<AdaptiveMusicInspector />);
    // First "Asset ID" input is the pad stem.
    const padInput = screen.getAllByPlaceholderText('Asset ID')[0];
    fireEvent.change(padInput, { target: { value: 'pad-asset' } });
    fireEvent.click(screen.getByText('Configure Stems'));

    expect(audioManager.setAdaptiveMusic).toHaveBeenCalledWith(
      'default',
      [{ name: 'pad', assetId: 'pad-asset' }],
      { initialIntensity: 0.5 },
    );
    expect(toast.success).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not register a track and warns when Configure Stems runs with no stem assets', () => {
    render(<AdaptiveMusicInspector />);
    fireEvent.click(screen.getByText('Configure Stems'));

    expect(audioManager.setAdaptiveMusic).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('does not register a track and warns when the only entered stem asset is not loaded', () => {
    // No buffer for this asset id: addLayer would no-op inside setAdaptiveMusic,
    // producing a track with zero playable layers, so the call must not happen.
    vi.mocked(audioManager.getBuffer).mockReturnValue(undefined);
    render(<AdaptiveMusicInspector />);
    const padInput = screen.getAllByPlaceholderText('Asset ID')[0];
    fireEvent.change(padInput, { target: { value: 'missing-asset' } });
    fireEvent.click(screen.getByText('Configure Stems'));

    expect(audioManager.setAdaptiveMusic).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('missing-asset'),
      expect.objectContaining({ id: 'adaptive-music-stems-unloaded' }),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('registers only the loaded stems and warns about skipped ones on a partial load', () => {
    // pad-asset is loaded, bass-asset is not.
    vi.mocked(audioManager.getBuffer).mockImplementation((assetId: string) => (assetId === 'pad-asset' ? {} as AudioBuffer : undefined));
    setupStore({ intensity: 0.5 });
    render(<AdaptiveMusicInspector />);
    const [padInput, bassInput] = screen.getAllByPlaceholderText('Asset ID');
    fireEvent.change(padInput, { target: { value: 'pad-asset' } });
    fireEvent.change(bassInput, { target: { value: 'bass-asset' } });
    fireEvent.click(screen.getByText('Configure Stems'));

    expect(audioManager.setAdaptiveMusic).toHaveBeenCalledWith(
      'default',
      [
        { name: 'pad', assetId: 'pad-asset' },
        { name: 'bass', assetId: 'bass-asset' },
      ],
      { initialIntensity: 0.5 },
    );
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('bass-asset'),
      expect.objectContaining({ id: 'adaptive-music-stems-unloaded' }),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('warns via toast when the slider moves but no adaptive track is registered', () => {
    // No track registered: setMusicIntensity reports it did nothing.
    vi.mocked(audioManager.setMusicIntensity).mockReturnValue(false);
    render(<AdaptiveMusicInspector />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.6' } });

    expect(audioManager.setMusicIntensity).toHaveBeenCalledWith('default', 0.6);
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Configure stems'),
      expect.objectContaining({ id: 'adaptive-music-no-track' }),
    );
  });

  it('does not warn when the slider moves and a track is registered', () => {
    // Track present: setMusicIntensity reports success, so no toast should fire.
    vi.mocked(audioManager.setMusicIntensity).mockReturnValue(true);
    render(<AdaptiveMusicInspector />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.6' } });

    expect(audioManager.setMusicIntensity).toHaveBeenCalledWith('default', 0.6);
    expect(toast.error).not.toHaveBeenCalled();
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
