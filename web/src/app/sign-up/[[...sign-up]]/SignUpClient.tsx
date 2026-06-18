'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button, Input, Label, cn } from '@spawnforge/ui';

/**
 * Pre-launch waitlist page (#8730).
 *
 * Sign-ups are intentionally disabled while SpawnForge is in development —
 * this page deliberately renders NO Clerk <SignUp> (approved users still
 * authenticate at /sign-in). Every marketing CTA ("Join the Waitlist",
 * "Request Early Access") lands here, so instead of a dead-end notice the
 * page captures the promised lead: an email form posting to /api/waitlist.
 *
 * Built on the @spawnforge/ui design system — Label/Input/Button primitives
 * and var(--sf-*) tokens — so it renders correctly across all 7 themes and in
 * light mode (no hardcoded zinc/blue/red/emerald that would be theme-blind).
 *
 * Accessibility: a real <label> on the input, a persistent aria-live="polite"
 * status region for success/error announcements, error text programmatically
 * associated via aria-describedby (aria-invalid only for field-validation
 * failures — a 429/500/network error does not make the VALUE invalid), and
 * the submit guarded with aria-disabled while a request is in flight (the
 * real `disabled` attribute would drop focus to <body> in Chrome/Firefox the
 * moment it lands on the focused button; re-entry is blocked in the handler).
 * On success the form unmounts, so focus is explicitly moved to the status
 * region — otherwise keyboard users are dropped to <body> (WCAG 2.4.3).
 *
 * Honeypot: the "website" field is visually hidden by OFF-SCREEN POSITIONING
 * rather than display:none — naive bots skip display:none fields, while an
 * off-screen field still looks fillable. It is removed from the a11y tree
 * (aria-hidden wrapper) and the tab order (tabIndex={-1}), with
 * autoComplete="off" so browsers never fill it for real users.
 */

type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

/**
 * Why two error kinds: aria-invalid on the input is only truthful when the
 * VALUE the user entered is bad ('field': empty email, HTTP 400). Operational
 * failures (429 rate limit, 5xx, network) leave a perfectly valid value —
 * announcing "invalid entry" there contradicts the visible message and steers
 * the user to edit a correct address.
 */
type ErrorKind = 'field' | 'operational';

export function SignUpClient() {
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKind, setErrorKind] = useState<ErrorKind>('operational');
  const statusRef = useRef<HTMLParagraphElement>(null);

  // On success the whole <form> unmounts while focus is inside it (the email
  // input for Enter-key submitters, the button for click submitters). Without
  // explicit management focus falls to document.body and the next Tab restarts
  // from the top of the page — so move it to the status region, which holds
  // the confirmation text the user needs next.
  useEffect(() => {
    if (status === 'success') {
      statusRef.current?.focus();
    }
  }, [status]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Re-entry guard: with aria-disabled (not `disabled`) the button stays
    // clickable, so THIS is what prevents double submission in flight.
    if (status === 'submitting') return;

    const formData = new FormData(event.currentTarget);
    // FormData.get returns null for a missing field — ?? (not ||) so an
    // empty string is preserved as-is rather than masked by a default.
    const email = String(formData.get('email') ?? '').trim();
    const website = String(formData.get('website') ?? '');

    if (email.length === 0) {
      setStatus('error');
      setErrorKind('field');
      setErrorMessage('Enter your email address to join the waitlist.');
      return;
    }

    setStatus('submitting');
    setErrorMessage('');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, website }),
      });
      if (res.ok) {
        setStatus('success');
        return;
      }
      setStatus('error');
      if (res.status === 429) {
        setErrorKind('operational');
        setErrorMessage('Too many attempts. Please wait a minute and try again.');
      } else if (res.status === 400) {
        setErrorKind('field');
        setErrorMessage('That email address does not look right. Please check it and try again.');
      } else {
        setErrorKind('operational');
        setErrorMessage(
          "We couldn't add you to the list just now. Please try again, or email support@spawnforge.ai if it keeps happening."
        );
      }
    } catch {
      setStatus('error');
      setErrorKind('operational');
      setErrorMessage('Network error. Please check your connection and try again.');
    }
  }

  const statusText =
    status === 'success'
      ? "You're on the list. We'll email you when early access opens."
      : status === 'error'
        ? errorMessage
        : '';

  const isFieldError = status === 'error' && errorKind === 'field';

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--sf-bg-app)] px-6">
      <div className="w-full max-w-md rounded-[var(--sf-radius-xl)] border border-[var(--sf-border)] bg-[var(--sf-bg-surface)] p-8 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-[var(--sf-radius-full)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg-app)] px-4 py-1.5 text-sm text-[var(--sf-text-secondary)]">
          SpawnForge
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--sf-text)] sm:text-3xl">
          SpawnForge is in development
        </h1>
        <p className="mt-4 text-base leading-relaxed text-[var(--sf-text-secondary)]">
          Sign-ups open with early access. Join the waitlist and we&apos;ll
          email you when your spot is ready.
        </p>

        {/* Persistent live region: present from first paint so screen readers
            announce later success/error updates. tabIndex={-1} keeps it out of
            the tab order but lets the success effect move focus here when the
            form unmounts. */}
        <p
          id="waitlist-status"
          ref={statusRef}
          role="status"
          aria-live="polite"
          tabIndex={-1}
          className={cn(
            'mt-6 min-h-5 text-sm',
            status === 'error' ? 'text-[var(--sf-destructive)]' : 'text-[var(--sf-success)]'
          )}
        >
          {statusText}
        </p>

        {status !== 'success' && (
          <form onSubmit={handleSubmit} className="relative mt-2 text-left" noValidate>
            {/* Honeypot — see the component docblock for the hiding rationale.
                Kept as raw, color-free, off-screen markup on purpose: it is
                aria-hidden and must look like a plain fillable field to bots,
                so it deliberately does NOT use the themed primitives. */}
            <div
              aria-hidden="true"
              className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden"
            >
              <label htmlFor="waitlist-website">Website</label>
              <input
                id="waitlist-website"
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                defaultValue=""
              />
            </div>

            <Label htmlFor="waitlist-email" className="block">
              Email address
            </Label>
            <Input
              id="waitlist-email"
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              placeholder="you@example.com"
              error={isFieldError}
              aria-describedby={status === 'error' ? 'waitlist-status' : undefined}
              className="mt-2"
            />
            {/* aria-disabled (not `disabled`): real browsers drop focus to
                <body> the instant a focused button gets the disabled attribute,
                losing the keyboard user's place even on the error path. Passed
                via {...props} (NOT the `disabled` prop) so the Button keeps the
                real attribute off; the handler's re-entry guard blocks double
                submission, and aria-disabled:* variants carry the visual state.

                (The interim bg-[var(--sf-accent-hover)] AA override is gone: the
                shared Button `default` variant now meets WCAG AA at rest and hover
                in all 7 themes via its own tokens — fixed in #8742.) */}
            <Button
              type="submit"
              size="lg"
              aria-disabled={status === 'submitting' ? true : undefined}
              className="mt-4 w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            >
              {status === 'submitting' ? 'Joining…' : 'Join the waitlist'}
            </Button>
          </form>
        )}

        <p className="mt-6 text-sm text-[var(--sf-text-secondary)]">
          Questions?{' '}
          <a
            href="mailto:support@spawnforge.ai"
            className="font-medium text-[var(--sf-accent)] underline-offset-4 transition-colors hover:text-[var(--sf-accent-hover)] hover:underline"
          >
            support@spawnforge.ai
          </a>
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex min-h-[44px] items-center justify-center rounded-[var(--sf-radius-md)] border border-[var(--sf-border-strong)] px-6 text-base font-medium text-[var(--sf-text-secondary)] transition-all duration-[var(--sf-transition)] hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sf-bg-app)]"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
