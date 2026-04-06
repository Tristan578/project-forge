/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup, within } from '@testing-library/react';
import { useConfirmDialog } from '../useConfirmDialog';

function TestHarness({ id = 'default' }: { id?: string }) {
  const { confirm, ConfirmDialogPortal } = useConfirmDialog();

  return (
    <div>
      <button
        data-testid={`trigger-${id}`}
        onClick={async () => {
          const result = await confirm('Are you sure?');
          const el = document.getElementById(`result-${id}`);
          if (el) el.textContent = String(result);
        }}
      >
        Trigger
      </button>
      <div id={`result-${id}`} data-testid={`result-${id}`} />
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
      screen.getByTestId('trigger-default').click();
    });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Are you sure?')).toBeTruthy();
  });

  it('resolves true on Confirm click', async () => {
    render(<TestHarness />);
    await act(async () => {
      screen.getByTestId('trigger-default').click();
    });
    const dialog = screen.getByRole('alertdialog');
    await act(async () => {
      within(dialog).getByRole('button', { name: /confirm/i }).click();
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('result-default').textContent).toBe('true');
  });

  it('resolves false on Cancel click', async () => {
    render(<TestHarness />);
    await act(async () => {
      screen.getByTestId('trigger-default').click();
    });
    const dialog = screen.getByRole('alertdialog');
    await act(async () => {
      within(dialog).getByRole('button', { name: /cancel/i }).click();
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('result-default').textContent).toBe('false');
  });

  it('uses unique ARIA IDs per instance', async () => {
    render(
      <>
        <TestHarness id="a" />
        <TestHarness id="b" />
      </>,
    );
    // Open both dialogs
    await act(async () => {
      screen.getByTestId('trigger-a').click();
    });
    await act(async () => {
      screen.getByTestId('trigger-b').click();
    });
    const dialogs = screen.getAllByRole('alertdialog');
    expect(dialogs.length).toBe(2);

    const labelA = dialogs[0].getAttribute('aria-labelledby');
    const labelB = dialogs[1].getAttribute('aria-labelledby');
    const descA = dialogs[0].getAttribute('aria-describedby');
    const descB = dialogs[1].getAttribute('aria-describedby');

    // Each dialog has valid ARIA attributes
    expect(labelA).toBeTruthy();
    expect(labelB).toBeTruthy();
    expect(descA).toBeTruthy();
    expect(descB).toBeTruthy();

    // IDs from different instances must not collide
    expect(labelA).not.toBe(labelB);
    expect(descA).not.toBe(descB);

    // IDs within the same instance must differ (title vs description)
    expect(labelA).not.toBe(descA);
    expect(labelB).not.toBe(descB);

    // IDs should include React's useId prefix
    expect(labelA).toContain('confirm-title-');
    expect(descA).toContain('confirm-desc-');
  });
});
