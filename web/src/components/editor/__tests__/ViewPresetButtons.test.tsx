/**
 * Render tests for ViewPresetButtons component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ViewPresetButtons } from '../ViewPresetButtons';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  ArrowUp: (props: Record<string, unknown>) => <span data-testid="icon-arrow-up" {...props} />,
  Box: (props: Record<string, unknown>) => <span data-testid="icon-box" {...props} />,
  Eye: (props: Record<string, unknown>) => <span data-testid="icon-eye" {...props} />,
  Square: (props: Record<string, unknown>) => <span data-testid="icon-square" {...props} />,
}));

describe('ViewPresetButtons', () => {
  const mockSetCameraPreset = vi.fn();

  function setupStore(currentPreset: string = 'perspective') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        currentCameraPreset: currentPreset,
        setCameraPreset: mockSetCameraPreset,
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

  it('renders toolbar with camera preset buttons', () => {
    setupStore();
    render(<ViewPresetButtons />);
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
  });

  it('renders Top View button', () => {
    setupStore();
    render(<ViewPresetButtons />);
    expect(screen.getByLabelText('Top View (Numpad 7)')).toBeInTheDocument();
  });

  it('renders Front View button', () => {
    setupStore();
    render(<ViewPresetButtons />);
    expect(screen.getByLabelText('Front View (Numpad 1)')).toBeInTheDocument();
  });

  it('renders Right View button', () => {
    setupStore();
    render(<ViewPresetButtons />);
    expect(screen.getByLabelText('Right View (Numpad 3)')).toBeInTheDocument();
  });

  it('renders Perspective View button', () => {
    setupStore();
    render(<ViewPresetButtons />);
    expect(screen.getByLabelText('Perspective View (Numpad 5)')).toBeInTheDocument();
  });

  it('marks active preset button as pressed', () => {
    setupStore('top');
    render(<ViewPresetButtons />);
    const topButton = screen.getByLabelText('Top View (Numpad 7)');
    expect(topButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('marks non-active preset buttons as not pressed', () => {
    setupStore('top');
    render(<ViewPresetButtons />);
    const perspButton = screen.getByLabelText('Perspective View (Numpad 5)');
    expect(perspButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('calls setCameraPreset with "top" when Top View is clicked', () => {
    setupStore();
    render(<ViewPresetButtons />);
    fireEvent.click(screen.getByLabelText('Top View (Numpad 7)'));
    expect(mockSetCameraPreset).toHaveBeenCalledWith('top');
  });

  it('calls setCameraPreset with "front" when Front View is clicked', () => {
    setupStore();
    render(<ViewPresetButtons />);
    fireEvent.click(screen.getByLabelText('Front View (Numpad 1)'));
    expect(mockSetCameraPreset).toHaveBeenCalledWith('front');
  });

  it('calls setCameraPreset with "perspective" when Perspective View is clicked', () => {
    setupStore();
    render(<ViewPresetButtons />);
    fireEvent.click(screen.getByLabelText('Perspective View (Numpad 5)'));
    expect(mockSetCameraPreset).toHaveBeenCalledWith('perspective');
  });
});
