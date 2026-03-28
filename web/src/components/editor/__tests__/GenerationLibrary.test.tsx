/**
 * Render tests for GenerationLibrary component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GenerationLibrary } from '../GenerationLibrary';
import { useGenerationHistoryStore } from '@/stores/generationHistoryStore';

vi.mock('@/stores/generationHistoryStore', () => ({
  useGenerationHistoryStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  Search: (props: Record<string, unknown>) => <span data-testid="search-icon" {...props} />,
  Trash2: (props: Record<string, unknown>) => <span data-testid="trash-icon" {...props} />,
  RotateCcw: (props: Record<string, unknown>) => <span data-testid="rotate-ccw-icon" {...props} />,
  Download: (props: Record<string, unknown>) => <span data-testid="download-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Clock: (props: Record<string, unknown>) => <span data-testid="clock-icon" {...props} />,
  Sparkles: (props: Record<string, unknown>) => <span data-testid="sparkles-icon" {...props} />,
}));

const sampleEntry = {
  id: 'entry-1',
  type: 'texture' as const,
  prompt: 'Mossy stone wall',
  provider: 'meshy',
  createdAt: Date.now() - 120_000, // 2 minutes ago
  resultUrl: 'https://example.com/result.png',
  status: 'completed' as const,
};

describe('GenerationLibrary', () => {
  const mockOnClose = vi.fn();
  const _mockOnRegenerate = vi.fn();
  const mockSetSearchQuery = vi.fn();
  const mockSetFilterType = vi.fn();
  const mockRemoveEntry = vi.fn();
  const mockClearAll = vi.fn();

  function setupStore({
    entries = [] as typeof sampleEntry[],
    allEntries = [] as typeof sampleEntry[],
    searchQuery = '',
    filterType = 'all' as string,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useGenerationHistoryStore).mockImplementation((selector: any) => {
      const state = {
        filteredEntries: () => entries,
        entries: allEntries,
        searchQuery,
        filterType,
        setSearchQuery: mockSetSearchQuery,
        setFilterType: mockSetFilterType,
        removeEntry: mockRemoveEntry,
        clearAll: mockClearAll,
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

  it('renders Generation Library heading', () => {
    render(<GenerationLibrary onClose={mockOnClose} />);
    expect(screen.getByText('Generation Library')).toBeInTheDocument();
  });

  it('renders search input', () => {
    render(<GenerationLibrary onClose={mockOnClose} />);
    expect(screen.getByPlaceholderText('Search prompts...')).toBeInTheDocument();
  });

  it('renders All filter chip', () => {
    render(<GenerationLibrary onClose={mockOnClose} />);
    expect(screen.getByText('All')).toBeInTheDocument();
  });

  it('renders type filter chips', () => {
    render(<GenerationLibrary onClose={mockOnClose} />);
    expect(screen.getByText('3D Model')).toBeInTheDocument();
    expect(screen.getByText('Texture')).toBeInTheDocument();
    expect(screen.getByText('Sound FX')).toBeInTheDocument();
  });

  it('shows empty state when no entries', () => {
    render(<GenerationLibrary onClose={mockOnClose} />);
    expect(screen.getByText('No generations yet. Generated assets will appear here.')).toBeInTheDocument();
  });

  it('shows "No results match your search" when filtered empty', () => {
    setupStore({ entries: [], allEntries: [sampleEntry] });
    render(<GenerationLibrary onClose={mockOnClose} />);
    expect(screen.getByText('No results match your search.')).toBeInTheDocument();
  });

  it('renders entry prompt text when entries exist', () => {
    setupStore({ entries: [sampleEntry], allEntries: [sampleEntry] });
    render(<GenerationLibrary onClose={mockOnClose} />);
    expect(screen.getByText('Mossy stone wall')).toBeInTheDocument();
  });

  it('renders type badge for entry', () => {
    setupStore({ entries: [sampleEntry], allEntries: [sampleEntry] });
    render(<GenerationLibrary onClose={mockOnClose} />);
    // "Texture" appears as both a filter chip and an entry badge
    expect(screen.getAllByText('Texture').length).toBeGreaterThanOrEqual(2);
  });

  it('shows entry count in header', () => {
    setupStore({ entries: [sampleEntry], allEntries: [sampleEntry] });
    render(<GenerationLibrary onClose={mockOnClose} />);
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('calls setSearchQuery when search input changes', () => {
    render(<GenerationLibrary onClose={mockOnClose} />);
    const input = screen.getByPlaceholderText('Search prompts...');
    fireEvent.change(input, { target: { value: 'stone' } });
    expect(mockSetSearchQuery).toHaveBeenCalledWith('stone');
  });

  it('calls setFilterType when a filter chip clicked', () => {
    render(<GenerationLibrary onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('3D Model'));
    expect(mockSetFilterType).toHaveBeenCalledWith('model');
  });

  it('calls onClose when close button clicked', () => {
    render(<GenerationLibrary onClose={mockOnClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows Clear history button when entries exist', () => {
    setupStore({ entries: [sampleEntry], allEntries: [sampleEntry] });
    render(<GenerationLibrary onClose={mockOnClose} />);
    expect(screen.getByText('Clear history')).toBeInTheDocument();
  });

  it('shows confirm dialog when Clear history clicked', () => {
    setupStore({ entries: [sampleEntry], allEntries: [sampleEntry] });
    render(<GenerationLibrary onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Clear history'));
    expect(screen.getByText('Clear all history?')).toBeInTheDocument();
  });

  it('calls clearAll when Confirm clicked', () => {
    setupStore({ entries: [sampleEntry], allEntries: [sampleEntry] });
    render(<GenerationLibrary onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Clear history'));
    fireEvent.click(screen.getByText('Confirm'));
    expect(mockClearAll).toHaveBeenCalled();
  });

  it('does not show Clear history when no entries', () => {
    render(<GenerationLibrary onClose={mockOnClose} />);
    expect(screen.queryByText('Clear history')).toBeNull();
  });
});
