/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@/test/utils/componentTestUtils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemixQuarantineNotice } from '../RemixQuarantineNotice';

vi.mock('lucide-react', () => ({
  ShieldAlert: () => <span aria-hidden="true" />,
  X: () => <span aria-hidden="true" />,
}));

describe('RemixQuarantineNotice', () => {
  afterEach(cleanup);

  it('names quarantined scripts and explains how to re-enable them', () => {
    render(<RemixQuarantineNotice count={3} />);

    expect(screen.getByRole('status').textContent).toContain('3 scripts were disabled');
    expect(screen.getByRole('status').textContent).toContain('Script panel');
  });

  it('shows nothing when no scripts were quarantined', () => {
    render(<RemixQuarantineNotice count={0} />);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('can be dismissed', () => {
    render(<RemixQuarantineNotice count={1} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss disabled scripts notice' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
