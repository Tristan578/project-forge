/**
 * Render tests for UpgradePrompt component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { UpgradePrompt } from '../UpgradePrompt';

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Zap: (props: Record<string, unknown>) => <span data-testid="zap-icon" {...props} />,
}));

describe('UpgradePrompt', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Upgrade Required heading', () => {
    render(<UpgradePrompt feature="AI Chat" requiredTier="creator" onClose={mockOnClose} />);
    expect(screen.getByText('Upgrade Required')).not.toBeNull();
  });

  it('renders the feature name', () => {
    render(<UpgradePrompt feature="AI Chat" requiredTier="creator" onClose={mockOnClose} />);
    expect(screen.getByText('AI Chat')).not.toBeNull();
  });

  it('renders the required tier', () => {
    render(<UpgradePrompt feature="AI Chat" requiredTier="creator" onClose={mockOnClose} />);
    expect(screen.getByText('creator')).not.toBeNull();
  });

  it('renders View Plans link pointing to /pricing', () => {
    render(<UpgradePrompt feature="AI Chat" requiredTier="creator" onClose={mockOnClose} />);
    const link = screen.getByText('View Plans');
    expect(link.getAttribute('href')).toBe('/pricing');
  });

  it('renders Maybe Later button', () => {
    render(<UpgradePrompt feature="AI Chat" requiredTier="creator" onClose={mockOnClose} />);
    expect(screen.getByText('Maybe Later')).not.toBeNull();
  });

  it('calls onClose when Maybe Later clicked', () => {
    render(<UpgradePrompt feature="AI Chat" requiredTier="creator" onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Maybe Later'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when X button clicked', () => {
    render(<UpgradePrompt feature="AI Chat" requiredTier="creator" onClose={mockOnClose} />);
    fireEvent.click(screen.getByTestId('x-icon'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('renders zap icon', () => {
    render(<UpgradePrompt feature="AI Chat" requiredTier="creator" onClose={mockOnClose} />);
    expect(screen.getByTestId('zap-icon')).not.toBeNull();
  });
});
