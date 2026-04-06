/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { useConfirmDialog } from '../useConfirmDialog';

function TestHarness() {
  const { confirm, ConfirmDialogPortal } = useConfirmDialog();

  return (
    <div>
      <button
        data-testid="trigger"
        onClick={async () => {
          const result = await confirm('Are you sure?');
          document.getElementById('result')!.textContent = String(result);
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
    // Find the Confirm button inside the alertdialog
    const dialog = screen.getByRole('alertdialog');
    const confirmBtn = dialog.querySelector('button:last-child')!;
    await act(async () => {
      (confirmBtn as HTMLElement).click();
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
    const cancelBtn = dialog.querySelector('button:first-of-type')!;
    await act(async () => {
      (cancelBtn as HTMLElement).click();
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('result').textContent).toBe('false');
  });
});
