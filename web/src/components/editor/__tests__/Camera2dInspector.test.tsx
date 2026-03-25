/**
 * Render tests for Camera2dInspector component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { Camera2dInspector } from '../Camera2dInspector';
import { useEditorStore } from '@/stores/editorStore';
import type { Camera2dData } from '@/stores/slices/types';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

const baseCamera2d: Camera2dData = {
  zoom: 1.0,
  pixelPerfect: false,
  bounds: null,
};

describe('Camera2dInspector', () => {
  const mockSetCamera2dData = vi.fn();

  function setupStore({
    camera2dData = baseCamera2d as Camera2dData | null,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        camera2dData,
        setCamera2dData: mockSetCamera2dData,
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

  it('returns null when no camera2dData', () => {
    setupStore({ camera2dData: null });
    const { container } = render(<Camera2dInspector />);
    expect(container.firstChild).toBeNull();
  });

  it('renders 2D Camera heading', () => {
    setupStore();
    render(<Camera2dInspector />);
    expect(screen.getByText('2D Camera')).not.toBeNull();
  });

  it('renders Zoom label', () => {
    setupStore();
    render(<Camera2dInspector />);
    expect(screen.getByText('Zoom')).not.toBeNull();
  });

  it('renders zoom range input with current value', () => {
    setupStore({ camera2dData: { ...baseCamera2d, zoom: 2.5 } });
    render(<Camera2dInspector />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.value).toBe('2.5');
  });

  it('renders zoom display value formatted to 1 decimal', () => {
    setupStore({ camera2dData: { ...baseCamera2d, zoom: 1.0 } });
    render(<Camera2dInspector />);
    expect(screen.getByText('1.0')).not.toBeNull();
  });

  it('renders Pixel Perfect checkbox', () => {
    setupStore();
    render(<Camera2dInspector />);
    expect(screen.getByText('Pixel Perfect')).not.toBeNull();
  });

  it('pixel perfect checkbox reflects state', () => {
    setupStore({ camera2dData: { ...baseCamera2d, pixelPerfect: true } });
    render(<Camera2dInspector />);
    const checkboxes = screen.getAllByRole('checkbox');
    // first checkbox is Pixel Perfect
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
  });

  it('calls setCamera2dData when pixel perfect toggled', () => {
    setupStore();
    render(<Camera2dInspector />);
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(mockSetCamera2dData).toHaveBeenCalledWith(
      expect.objectContaining({ pixelPerfect: true })
    );
  });

  it('renders Enable Bounds checkbox', () => {
    setupStore();
    render(<Camera2dInspector />);
    expect(screen.getByText('Enable Bounds')).not.toBeNull();
  });

  it('does not show bounds inputs when bounds is null', () => {
    setupStore();
    render(<Camera2dInspector />);
    expect(screen.queryByText('Min X')).toBeNull();
    expect(screen.queryByText('Max X')).toBeNull();
  });

  it('shows bounds inputs when bounds is set', () => {
    setupStore({
      camera2dData: {
        ...baseCamera2d,
        bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
      },
    });
    render(<Camera2dInspector />);
    expect(screen.getByText('Min X')).not.toBeNull();
    expect(screen.getByText('Max X')).not.toBeNull();
    expect(screen.getByText('Min Y')).not.toBeNull();
    expect(screen.getByText('Max Y')).not.toBeNull();
  });

  it('calls setCamera2dData with default bounds when Enable Bounds checked', () => {
    setupStore();
    render(<Camera2dInspector />);
    const checkboxes = screen.getAllByRole('checkbox');
    // second checkbox is Enable Bounds
    fireEvent.click(checkboxes[1]);
    expect(mockSetCamera2dData).toHaveBeenCalledWith(
      expect.objectContaining({
        bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
      })
    );
  });

  it('calls setCamera2dData with null when Enable Bounds unchecked', () => {
    setupStore({
      camera2dData: {
        ...baseCamera2d,
        bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
      },
    });
    render(<Camera2dInspector />);
    const checkboxes = screen.getAllByRole('checkbox');
    // second checkbox is Enable Bounds (checked)
    fireEvent.click(checkboxes[1]);
    expect(mockSetCamera2dData).toHaveBeenCalledWith(
      expect.objectContaining({ bounds: null })
    );
  });
});
