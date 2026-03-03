import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { DrawerPanel } from '../DrawerPanel';

describe('DrawerPanel', () => {
  const defaultProps = {
    side: 'right' as const,
    open: true,
    onClose: vi.fn(),
    children: <div data-testid="drawer-content">Content</div>,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders children and backdrop when open', () => {
    const { container } = render(<DrawerPanel {...defaultProps} />);
    
    // Backdrop should exist
    const backdrop = container.querySelector('.fixed.inset-0.bg-black\\/50');
    expect(backdrop).not.toBeNull();
    
    // Content should exist
    expect(screen.getByTestId('drawer-content')).toBeDefined();
  });

  it('hides backdrop and translates off-screen when closed', () => {
    const { container } = render(<DrawerPanel {...defaultProps} open={false} />);
    
    // Backdrop should not exist
    const backdrop = container.querySelector('.fixed.inset-0.bg-black\\/50');
    expect(backdrop).toBeNull();
    
    // Drawer should have translate-x-full since it's on the right
    const drawer = screen.getByRole('dialog', { hidden: true });
    expect(drawer.className).toContain('translate-x-full');
  });

  it('calls onClose when backdrop is clicked', () => {
    const { container } = render(<DrawerPanel {...defaultProps} />);
    
    const backdrop = container.querySelector('.fixed.inset-0.bg-black\\/50');
    if (backdrop) {
      fireEvent.click(backdrop);
    }
    
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', () => {
    render(<DrawerPanel {...defaultProps} />);
    
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
