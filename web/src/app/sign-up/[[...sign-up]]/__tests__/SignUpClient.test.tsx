/**
 * Tests for the pre-launch waitlist page (#8730).
 *
 * Sign-ups stay intentionally disabled while SpawnForge is in development —
 * the /sign-up route deliberately renders NO Clerk <SignUp>. But every
 * marketing CTA ("Join the Waitlist", "Request Early Access") lands here, so
 * the page must actually capture the lead it promises: an accessible email
 * form posting to /api/waitlist, with a hidden honeypot, an aria-live status
 * region, and idle/submitting/success/error states.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import userEvent from '@testing-library/user-event';
import { SignUpClient } from '../SignUpClient';

function okResponse() {
  return new Response(
    JSON.stringify({ ok: true, message: "You're on the list." }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function errorResponse(status: number) {
  return new Response(JSON.stringify({ error: 'nope' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SignUpClient (waitlist capture)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('keeps the in-development messaging', () => {
    render(<SignUpClient />);
    expect(
      screen.getByRole('heading', { name: /in development/i })
    ).toBeInTheDocument();
  });

  it('does not render a Clerk sign-up form (sign-ups stay disabled)', () => {
    render(<SignUpClient />);
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.queryByText(/continue with google/i)).toBeNull();
  });

  it('renders a waitlist form with a labelled email input and submit button', () => {
    render(<SignUpClient />);
    const input = screen.getByLabelText(/email address/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('autocomplete', 'email');
    expect(
      screen.getByRole('button', { name: /join the waitlist/i })
    ).toBeInTheDocument();
  });

  it('renders an aria-live polite status region from first paint', () => {
    render(<SignUpClient />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('renders the honeypot field hidden from users, the a11y tree, and the tab order', () => {
    const { container } = render(<SignUpClient />);
    const honeypot = container.querySelector('input[name="website"]');
    expect(honeypot).not.toBeNull();
    expect(honeypot).toHaveAttribute('tabindex', '-1');
    expect(honeypot).toHaveAttribute('autocomplete', 'off');
    // Hidden from assistive tech via an aria-hidden wrapper…
    expect(honeypot!.closest('[aria-hidden="true"]')).not.toBeNull();
    // …so the ONLY textbox in the a11y tree is the real email input.
    const accessibleTextboxes = screen.getAllByRole('textbox');
    expect(accessibleTextboxes).toHaveLength(1);
    expect(accessibleTextboxes[0]).toHaveAttribute('id', 'waitlist-email');
  });

  it('submits the email to /api/waitlist and shows the confirmation', async () => {
    const user = userEvent.setup();
    render(<SignUpClient />);

    await user.type(screen.getByLabelText(/email address/i), 'fan@example.com');
    await user.click(screen.getByRole('button', { name: /join the waitlist/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/you're on the list/i);
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/waitlist',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'fan@example.com', website: '' }),
      })
    );
    // The form is replaced by the confirmation — no resubmission affordance.
    expect(screen.queryByRole('button', { name: /join the waitlist/i })).toBeNull();
  });

  it('guards the submit button with aria-disabled while in flight and blocks re-submission', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; })
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SignUpClient />);

    await user.type(screen.getByLabelText(/email address/i), 'fan@example.com');
    await user.click(screen.getByRole('button', { name: /join the waitlist/i }));

    // aria-disabled, NOT the disabled attribute: real browsers move focus to
    // <body> the moment a focused button is hard-disabled, so the click
    // submitter would lose their place even on the error path.
    const pending = await screen.findByRole('button', { name: /joining/i });
    expect(pending).toHaveAttribute('aria-disabled', 'true');
    expect(pending).not.toHaveAttribute('disabled');

    // The handler's re-entry guard (not the attribute) prevents double posts.
    await user.click(pending);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(okResponse());
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/you're on the list/i);
    });
  });

  it('moves focus to the status region on success (form unmounts under the focused element)', async () => {
    const user = userEvent.setup();
    render(<SignUpClient />);

    const input = screen.getByLabelText(/email address/i);
    await user.type(input, 'fan@example.com{enter}');

    // Without explicit focus management, unmounting the form drops focus to
    // document.body and a keyboard user's next Tab restarts from the top of
    // the document (WCAG 2.4.3 Focus Order).
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveFocus();
    });
    expect(screen.getByRole('status')).toHaveTextContent(/you're on the list/i);
  });

  it('shows an accessible error and keeps the form usable when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(500)));
    const user = userEvent.setup();
    render(<SignUpClient />);

    const input = screen.getByLabelText(/email address/i);
    await user.type(input, 'fan@example.com');
    await user.click(screen.getByRole('button', { name: /join the waitlist/i }));

    await waitFor(() => {
      // Specific, actionable copy — NOT a generic "something went wrong" (the
      // ux-reviewer rubric fails that): names the failed operation and offers
      // both a retry and the support fallback already on the page.
      expect(screen.getByRole('status')).toHaveTextContent(/add you to the list/i);
    });
    // The error text is programmatically associated with the input, but the
    // VALUE is fine — a server failure must not announce "invalid entry" and
    // steer the user to edit a correct address.
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).toHaveAttribute('aria-describedby', 'waitlist-status');
    // Form stays mounted and re-enabled for retry.
    expect(screen.getByRole('button', { name: /join the waitlist/i })).toBeEnabled();
    // …and the typed value survives the failure so retry is one click, not a re-type.
    expect(input).toHaveValue('fan@example.com');
  });

  it('marks the email field invalid for a server-side validation rejection (400)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(400)));
    const user = userEvent.setup();
    render(<SignUpClient />);

    const input = screen.getByLabelText(/email address/i);
    await user.type(input, 'fan@example.com');
    await user.click(screen.getByRole('button', { name: /join the waitlist/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/does not look right/i);
    });
    // A 400 means the entered value itself was rejected — here aria-invalid
    // is truthful.
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'waitlist-status');
  });

  it('marks the email field invalid for the client-side empty-email check without fetching', async () => {
    const user = userEvent.setup();
    render(<SignUpClient />);

    await user.click(screen.getByRole('button', { name: /join the waitlist/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/enter your email address/i);
    });
    expect(screen.getByLabelText(/email address/i)).toHaveAttribute('aria-invalid', 'true');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a rate-limit-specific message on 429 without flagging the value as invalid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(429)));
    const user = userEvent.setup();
    render(<SignUpClient />);

    const input = screen.getByLabelText(/email address/i);
    await user.type(input, 'fan@example.com');
    await user.click(screen.getByRole('button', { name: /join the waitlist/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/too many attempts/i);
    });
    // Rate limiting is operational, not a value problem.
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('shows a network-error message when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const user = userEvent.setup();
    render(<SignUpClient />);

    await user.type(screen.getByLabelText(/email address/i), 'fan@example.com');
    await user.click(screen.getByRole('button', { name: /join the waitlist/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/network error/i);
    });
    // A transient network failure must not wipe the address the user typed.
    expect(screen.getByLabelText(/email address/i)).toHaveValue('fan@example.com');
  });

  it('offers a mailto link to support as a secondary contact', () => {
    render(<SignUpClient />);
    const support = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href') === 'mailto:support@spawnforge.ai');
    expect(support).toBeDefined();
  });

  it('links back to the home page', () => {
    render(<SignUpClient />);
    const home = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href') === '/');
    expect(home).toBeDefined();
  });
});
