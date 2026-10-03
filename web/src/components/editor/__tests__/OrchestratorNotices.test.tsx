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
import { MCP_TOKEN_PARAM } from '@/lib/mcp/tokenParam';

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
  ])('names the follow-up for %s', (error, action) => {
    expect(orchestratorErrorAction(error)).toEqual(action);
  });

  // Building again is refused until they sign in, and sign-in must bring them
  // back to the editor, not the dashboard.
  it('sends a signed-out user to sign-in and back to where they were building', () => {
    expect(orchestratorErrorAction(SIGNED_OUT_MESSAGE, '/editor/p1?x=1')).toEqual({
      label: 'Sign in',
      href: '/sign-in?redirect_url=%2Feditor%2Fp1%3Fx%3D1',
    });
  });

  // Anything that resolves off this origin would be an open redirect. The
  // middle three start with '/' but a browser's URL parser reads them as
  // another host: it treats '\' as '/' and drops tabs and newlines. The last
  // two parse ON this origin, yet their pathname collapses to '//evil.example'
  // (a '..' segment eats the one before it), which Clerk would then resolve as
  // a protocol-relative URL — so the emitted value is checked, not the input.
  it.each([
    undefined,
    null,
    '',
    'https://evil.example/',
    '//evil.example/x',
    '/\\evil.example/x',
    '/\t/evil.example/x',
    '/\n/evil.example/x',
    '/..//evil.example/x',
    '/a/..//evil.example',
  ])('falls back to plain sign-in for return path %j', (returnTo) => {
    expect(orchestratorErrorAction(SIGNED_OUT_MESSAGE, returnTo)?.href).toBe('/sign-in');
  });

  // The fragment is part of where they were (a deep link into a panel).
  it('carries the hash of the return path', () => {
    expect(orchestratorErrorAction(SIGNED_OUT_MESSAGE, '/editor/p1#scene')?.href).toBe(
      '/sign-in?redirect_url=%2Feditor%2Fp1%23scene',
    );
  });

  // The MCP relay token must not be copied into a second URL.
  it('drops the mcp relay token from the return path and keeps the rest', () => {
    expect(orchestratorErrorAction(SIGNED_OUT_MESSAGE, `/editor/p1?${MCP_TOKEN_PARAM}=secret-token&tab=scene`)?.href).toBe(
      '/sign-in?redirect_url=%2Feditor%2Fp1%3Ftab%3Dscene',
    );
  });

  it('leaves no dangling ? when the token was the only query parameter', () => {
    expect(orchestratorErrorAction(SIGNED_OUT_MESSAGE, `/editor/p1?${MCP_TOKEN_PARAM}=tok`)?.href).toBe(
      '/sign-in?redirect_url=%2Feditor%2Fp1',
    );
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

  it('renders the Sign in link client-side, returning to the current page', () => {
    window.history.pushState({}, '', '/editor/proj-7?tab=scene');
    try {
      render(<OrchestratorErrorNotice error={SIGNED_OUT_MESSAGE} />);
      const link = screen.getByRole('link', { name: 'Sign in' });
      expect(link.getAttribute('href')).toBe('/sign-in?redirect_url=%2Feditor%2Fproj-7%3Ftab%3Dscene');
      expect(link.hasAttribute('data-next-link')).toBe(true);
    } finally {
      window.history.pushState({}, '', '/');
    }
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
