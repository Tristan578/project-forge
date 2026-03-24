/**
 * Render tests for FeedbackDialog component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import { FeedbackDialog } from '../FeedbackDialog';

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Bug: (props: Record<string, unknown>) => <span data-testid="bug-icon" {...props} />,
  Lightbulb: (props: Record<string, unknown>) => <span data-testid="lightbulb-icon" {...props} />,
  MessageSquare: (props: Record<string, unknown>) => <span data-testid="message-icon" {...props} />,
  Send: (props: Record<string, unknown>) => <span data-testid="send-icon" {...props} />,
  CheckCircle: (props: Record<string, unknown>) => <span data-testid="check-icon" {...props} />,
}));

describe('FeedbackDialog', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<FeedbackDialog open={false} onClose={mockOnClose} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog when open', () => {
    render(<FeedbackDialog open={true} onClose={mockOnClose} />);
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.getByText('Send Feedback')).not.toBeNull();
  });

  it('has correct ARIA attributes', () => {
    render(<FeedbackDialog open={true} onClose={mockOnClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('feedback-dialog-title');
  });

  it('renders all three feedback type buttons', () => {
    render(<FeedbackDialog open={true} onClose={mockOnClose} />);
    expect(screen.getByText('Bug Report')).not.toBeNull();
    expect(screen.getByText('Feature Request')).not.toBeNull();
    expect(screen.getByText('General Feedback')).not.toBeNull();
  });

  it('renders close button with aria-label', () => {
    render(<FeedbackDialog open={true} onClose={mockOnClose} />);
    const closeBtn = screen.getByRole('button', { name: /close feedback dialog/i });
    expect(closeBtn).toBeDefined();
  });

  it('calls onClose when close button is clicked', () => {
    render(<FeedbackDialog open={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close feedback dialog/i }));
    expect(mockOnClose).toHaveBeenCalledOnce();
  });

  it('renders textarea with aria-label', () => {
    render(<FeedbackDialog open={true} onClose={mockOnClose} />);
    const textarea = screen.getByRole('textbox', { name: /feedback description/i });
    expect(textarea).toBeDefined();
  });

  it('disables submit when description is too short', () => {
    render(<FeedbackDialog open={true} onClose={mockOnClose} />);
    const submitBtn = screen.getByRole('button', { name: /submit feedback/i });
    expect(submitBtn.hasAttribute('disabled')).toBe(true);
  });

  it('enables submit when description has >= 10 characters', () => {
    render(<FeedbackDialog open={true} onClose={mockOnClose} />);
    const textarea = screen.getByRole('textbox', { name: /feedback description/i });
    fireEvent.change(textarea, { target: { value: 'This is sufficient feedback text' } });

    const submitBtn = screen.getByRole('button', { name: /submit feedback/i });
    expect(submitBtn.hasAttribute('disabled')).toBe(false);
  });

  it('shows validation error when submitting short feedback', () => {
    render(<FeedbackDialog open={true} onClose={mockOnClose} />);
    const textarea = screen.getByRole('textbox', { name: /feedback description/i });
    fireEvent.change(textarea, { target: { value: 'short' } });

    // Force enable and click (by filling 10+ then removing)
    fireEvent.change(textarea, { target: { value: '1234567890' } });
    fireEvent.change(textarea, { target: { value: 'short' } });

    // Submit is disabled but let's verify the minimum warning appears
    expect(screen.getByText('Minimum 10 characters')).not.toBeNull();
  });

  it('submits feedback successfully and shows confirmation', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<FeedbackDialog open={true} onClose={mockOnClose} />);
    const textarea = screen.getByRole('textbox', { name: /feedback description/i });
    fireEvent.change(textarea, { target: { value: 'This is a detailed bug report for testing.' } });

    // Select bug type
    fireEvent.click(screen.getByText('Bug Report'));

    // Submit
    const submitBtn = screen.getByRole('button', { name: /submit feedback/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Thanks for your feedback!')).not.toBeNull();
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/feedback', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('shows error message on submission failure', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });

    render(<FeedbackDialog open={true} onClose={mockOnClose} />);
    const textarea = screen.getByRole('textbox', { name: /feedback description/i });
    fireEvent.change(textarea, { target: { value: 'This is a detailed feedback for testing.' } });

    fireEvent.click(screen.getByRole('button', { name: /submit feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).not.toBeNull();
      expect(screen.getByText('Server error')).not.toBeNull();
    });
  });

  it('displays character count', () => {
    render(<FeedbackDialog open={true} onClose={mockOnClose} />);
    expect(screen.getByText('0/5000')).not.toBeNull();

    const textarea = screen.getByRole('textbox', { name: /feedback description/i });
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    expect(screen.getByText('5/5000')).not.toBeNull();
  });
});
