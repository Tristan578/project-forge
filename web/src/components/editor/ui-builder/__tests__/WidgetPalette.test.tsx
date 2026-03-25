/**
 * Render tests for WidgetPalette component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { WidgetPalette } from '../WidgetPalette';
import { useUIBuilderStore } from '@/stores/uiBuilderStore';

vi.mock('@/stores/uiBuilderStore', () => ({
  useUIBuilderStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  Type: (props: Record<string, unknown>) => <span data-testid="icon-type" {...props} />,
  Image: (props: Record<string, unknown>) => <span data-testid="icon-image" {...props} />,
  Square: (props: Record<string, unknown>) => <span data-testid="icon-square" {...props} />,
  BarChart3: (props: Record<string, unknown>) => <span data-testid="icon-barchart" {...props} />,
  LayoutGrid: (props: Record<string, unknown>) => <span data-testid="icon-layoutgrid" {...props} />,
  Grid3X3: (props: Record<string, unknown>) => <span data-testid="icon-grid3x3" {...props} />,
  ScrollText: (props: Record<string, unknown>) => <span data-testid="icon-scrolltext" {...props} />,
  SlidersHorizontal: (props: Record<string, unknown>) => <span data-testid="icon-sliders" {...props} />,
  ToggleLeft: (props: Record<string, unknown>) => <span data-testid="icon-toggle" {...props} />,
  Map: (props: Record<string, unknown>) => <span data-testid="icon-map" {...props} />,
}));

describe('WidgetPalette', () => {
  const mockAddWidget = vi.fn();

  function setupStore(activeScreenId: string | null = 'screen1') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useUIBuilderStore).mockImplementation((selector: any) => {
      const state = {
        activeScreenId,
        addWidget: mockAddWidget,
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

  it('renders all widget type labels', () => {
    setupStore();
    render(<WidgetPalette />);
    expect(screen.getByText('Text')).not.toBeNull();
    expect(screen.getByText('Image')).not.toBeNull();
    expect(screen.getByText('Button')).not.toBeNull();
    expect(screen.getByText('Progress')).not.toBeNull();
    expect(screen.getByText('Panel')).not.toBeNull();
    expect(screen.getByText('Grid')).not.toBeNull();
    expect(screen.getByText('Scroll')).not.toBeNull();
    expect(screen.getByText('Slider')).not.toBeNull();
    expect(screen.getByText('Toggle')).not.toBeNull();
    expect(screen.getByText('Minimap')).not.toBeNull();
  });

  it('calls addWidget with correct type when Text button is clicked', () => {
    setupStore();
    render(<WidgetPalette />);
    fireEvent.click(screen.getByText('Text'));
    expect(mockAddWidget).toHaveBeenCalledWith('screen1', 'text');
  });

  it('calls addWidget with correct type when Button button is clicked', () => {
    setupStore();
    render(<WidgetPalette />);
    fireEvent.click(screen.getByText('Button'));
    expect(mockAddWidget).toHaveBeenCalledWith('screen1', 'button');
  });

  it('does not call addWidget when no active screen', () => {
    setupStore(null);
    render(<WidgetPalette />);
    fireEvent.click(screen.getByText('Text'));
    expect(mockAddWidget).not.toHaveBeenCalled();
  });

  it('renders 10 widget buttons', () => {
    setupStore();
    render(<WidgetPalette />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(10);
  });
});
