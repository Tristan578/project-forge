import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ContextMenu } from '../ContextMenu';

describe('ContextMenu', () => {
  beforeEach(() => vi.clearAllMocks());

  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    isOpen: true,
    position: { x: 100, y: 200 },
    onClose: vi.fn(),
    onRename: vi.fn(),
    onFocus: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
  };

  it('renders at specified coordinates', () => {
    render(<ContextMenu {...defaultProps} />);
    const menu = screen.getByRole('menu');
    expect(menu.style.left).toBe('100px');
    expect(menu.style.top).toBe('200px');
  });

  it('renders all standard options', () => {
    render(<ContextMenu {...defaultProps} />);
    expect(screen.getAllByText('Rename').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Focus').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Duplicate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Delete').length).toBeGreaterThan(0);
  });

  it('calls action and onClose when enabled option is clicked', () => {
    render(<ContextMenu {...defaultProps} />);
    const buttons = screen.getAllByText('Focus');
    fireEvent.click(buttons[0]);
    
    expect(defaultProps.onFocus).toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('handles multi-selection labels and disables rename', () => {
    render(<ContextMenu {...defaultProps} selectionCount={3} />);
    expect(screen.getAllByText('Duplicate 3 entities').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Delete 3 entities').length).toBeGreaterThan(0);
    
    // Rename should be disabled
    const renameButton = screen.getAllByText('Rename')[0].closest('button') as HTMLButtonElement;
    expect(renameButton.disabled).toBe(true);
  });

  it('closes when clicking outside', () => {
    render(
      <div data-testid="outside">
        <ContextMenu {...defaultProps} />
      </div>
    );
    fireEvent.mouseDown(screen.getByTestId('outside'));
    
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
