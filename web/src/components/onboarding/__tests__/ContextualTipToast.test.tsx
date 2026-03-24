/**
 * Render tests for ContextualTipToast component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ContextualTipToast } from '../ContextualTipToast';

vi.mock('lucide-react', () => ({
  Lightbulb: (props: Record<string, unknown>) => <span data-testid="lightbulb-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
}));

const baseTip = {
  id: 'tip-1',
  title: 'Pro Tip',
  message: 'You can undo actions with Ctrl+Z.',
};

describe('ContextualTipToast', () => {
  const mockOnDismiss = vi.fn();
  const mockOnAction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders tip title', () => {
    render(<ContextualTipToast tip={baseTip} onDismiss={mockOnDismiss} />);
    expect(screen.getByText('Pro Tip')).not.toBeNull();
  });

  it('renders tip message', () => {
    render(<ContextualTipToast tip={baseTip} onDismiss={mockOnDismiss} />);
    expect(screen.getByText('You can undo actions with Ctrl+Z.')).not.toBeNull();
  });

  it('renders lightbulb icon', () => {
    render(<ContextualTipToast tip={baseTip} onDismiss={mockOnDismiss} />);
    expect(screen.getByTestId('lightbulb-icon')).not.toBeNull();
  });

  it('calls onDismiss when X button clicked', () => {
    render(<ContextualTipToast tip={baseTip} onDismiss={mockOnDismiss} />);
    fireEvent.click(screen.getByTestId('x-icon'));
    expect(mockOnDismiss).toHaveBeenCalled();
  });

  it('does not render action button when no actionLabel', () => {
    render(<ContextualTipToast tip={baseTip} onDismiss={mockOnDismiss} />);
    // Verify no action label text is rendered
    expect(screen.queryByText('Try it')).toBeNull();
    // Only the dismiss button should be present
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
  });

  it('renders action button when actionLabel and onAction provided', () => {
    render(
      <ContextualTipToast
        tip={{ ...baseTip, actionLabel: 'Try it' }}
        onDismiss={mockOnDismiss}
        onAction={mockOnAction}
      />
    );
    expect(screen.getByText('Try it')).not.toBeNull();
  });

  it('calls onAction when action button clicked', () => {
    render(
      <ContextualTipToast
        tip={{ ...baseTip, actionLabel: 'Try it' }}
        onDismiss={mockOnDismiss}
        onAction={mockOnAction}
      />
    );
    fireEvent.click(screen.getByText('Try it'));
    expect(mockOnAction).toHaveBeenCalled();
  });

  it('does not render action button when actionLabel provided but no onAction', () => {
    render(
      <ContextualTipToast
        tip={{ ...baseTip, actionLabel: 'Try it' }}
        onDismiss={mockOnDismiss}
      />
    );
    expect(screen.queryByText('Try it')).toBeNull();
  });
});
