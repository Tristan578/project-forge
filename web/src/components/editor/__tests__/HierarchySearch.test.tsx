/**
 * Render tests for HierarchySearch component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { HierarchySearch } from '../HierarchySearch';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  Search: (props: Record<string, unknown>) => <span data-testid="search-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
}));

vi.mock('@/lib/hierarchyFilter', () => ({
  escapeRegExp: (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
}));

describe('HierarchySearch', () => {
  const mockSetHierarchyFilter = vi.fn();
  const mockClearHierarchyFilter = vi.fn();

  function setupStore(hierarchyFilter = '') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        hierarchyFilter,
        setHierarchyFilter: mockSetHierarchyFilter,
        clearHierarchyFilter: mockClearHierarchyFilter,
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

  it('renders search input with placeholder', () => {
    setupStore();
    render(<HierarchySearch />);
    expect(screen.getByPlaceholderText('Search entities...')).toBeDefined();
  });

  it('shows search icon', () => {
    setupStore();
    render(<HierarchySearch />);
    expect(screen.getByTestId('search-icon')).toBeDefined();
  });

  it('does not show clear button when input is empty', () => {
    setupStore();
    render(<HierarchySearch />);
    expect(screen.queryByTestId('x-icon')).toBeNull();
  });

  it('shows clear button when input has value', () => {
    setupStore('cube');
    render(<HierarchySearch />);
    expect(screen.getByTestId('x-icon')).toBeDefined();
  });

  it('shows match count when matchCount provided and input has value', () => {
    setupStore('cube');
    render(<HierarchySearch matchCount={3} />);
    expect(screen.getByText('3')).toBeDefined();
  });

  it('does not show match count when input is empty', () => {
    setupStore('');
    render(<HierarchySearch matchCount={3} />);
    expect(screen.queryByText('3')).toBeNull();
  });

  it('calls clearHierarchyFilter when X button is clicked', () => {
    setupStore('cube');
    render(<HierarchySearch />);
    fireEvent.click(screen.getByTestId('x-icon').closest('button')!);
    expect(mockClearHierarchyFilter).toHaveBeenCalled();
  });

  it('calls clearHierarchyFilter when Escape key pressed', () => {
    setupStore('cube');
    render(<HierarchySearch />);
    const input = screen.getByPlaceholderText('Search entities...');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(mockClearHierarchyFilter).toHaveBeenCalled();
  });

  it('has aria-label for accessibility', () => {
    setupStore();
    render(<HierarchySearch />);
    expect(screen.getByLabelText('Search entities')).toBeDefined();
  });
});
