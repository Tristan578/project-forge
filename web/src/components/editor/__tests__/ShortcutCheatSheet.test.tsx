/**
 * Tests for ShortcutCheatSheet overlay component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ShortcutCheatSheet } from '../ShortcutCheatSheet';

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Search: (props: Record<string, unknown>) => <span data-testid="search-icon" {...props} />,
}));

describe('ShortcutCheatSheet', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when closed', () => {
    const { container } = render(<ShortcutCheatSheet open={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders heading when open', () => {
    render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    expect(screen.getByText('Keyboard Shortcuts').textContent).toBe('Keyboard Shortcuts');
  });

  it('renders dialog role with aria-modal', () => {
    render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('renders shortcut categories', () => {
    render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    expect(screen.getByText('General').textContent).toBe('General');
    expect(screen.getByText('Transform').textContent).toBe('Transform');
    expect(screen.getByText('Selection').textContent).toBe('Selection');
    expect(screen.getByText('View').textContent).toBe('View');
    expect(screen.getByText('Play Mode').textContent).toBe('Play Mode');
  });

  it('renders shortcut action descriptions', () => {
    render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    expect(screen.getByText('Save scene').textContent).toBe('Save scene');
    expect(screen.getByText('Undo').textContent).toBe('Undo');
    expect(screen.getByText('Translate mode').textContent).toBe('Translate mode');
    expect(screen.getByText('Toggle grid').textContent).toBe('Toggle grid');
  });

  it('renders search input', () => {
    render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    expect(screen.getByLabelText('Search shortcuts')).not.toBeNull();
  });

  it('filters shortcuts by search query', () => {
    render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    const searchInput = screen.getByLabelText('Search shortcuts');
    fireEvent.change(searchInput, { target: { value: 'undo' } });
    expect(screen.getByText('Undo').textContent).toBe('Undo');
    // "Toggle grid" should not be visible
    expect(screen.queryByText('Toggle grid')).toBeNull();
  });

  it('shows no results message when search yields nothing', () => {
    render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    const searchInput = screen.getByLabelText('Search shortcuts');
    fireEvent.change(searchInput, { target: { value: 'xyznonexistent' } });
    expect(screen.getByText(/No shortcuts match/)).not.toBeNull();
  });

  it('filters by category name', () => {
    render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    const searchInput = screen.getByLabelText('Search shortcuts');
    fireEvent.change(searchInput, { target: { value: 'play mode' } });
    expect(screen.getByText('Play / Stop game').textContent).toBe('Play / Stop game');
    // Other categories should not appear
    expect(screen.queryByText('Save scene')).toBeNull();
  });

  it('filters by key combo', () => {
    render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    const searchInput = screen.getByLabelText('Search shortcuts');
    fireEvent.change(searchInput, { target: { value: 'ctrl' } });
    // All ctrl shortcuts should be visible
    expect(screen.getByText('Save scene').textContent).toBe('Save scene');
    expect(screen.getByText('Undo').textContent).toBe('Undo');
    // Non-ctrl shortcuts should not be visible
    expect(screen.queryByText('Translate mode')).toBeNull();
  });

  it('calls onClose when close button clicked', () => {
    render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByLabelText('Close cheat sheet'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop clicked', () => {
    render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    const backdrop = screen.getByTestId('cheatsheet-backdrop');
    fireEvent.click(backdrop);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when dialog body is clicked', () => {
    render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('calls onClose on Escape key', () => {
    render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('does not activate when typing in the search input', () => {
    render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    const searchInput = screen.getByLabelText('Search shortcuts');
    // Typing ? in the search input should update the value, not toggle the overlay
    fireEvent.change(searchInput, { target: { value: '?' } });
    expect(searchInput).toHaveProperty('value', '?');
    // The overlay is still open (onClose not called from typing)
    expect(screen.getByRole('dialog')).not.toBeNull();
  });

  it('resets search when reopened', () => {
    const { rerender } = render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    const searchInput = screen.getByLabelText('Search shortcuts');
    fireEvent.change(searchInput, { target: { value: 'undo' } });
    expect(searchInput).toHaveProperty('value', 'undo');

    // Close
    rerender(<ShortcutCheatSheet open={false} onClose={mockOnClose} />);

    // Reopen
    rerender(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    const newSearchInput = screen.getByLabelText('Search shortcuts');
    expect(newSearchInput).toHaveProperty('value', '');
  });

  it('renders footer hint text', () => {
    render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    expect(screen.getByText(/to toggle this overlay/)).not.toBeNull();
  });

  it('renders key badges with kbd elements', () => {
    render(<ShortcutCheatSheet open={true} onClose={mockOnClose} />);
    const kbdElements = document.querySelectorAll('kbd');
    // Should have many kbd elements for all the shortcuts
    expect(kbdElements.length).toBeGreaterThan(10);
  });
});
