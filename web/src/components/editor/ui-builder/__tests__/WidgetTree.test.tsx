/**
 * Render tests for WidgetTree component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { WidgetTree } from '../WidgetTree';
import { useUIBuilderStore } from '@/stores/uiBuilderStore';

vi.mock('@/stores/uiBuilderStore', () => ({
  useUIBuilderStore: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  ChevronDown: (props: Record<string, unknown>) => <span data-testid="chevron-down" {...props} />,
  ChevronRight: (props: Record<string, unknown>) => <span data-testid="chevron-right" {...props} />,
  Trash2: (props: Record<string, unknown>) => <span data-testid="trash-icon" {...props} />,
  Copy: (props: Record<string, unknown>) => <span data-testid="copy-icon" {...props} />,
}));

const makeWidget = (id: string, name: string, type = 'text', children: string[] = []) => ({
  id,
  name,
  type,
  x: 0, y: 0, width: 100, height: 30,
  visible: true,
  interactable: true,
  anchor: 'top-left' as const,
  parentWidgetId: null,
  children,
  style: {},
  config: { content: name, dataBinding: null },
});

describe('WidgetTree', () => {
  const mockSelectWidget = vi.fn();
  const mockRemoveWidget = vi.fn();
  const mockDuplicateWidget = vi.fn();
  const mockReorderWidget = vi.fn();

  function setupStore({
    activeScreenId = 'screen1',
    selectedWidgetId = null as string | null,
    widgets = [makeWidget('w1', 'TextWidget', 'text'), makeWidget('w2', 'ButtonWidget', 'button')],
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useUIBuilderStore).mockImplementation((selector: any) => {
      const state = {
        activeScreenId,
        screens: [{ id: 'screen1', name: 'HUD', widgets }],
        selectedWidgetId,
        selectWidget: mockSelectWidget,
        removeWidget: mockRemoveWidget,
        duplicateWidget: mockDuplicateWidget,
        reorderWidget: mockReorderWidget,
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

  it('returns null when no active screen', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useUIBuilderStore).mockImplementation((selector: any) => {
      const state = {
        activeScreenId: 'nonexistent',
        screens: [],
        selectedWidgetId: null,
        selectWidget: mockSelectWidget,
        removeWidget: mockRemoveWidget,
        duplicateWidget: mockDuplicateWidget,
        reorderWidget: mockReorderWidget,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
    const { container } = render(<WidgetTree />);
    expect(container.firstChild).toBeNull();
  });

  it('shows empty state message when no widgets', () => {
    setupStore({ widgets: [] });
    render(<WidgetTree />);
    expect(screen.getByText('No widgets. Add one from the palette above.')).toBeDefined();
  });

  it('renders widget names', () => {
    setupStore();
    render(<WidgetTree />);
    expect(screen.getByText('TextWidget')).toBeDefined();
    expect(screen.getByText('ButtonWidget')).toBeDefined();
  });

  it('renders widget type labels', () => {
    setupStore();
    render(<WidgetTree />);
    expect(screen.getByText('text')).toBeDefined();
    expect(screen.getByText('button')).toBeDefined();
  });

  it('calls selectWidget when widget name is clicked', () => {
    setupStore();
    render(<WidgetTree />);
    fireEvent.click(screen.getByText('TextWidget'));
    expect(mockSelectWidget).toHaveBeenCalledWith('w1');
  });

  it('calls duplicateWidget when copy button is clicked', () => {
    setupStore();
    render(<WidgetTree />);
    const copyButtons = screen.getAllByTitle('Duplicate');
    fireEvent.click(copyButtons[0]);
    expect(mockDuplicateWidget).toHaveBeenCalledWith('screen1', 'w1');
  });

  it('calls removeWidget when delete button is clicked and confirmed', () => {
    setupStore();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<WidgetTree />);
    const deleteButtons = screen.getAllByTitle('Delete');
    fireEvent.click(deleteButtons[0]);
    expect(mockRemoveWidget).toHaveBeenCalledWith('screen1', 'w1');
    vi.restoreAllMocks();
  });

  it('does not call removeWidget when delete is cancelled', () => {
    setupStore();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<WidgetTree />);
    const deleteButtons = screen.getAllByTitle('Delete');
    fireEvent.click(deleteButtons[0]);
    expect(mockRemoveWidget).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('calls reorderWidget with "up" when move-up button is clicked', () => {
    setupStore();
    render(<WidgetTree />);
    // Second widget's "Move up" button (first widget's is disabled)
    const upButtons = screen.getAllByTitle('Move up');
    fireEvent.click(upButtons[1]);
    expect(mockReorderWidget).toHaveBeenCalledWith('screen1', 'w2', 'up');
  });

  it('calls reorderWidget with "down" when move-down button is clicked', () => {
    setupStore();
    render(<WidgetTree />);
    const downButtons = screen.getAllByTitle('Move down');
    fireEvent.click(downButtons[0]);
    expect(mockReorderWidget).toHaveBeenCalledWith('screen1', 'w1', 'down');
  });
});
