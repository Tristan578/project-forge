import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { DrawerPanel } from '../DrawerPanel';

const mockTrackPanelOpened = vi.fn();
const mockTrackPanelClosed = vi.fn();

vi.mock('@/lib/analytics/panelTracking', () => ({
  trackPanelOpened: mockTrackPanelOpened,
  trackPanelClosed: mockTrackPanelClosed,
  trackCommandDispatched: vi.fn(),
  trackGenerationStarted: vi.fn(),
  trackGenerationCompleted: vi.fn(),
  trackGamePublished: vi.fn(),
}));

describe('DrawerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    side: 'right' as const,
    open: true,
    onClose: vi.fn(),
    children: <div data-testid="drawer-content">Content</div>,
  };

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

  // ---------------------------------------------------------------------------
  // Analytics tracking
  // ---------------------------------------------------------------------------

  describe('panel open/close analytics', () => {
    it('calls trackPanelOpened with "inspector" when right panel opens', () => {
      render(<DrawerPanel {...defaultProps} side="right" open={true} />);
      expect(mockTrackPanelOpened).toHaveBeenCalledWith('inspector');
    });

    it('calls trackPanelOpened with "scene-hierarchy" when left panel opens', () => {
      render(<DrawerPanel {...defaultProps} side="left" open={true} />);
      expect(mockTrackPanelOpened).toHaveBeenCalledWith('scene-hierarchy');
    });

    it('does not call trackPanelOpened when initially closed', () => {
      render(<DrawerPanel {...defaultProps} open={false} />);
      expect(mockTrackPanelOpened).not.toHaveBeenCalled();
    });

    it('calls trackPanelClosed with panelId and a non-negative durationMs when panel closes', () => {
      const { rerender } = render(<DrawerPanel {...defaultProps} side="right" open={true} />);
      vi.clearAllMocks(); // reset after open tracking
      rerender(<DrawerPanel {...defaultProps} side="right" open={false} />);
      expect(mockTrackPanelClosed).toHaveBeenCalledOnce();
      const [panelId, durationMs] = mockTrackPanelClosed.mock.calls[0] as [string, number];
      expect(panelId).toBe('inspector');
      expect(durationMs).toBeGreaterThanOrEqual(0);
    });

    it('does not call trackPanelClosed if panel was never opened', () => {
      const { rerender } = render(<DrawerPanel {...defaultProps} open={false} />);
      rerender(<DrawerPanel {...defaultProps} open={false} />);
      expect(mockTrackPanelClosed).not.toHaveBeenCalled();
    });

    it('tracks open again after close-then-reopen cycle', () => {
      const { rerender } = render(<DrawerPanel {...defaultProps} side="left" open={true} />);
      expect(mockTrackPanelOpened).toHaveBeenCalledTimes(1);
      rerender(<DrawerPanel {...defaultProps} side="left" open={false} />);
      expect(mockTrackPanelClosed).toHaveBeenCalledTimes(1);
      vi.clearAllMocks();
      rerender(<DrawerPanel {...defaultProps} side="left" open={true} />);
      expect(mockTrackPanelOpened).toHaveBeenCalledTimes(1);
    });
  });
});
