/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup, within } from '@testing-library/react';
import { useConfirmDialog } from '../useConfirmDialog';

function TestHarness() {
  const { confirm, ConfirmDialogPortal } = useConfirmDialog();

  return (
    <div>
      <button
        data-testid="trigger"
        onClick={async () => {
          const result = await confirm('Are you sure?');
          const el = document.getElementById('result');
          if (el) el.textContent = String(result);
        }}
      >
        Trigger
      </button>
      <div id="result" data-testid="result" />
      <ConfirmDialogPortal />
    </div>
  );
}

describe('useConfirmDialog', () => {
  afterEach(cleanup);

  it('renders nothing when not triggered', () => {
    render(<TestHarness />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows dialog on confirm() call', async () => {
    render(<TestHarness />);
    await act(async () => {
      screen.getByTestId('trigger').click();
    });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Are you sure?')).toBeTruthy();
  });

  it('resolves true on Confirm click', async () => {
    render(<TestHarness />);
    await act(async () => {
      screen.getByTestId('trigger').click();
    });
    const dialog = screen.getByRole('alertdialog');
    await act(async () => {
      within(dialog).getByRole('button', { name: /confirm/i }).click();
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('result').textContent).toBe('true');
  });

  it('resolves false on Cancel click', async () => {
    render(<TestHarness />);
    await act(async () => {
      screen.getByTestId('trigger').click();
    });
    const dialog = screen.getByRole('alertdialog');
    await act(async () => {
      within(dialog).getByRole('button', { name: /cancel/i }).click();
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('result').textContent).toBe('false');
  });

  it('uses unique ARIA IDs per instance', async () => {
    render(<TestHarness />);
    await act(async () => {
      screen.getByTestId('trigger').click();
    });
    const dialog = screen.getByRole('alertdialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();
    expect(labelledBy).not.toBe(describedBy);
    // IDs should include React's useId prefix (colon-delimited)
    expect(labelledBy).toContain('confirm-title-');
    expect(describedBy).toContain('confirm-desc-');
  });
});
