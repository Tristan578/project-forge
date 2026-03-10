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
    expect(screen.getByText('Pro Tip')).toBeDefined();
  });

  it('renders tip message', () => {
    render(<ContextualTipToast tip={baseTip} onDismiss={mockOnDismiss} />);
    expect(screen.getByText('You can undo actions with Ctrl+Z.')).toBeDefined();
  });

  it('renders lightbulb icon', () => {
    render(<ContextualTipToast tip={baseTip} onDismiss={mockOnDismiss} />);
    expect(screen.getByTestId('lightbulb-icon')).toBeDefined();
  });

  it('calls onDismiss when X button clicked', () => {
    render(<ContextualTipToast tip={baseTip} onDismiss={mockOnDismiss} />);
    fireEvent.click(screen.getByTestId('x-icon'));
    expect(mockOnDismiss).toHaveBeenCalled();
  });

  it('does not render action button when no actionLabel', () => {
    render(<ContextualTipToast tip={baseTip} onDismiss={mockOnDismiss} />);
    expect(screen.queryByRole('button', { name: undefined })).toBeDefined();
    // No action button should appear
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1); // only dismiss button
  });

  it('renders action button when actionLabel and onAction provided', () => {
    render(
      <ContextualTipToast
        tip={{ ...baseTip, actionLabel: 'Try it' }}
        onDismiss={mockOnDismiss}
        onAction={mockOnAction}
      />
    );
    expect(screen.getByText('Try it')).toBeDefined();
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
