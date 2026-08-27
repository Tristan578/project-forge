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

  // PF-1215 round 2 (4/5): the initial-focus effect is scheduled once, at
  // open time, via requestAnimationFrame -- `isOpen` staying true across a
  // content change never re-schedules it. If some other, more specific
  // focus decision (a gate's autofocus, a wizard step's own effect) wins
  // the race and moves focus inside the dialog BEFORE that deferred
  // callback actually runs, the callback must not steal focus back onto
  // whatever now happens to be first in the DOM.
  it('does not steal focus that another effect already set inside the dialog before the deferred callback runs', () => {
    vi.useFakeTimers();
    render(<TestDialog isOpen onClose={vi.fn()} />);

    // Simulate a second, more specific effect winning the race and
    // focusing something other than the first focusable element BEFORE
    // the hook's own deferred rAF callback fires.
    const second = screen.getByTestId('btn-second');
    act(() => {
      second.focus();
    });
    expect(document.activeElement).toBe(second);

    // Now let the hook's originally-scheduled callback actually run.
    act(() => {
      vi.runAllTimers();
    });
    vi.useRealTimers();

    expect(document.activeElement).toBe(second);
  });
});
