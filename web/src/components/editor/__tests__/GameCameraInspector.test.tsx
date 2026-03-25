/**
 * Render tests for GameCameraInspector component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GameCameraInspector } from '../GameCameraInspector';
import { useEditorStore } from '@/stores/editorStore';
import type { GameCameraData } from '@/stores/slices/types';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

vi.mock('lucide-react', () => ({
  Camera: (props: Record<string, unknown>) => <span data-testid="camera-icon" {...props} />,
  Zap: (props: Record<string, unknown>) => <span data-testid="zap-icon" {...props} />,
}));

const baseGameCamera: GameCameraData = {
  mode: 'thirdPersonFollow',
  targetEntity: null,
  followDistance: 5,
  followHeight: 2,
  followLookAhead: 1,
  followSmoothing: 5,
};

describe('GameCameraInspector', () => {
  const mockSetGameCamera = vi.fn();
  const mockSetActiveGameCamera = vi.fn();
  const mockRemoveGameCamera = vi.fn();
  const mockCameraShake = vi.fn();

  function setupStore({
    primaryId = 'entity-1' as string | null,
    primaryGameCamera = baseGameCamera as GameCameraData | null,
    activeGameCameraId = null as string | null,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        primaryId,
        primaryGameCamera,
        activeGameCameraId,
        setGameCamera: mockSetGameCamera,
        setActiveGameCamera: mockSetActiveGameCamera,
        removeGameCamera: mockRemoveGameCamera,
        cameraShake: mockCameraShake,
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

  it('returns null when no primary entity', () => {
    setupStore({ primaryId: null });
    const { container } = render(<GameCameraInspector />);
    expect(container.firstChild).toBeNull();
  });

  it('shows "Add Game Camera" button when no camera configured', () => {
    setupStore({ primaryGameCamera: null });
    render(<GameCameraInspector />);
    expect(screen.getByText('Add Game Camera')).not.toBeNull();
  });

  it('renders Game Camera heading when camera configured', () => {
    setupStore();
    render(<GameCameraInspector />);
    expect(screen.getByText('Game Camera')).not.toBeNull();
  });

  it('renders Active checkbox', () => {
    setupStore();
    render(<GameCameraInspector />);
    expect(screen.getByRole('checkbox')).not.toBeNull();
  });

  it('renders Mode select dropdown', () => {
    setupStore();
    render(<GameCameraInspector />);
    expect(screen.getByRole('combobox')).not.toBeNull();
  });

  it('shows 3rd Person Follow as default mode', () => {
    setupStore();
    render(<GameCameraInspector />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('thirdPersonFollow');
  });

  it('shows thirdPersonFollow params by default', () => {
    setupStore();
    render(<GameCameraInspector />);
    expect(screen.getByText('Distance')).not.toBeNull();
    expect(screen.getByText('Look Ahead')).not.toBeNull();
    expect(screen.getByText('Smoothing')).not.toBeNull();
  });

  it('renders Test Shake button', () => {
    setupStore();
    render(<GameCameraInspector />);
    expect(screen.getByText('Test Shake')).not.toBeNull();
  });

  it('calls cameraShake when Test Shake is clicked', () => {
    setupStore();
    render(<GameCameraInspector />);
    fireEvent.click(screen.getByText('Test Shake'));
    expect(mockCameraShake).toHaveBeenCalledWith('entity-1', 0.3, 0.5);
  });

  it('renders Remove button', () => {
    setupStore();
    render(<GameCameraInspector />);
    expect(screen.getByText('Remove')).not.toBeNull();
  });

  it('calls removeGameCamera when Remove is clicked', () => {
    setupStore();
    render(<GameCameraInspector />);
    fireEvent.click(screen.getByText('Remove'));
    expect(mockRemoveGameCamera).toHaveBeenCalledWith('entity-1');
  });

  it('calls setGameCamera with new mode when mode changed', () => {
    setupStore();
    render(<GameCameraInspector />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'firstPerson' } });
    expect(mockSetGameCamera).toHaveBeenCalledWith('entity-1', expect.objectContaining({ mode: 'firstPerson' }));
  });

  it('shows fixed camera message for fixed mode', () => {
    setupStore({
      primaryGameCamera: { ...baseGameCamera, mode: 'fixed' as const },
    });
    render(<GameCameraInspector />);
    expect(screen.getByText(/Camera position is set via entity transform/)).not.toBeNull();
  });

  it('active checkbox is checked when this entity is the active camera', () => {
    setupStore({ activeGameCameraId: 'entity-1' });
    render(<GameCameraInspector />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });
});
