/**
 * Render tests for NodePalette component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { NodePalette } from '../NodePalette';

vi.mock('@/lib/scripting/nodeDefinitions', () => ({
  NODE_CATEGORIES: [
    {
      category: 'events',
      label: 'Events',
      nodes: [
        { type: 'on_start', label: 'On Start', description: 'Runs when game starts', color: '#ff0' },
        { type: 'on_update', label: 'On Update', description: 'Runs every frame', color: '#ff0' },
      ],
    },
    {
      category: 'actions',
      label: 'Actions',
      nodes: [
        { type: 'move_entity', label: 'Move Entity', description: 'Moves an entity', color: '#0ff' },
      ],
    },
  ],
}));

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Search: (props: Record<string, unknown>) => <span data-testid="search-icon" {...props} />,
}));

describe('NodePalette', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Node Palette heading', () => {
    render(<NodePalette onClose={mockOnClose} />);
    expect(screen.getByText('Node Palette')).not.toBeNull();
  });

  it('renders category labels', () => {
    render(<NodePalette onClose={mockOnClose} />);
    expect(screen.getByText('Events')).not.toBeNull();
    expect(screen.getByText('Actions')).not.toBeNull();
  });

  it('shows events nodes expanded by default', () => {
    render(<NodePalette onClose={mockOnClose} />);
    expect(screen.getByText('On Start')).not.toBeNull();
    expect(screen.getByText('On Update')).not.toBeNull();
  });

  it('does not show actions nodes when Actions is collapsed', () => {
    render(<NodePalette onClose={mockOnClose} />);
    // Actions category is not expanded by default
    expect(screen.queryByText('Move Entity')).toBeNull();
  });

  it('expands Actions category when clicked', () => {
    render(<NodePalette onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Actions'));
    expect(screen.getByText('Move Entity')).not.toBeNull();
  });

  it('renders search input', () => {
    render(<NodePalette onClose={mockOnClose} />);
    expect(screen.getByPlaceholderText('Search nodes...')).not.toBeNull();
  });

  it('filters nodes on search', () => {
    render(<NodePalette onClose={mockOnClose} />);
    const input = screen.getByPlaceholderText('Search nodes...');
    fireEvent.change(input, { target: { value: 'Move' } });
    expect(screen.getByText('Move Entity')).not.toBeNull();
    expect(screen.queryByText('On Start')).toBeNull();
  });

  it('calls onClose when X is clicked', () => {
    render(<NodePalette onClose={mockOnClose} />);
    fireEvent.click(screen.getByTestId('x-icon').closest('button')!);
    expect(mockOnClose).toHaveBeenCalled();
  });
});
