/**
 * Render and interaction tests for the Celebration component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@/test/utils/componentTestUtils';
import { Celebration } from '../Celebration';

vi.mock('lucide-react', () => ({
  X: ({ size: _size, ...props }: { size?: number } & Record<string, unknown>) => (
    <span data-testid="x-icon" {...props} />
  ),
}));

describe('Celebration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('renders the title and message', () => {
    const onDismiss = vi.fn();
    render(<Celebration title="First entity!" message="You added your first object." onDismiss={onDismiss} />);

    expect(screen.getByText('First entity!')).not.toBeNull();
    expect(screen.getByText('You added your first object.')).not.toBeNull();
  });

  it('renders a dismiss button with accessible label', () => {
    const onDismiss = vi.fn();
    render(<Celebration title="Milestone" message="Great work." onDismiss={onDismiss} />);

    const btn = screen.getByRole('button', { name: /dismiss/i });
    expect(btn).toBeDefined();
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<Celebration title="Milestone" message="Great work." onDismiss={onDismiss} />);

    const btn = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss on Escape key', () => {
    const onDismiss = vi.fn();
    render(<Celebration title="Milestone" message="Great work." onDismiss={onDismiss} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not call onDismiss on other keys', () => {
    const onDismiss = vi.fn();
    render(<Celebration title="Milestone" message="Great work." onDismiss={onDismiss} />);

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('auto-dismisses after 5 seconds', () => {
    const onDismiss = vi.fn();
    render(<Celebration title="Milestone" message="Great work." onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not auto-dismiss before 5 seconds', () => {
    const onDismiss = vi.fn();
    render(<Celebration title="Milestone" message="Great work." onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(4999);
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('has role="dialog" and aria-modal="true"', () => {
    const onDismiss = vi.fn();
    render(<Celebration title="Milestone" message="Great work." onDismiss={onDismiss} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('has aria-label matching the title', () => {
    const onDismiss = vi.fn();
    render(<Celebration title="Unique Title XYZ" message="Some message." onDismiss={onDismiss} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Unique Title XYZ');
  });

  it('cleans up the auto-dismiss timer when unmounted', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<Celebration title="Milestone" message="Great work." onDismiss={onDismiss} />);

    unmount();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // onDismiss should NOT be called after unmount since timer was cleared
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
