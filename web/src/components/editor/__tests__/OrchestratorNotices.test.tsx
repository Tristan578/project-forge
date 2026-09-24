/**
 * The one message-to-action mapping both plan surfaces render (#6831 review).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@/test/utils/componentTestUtils';
import {
  DiscardConfirmPrompt,
  OrchestratorErrorNotice,
  errorReportsShortBalance,
  orchestratorErrorAction,
} from '../OrchestratorNotices';
import {
  ACCOUNT_BLOCKED_MESSAGE,
  ENGINE_NOT_READY_MESSAGE,
  INSUFFICIENT_TOKENS_MESSAGE,
  PLAN_REJECTED_MESSAGE,
  RATE_LIMITED_MESSAGE,
  RESERVATION_UNCONFIRMED_MESSAGE,
  SIGNED_OUT_MESSAGE,
} from '@/stores/slices/orchestratorSlice';

// A client-side Link keeps the editor's in-memory state (a plan waiting to be
// built) across the trip to settings; a plain <a> would reload and drop it.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} data-next-link="" {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => cleanup());

describe('orchestratorErrorAction', () => {
  it.each([
    [INSUFFICIENT_TOKENS_MESSAGE, { label: 'Buy tokens', href: '/settings?tab=tokens' }],
    [RESERVATION_UNCONFIRMED_MESSAGE, { label: 'Check balance', href: '/settings?tab=tokens' }],
    // Building again is refused until they sign in.
    [SIGNED_OUT_MESSAGE, { label: 'Sign in', href: '/sign-in' }],
  ])('names the follow-up for %s', (error, action) => {
    expect(orchestratorErrorAction(error)).toEqual(action);
  });

  // Their own sentence carries the next step; a token link would mislead.
  it.each([PLAN_REJECTED_MESSAGE, RATE_LIMITED_MESSAGE, ACCOUNT_BLOCKED_MESSAGE, ENGINE_NOT_READY_MESSAGE])(
    'names no link for %s',
    (error) => {
      expect(orchestratorErrorAction(error)).toBeNull();
    },
  );
});

describe('errorReportsShortBalance', () => {
  it('is true only for the short-balance refusal', () => {
    expect(errorReportsShortBalance(INSUFFICIENT_TOKENS_MESSAGE)).toBe(true);
    for (const other of [null, SIGNED_OUT_MESSAGE, RATE_LIMITED_MESSAGE, RESERVATION_UNCONFIRMED_MESSAGE]) {
      expect(errorReportsShortBalance(other)).toBe(false);
    }
  });
});

describe('OrchestratorErrorNotice', () => {
  it('announces the error and renders its link client-side', () => {
    render(<OrchestratorErrorNotice error={INSUFFICIENT_TOKENS_MESSAGE} className="surface" />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(INSUFFICIENT_TOKENS_MESSAGE);
    expect(alert.className).toBe('surface');
    const link = screen.getByRole('link', { name: 'Buy tokens' });
    expect(link.getAttribute('href')).toBe('/settings?tab=tokens');
    expect(link.hasAttribute('data-next-link')).toBe(true);
  });

  it('renders a linkless error as text alone', () => {
    render(<OrchestratorErrorNotice error={ENGINE_NOT_READY_MESSAGE} />);

    expect(screen.getByRole('alert').textContent).toBe(ENGINE_NOT_READY_MESSAGE);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('DiscardConfirmPrompt', () => {
  it('says what discarding costs and offers the way back', () => {
    const onKeep = vi.fn();
    render(<DiscardConfirmPrompt onKeep={onKeep} />);

    expect(screen.getByRole('status').textContent).toContain('Planning it again costs tokens.');
    fireEvent.click(screen.getByRole('button', { name: 'Keep plan' }));
    expect(onKeep).toHaveBeenCalledTimes(1);
  });
});
