import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useDialogA11y } from '../useDialogA11y';

// Test component that wires up the hook
function TestDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { dialogProps, titleProps } = useDialogA11y({
    title: 'Test Dialog',
    isOpen,
    onClose,
  });

  if (!isOpen) return null;

  return (
    <div {...dialogProps} tabIndex={-1} data-testid="dialog">
      <h2 {...titleProps}>Test Dialog</h2>
      <button data-testid="btn-first">First</button>
      <button data-testid="btn-second">Second</button>
      <button data-testid="btn-last">Last</button>
    </div>
  );
}

function TestDialogNoFocusable({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { dialogProps, titleProps } = useDialogA11y({
    title: 'Empty Dialog',
    isOpen,
    onClose,
  });

  if (!isOpen) return null;

  return (
    <div {...dialogProps} tabIndex={-1} data-testid="dialog">
      <h2 {...titleProps}>Empty Dialog</h2>
      <p>No focusable elements here</p>
    </div>
  );
}

describe('useDialogA11y', () => {
  it('returns role=dialog and aria-modal=true', () => {
    render(<TestDialog isOpen onClose={vi.fn()} />);
    const dialog = screen.getByTestId('dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('wires aria-labelledby to the title element id', () => {
    render(<TestDialog isOpen onClose={vi.fn()} />);
    const dialog = screen.getByTestId('dialog');
    const title = screen.getByText('Test Dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    expect(title.id).toBeTruthy();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<TestDialog isOpen onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not call onClose for Escape when closed', () => {
    const onClose = vi.fn();
    render(<TestDialog isOpen={false} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('returns focus to the trigger element on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(<TestDialog isOpen onClose={vi.fn()} />);

    rerender(<TestDialog isOpen={false} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(trigger);

    document.body.removeChild(trigger);
  });

  it('traps Tab at last focusable element — wraps to first', () => {
    render(<TestDialog isOpen onClose={vi.fn()} />);
    const last = screen.getByTestId('btn-last');
    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(screen.getByTestId('btn-first'));
  });

  it('traps Shift+Tab at first focusable element — wraps to last', () => {
    render(<TestDialog isOpen onClose={vi.fn()} />);
    const first = screen.getByTestId('btn-first');
    first.focus();
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId('btn-last'));
  });

  it('focuses dialog container when there are no focusable children', () => {
    // Use fake timers so requestAnimationFrame callbacks run via vi.runAllTimers
    vi.useFakeTimers();
    render(<TestDialogNoFocusable isOpen onClose={vi.fn()} />);
    act(() => { vi.runAllTimers(); });
    vi.useRealTimers();
    const dialog = screen.getByTestId('dialog');
    expect(document.activeElement).toBe(dialog);
  });
});
