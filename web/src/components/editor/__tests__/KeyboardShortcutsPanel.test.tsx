/**
 * Render tests for KeyboardShortcutsPanel component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { KeyboardShortcutsPanel } from '../KeyboardShortcutsPanel';

vi.mock('@/lib/workspace/keybindings', () => ({
  getMergedBindings: vi.fn(() => [
    { action: 'undo', label: 'Undo', defaultKey: 'Ctrl+Z', customKey: null, category: 'Edit' },
    { action: 'redo', label: 'Redo', defaultKey: 'Ctrl+Y', customKey: null, category: 'Edit' },
    { action: 'delete', label: 'Delete', defaultKey: 'Delete', customKey: null, category: 'Selection' },
  ]),
  getEffectiveKey: vi.fn((binding) => binding.customKey ?? binding.defaultKey),
  groupByCategory: vi.fn((bindings) => {
    const grouped: Record<string, typeof bindings> = {};
    for (const b of bindings) {
      if (!grouped[b.category]) grouped[b.category] = [];
      grouped[b.category].push(b);
    }
    return grouped;
  }),
  eventToKeyCombo: vi.fn(() => 'Ctrl+S'),
  saveCustomBinding: vi.fn(),
  resetBinding: vi.fn(),
  resetAllBindings: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  RotateCcw: (props: Record<string, unknown>) => <span data-testid="rotate-ccw-icon" {...props} />,
}));

describe('KeyboardShortcutsPanel', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when closed', () => {
    const { container } = render(<KeyboardShortcutsPanel open={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Keyboard Shortcuts heading when open', () => {
    render(<KeyboardShortcutsPanel open={true} onClose={mockOnClose} />);
    expect(screen.getByText('Keyboard Shortcuts')).toBeDefined();
  });

  it('renders dialog role', () => {
    render(<KeyboardShortcutsPanel open={true} onClose={mockOnClose} />);
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('renders mouse shortcut categories section', () => {
    render(<KeyboardShortcutsPanel open={true} onClose={mockOnClose} />);
    expect(screen.getByText('Mouse')).toBeDefined();
    expect(screen.getByText('Select entity')).toBeDefined();
  });

  it('renders binding labels from grouped categories', () => {
    render(<KeyboardShortcutsPanel open={true} onClose={mockOnClose} />);
    expect(screen.getByText('Undo')).toBeDefined();
    expect(screen.getByText('Redo')).toBeDefined();
    // "Delete" appears as both label and key badge — check label exists via aria
    expect(screen.getByLabelText(/Rebind Delete/)).toBeDefined();
  });

  it('renders keyboard shortcut key badges', () => {
    render(<KeyboardShortcutsPanel open={true} onClose={mockOnClose} />);
    expect(screen.getByText('Ctrl+Z')).toBeDefined();
    expect(screen.getByText('Ctrl+Y')).toBeDefined();
  });

  it('renders category headings', () => {
    render(<KeyboardShortcutsPanel open={true} onClose={mockOnClose} />);
    expect(screen.getByText('Edit')).toBeDefined();
    expect(screen.getByText('Selection')).toBeDefined();
  });

  it('renders Reset All button', () => {
    render(<KeyboardShortcutsPanel open={true} onClose={mockOnClose} />);
    expect(screen.getByText('Reset All')).toBeDefined();
  });

  it('renders Close button with aria-label', () => {
    render(<KeyboardShortcutsPanel open={true} onClose={mockOnClose} />);
    expect(screen.getByLabelText('Close keyboard shortcuts')).toBeDefined();
  });

  it('calls onClose when close button clicked', () => {
    render(<KeyboardShortcutsPanel open={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByLabelText('Close keyboard shortcuts'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop clicked', () => {
    render(<KeyboardShortcutsPanel open={true} onClose={mockOnClose} />);
    // The backdrop is the outer fixed div with onClick={onClose}
    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.click(backdrop);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('enters editing mode when a binding button is clicked', () => {
    render(<KeyboardShortcutsPanel open={true} onClose={mockOnClose} />);
    const rebindButton = screen.getByLabelText(/Rebind Undo/);
    fireEvent.click(rebindButton);
    expect(screen.getByText('Press key...')).toBeDefined();
  });

  it('shows footer hint text', () => {
    render(<KeyboardShortcutsPanel open={true} onClose={mockOnClose} />);
    expect(screen.getByText(/Click any shortcut to rebind it/)).toBeDefined();
  });
});
