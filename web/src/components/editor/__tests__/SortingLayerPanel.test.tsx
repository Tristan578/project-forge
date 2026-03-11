/**
 * Render tests for SortingLayerPanel component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { SortingLayerPanel } from '../SortingLayerPanel';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  Eye: (props: Record<string, unknown>) => <span data-testid="eye-icon" {...props} />,
  EyeOff: (props: Record<string, unknown>) => <span data-testid="eye-off-icon" {...props} />,
  Trash2: (props: Record<string, unknown>) => <span data-testid="trash-icon" {...props} />,
  Plus: (props: Record<string, unknown>) => <span data-testid="plus-icon" {...props} />,
}));

const defaultLayers = [
  { name: 'Background', order: 0, visible: true },
  { name: 'Default', order: 1, visible: true },
  { name: 'Foreground', order: 2, visible: true },
  { name: 'UI', order: 3, visible: true },
];

describe('SortingLayerPanel', () => {
  const mockToggleLayerVisibility = vi.fn();
  const mockRemoveSortingLayer = vi.fn();
  const mockAddSortingLayer = vi.fn();

  function setupStore({
    sortingLayers = defaultLayers,
    sprites = {} as Record<string, { sortingLayer: string }>,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        sortingLayers,
        sprites,
        toggleLayerVisibility: mockToggleLayerVisibility,
        removeSortingLayer: mockRemoveSortingLayer,
        addSortingLayer: mockAddSortingLayer,
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

  it('renders Sorting Layers heading', () => {
    setupStore();
    render(<SortingLayerPanel />);
    expect(screen.getByText('Sorting Layers')).toBeDefined();
  });

  it('renders default layer names', () => {
    setupStore();
    render(<SortingLayerPanel />);
    expect(screen.getByText('Background')).toBeDefined();
    expect(screen.getByText('Default')).toBeDefined();
    expect(screen.getByText('Foreground')).toBeDefined();
    expect(screen.getByText('UI')).toBeDefined();
  });

  it('renders new layer input', () => {
    setupStore();
    render(<SortingLayerPanel />);
    expect(screen.getByPlaceholderText('New layer name')).toBeDefined();
  });

  it('renders Add button', () => {
    setupStore();
    render(<SortingLayerPanel />);
    expect(screen.getByText('Add')).toBeDefined();
  });

  it('calls addSortingLayer when Add is clicked with layer name', () => {
    setupStore();
    render(<SortingLayerPanel />);
    const input = screen.getByPlaceholderText('New layer name');
    fireEvent.change(input, { target: { value: 'Effects' } });
    fireEvent.click(screen.getByText('Add'));
    expect(mockAddSortingLayer).toHaveBeenCalledWith('Effects');
  });

  it('adds layer on Enter key', () => {
    setupStore();
    render(<SortingLayerPanel />);
    const input = screen.getByPlaceholderText('New layer name');
    fireEvent.change(input, { target: { value: 'Special' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockAddSortingLayer).toHaveBeenCalledWith('Special');
  });

  it('does not call addSortingLayer for empty input', () => {
    setupStore();
    render(<SortingLayerPanel />);
    fireEvent.click(screen.getByText('Add'));
    expect(mockAddSortingLayer).not.toHaveBeenCalled();
  });

  it('calls toggleLayerVisibility when eye button is clicked', () => {
    setupStore();
    render(<SortingLayerPanel />);
    const eyeButtons = screen.getAllByTitle('Hide layer');
    fireEvent.click(eyeButtons[0]);
    expect(mockToggleLayerVisibility).toHaveBeenCalled();
  });

  it('does not show delete button for default layers', () => {
    setupStore();
    render(<SortingLayerPanel />);
    // Default layers have no delete button, so no trash icons
    expect(screen.queryByTitle('Delete layer')).toBeNull();
  });

  it('shows delete button for custom layers', () => {
    setupStore({
      sortingLayers: [
        ...defaultLayers,
        { name: 'CustomLayer', order: 4, visible: true },
      ],
    });
    render(<SortingLayerPanel />);
    expect(screen.getByTitle('Delete layer')).toBeDefined();
  });

  it('calls removeSortingLayer when delete button is clicked on custom layer', () => {
    setupStore({
      sortingLayers: [
        ...defaultLayers,
        { name: 'Effects', order: 4, visible: true },
      ],
    });
    render(<SortingLayerPanel />);
    fireEvent.click(screen.getByTitle('Delete layer'));
    expect(mockRemoveSortingLayer).toHaveBeenCalledWith('Effects');
  });

  it('shows sprite count badge when layer has sprites', () => {
    setupStore({
      sprites: {
        s1: { sortingLayer: 'Default' },
        s2: { sortingLayer: 'Default' },
      },
    });
    render(<SortingLayerPanel />);
    expect(screen.getByText('2')).toBeDefined();
  });
});
