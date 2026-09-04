/**
 * Tests for UICanvasOverlay.
 *
 * Covers: the null-render guard when there is no active screen, the grid
 * overlay's showGrid conditional, and the click-through from the rendered
 * preview into the store's selectWidget action.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { UICanvasOverlay } from '../UICanvasOverlay';
import { useUIBuilderStore } from '@/stores/uiBuilderStore';

vi.mock('@/stores/uiBuilderStore', () => ({
  useUIBuilderStore: vi.fn(),
}));

vi.mock('../UIPreviewRenderer', () => ({
  UIPreviewRenderer: ({
    onWidgetClick,
  }: {
    onWidgetClick: (widgetId: string) => void;
  }) => (
    <button type="button" data-testid="preview-widget" onClick={() => onWidgetClick('widget-1')}>
      preview
    </button>
  ),
}));

const mockSelectWidget = vi.fn();

function setupStore(overrides: Partial<{ activeScreenId: string | null; screens: unknown[]; showGrid: boolean }>) {
  const state = {
    activeScreenId: 'screen-1',
    screens: [{ id: 'screen-1', widgets: [] }],
    selectedWidgetId: null,
    selectWidget: mockSelectWidget,
    showGrid: true,
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useUIBuilderStore).mockImplementation((selector: any) =>
    typeof selector === 'function' ? selector(state) : state
  );
}

describe('UICanvasOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when there is no matching active screen', () => {
    setupStore({ activeScreenId: 'missing', screens: [{ id: 'screen-1', widgets: [] }] });

    const { container } = render(<UICanvasOverlay />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the grid overlay when showGrid is true', () => {
    setupStore({ showGrid: true });

    const { container } = render(<UICanvasOverlay />);

    expect(container.querySelector('.pointer-events-none')).toBeTruthy();
    expect(screen.getByTestId('preview-widget')).toBeDefined();
  });

  it('omits the grid overlay when showGrid is false', () => {
    setupStore({ showGrid: false });

    const { container } = render(<UICanvasOverlay />);

    // Only the pointer-events-auto preview wrapper remains, no grid div.
    const gridDivs = Array.from(container.querySelectorAll('div')).filter((el) =>
      el.style.backgroundImage?.includes('linear-gradient')
    );
    expect(gridDivs).toHaveLength(0);
  });

  it('forwards a widget click through to selectWidget', () => {
    setupStore({});

    render(<UICanvasOverlay />);
    fireEvent.click(screen.getByTestId('preview-widget'));

    expect(mockSelectWidget).toHaveBeenCalledWith('widget-1');
  });
});
