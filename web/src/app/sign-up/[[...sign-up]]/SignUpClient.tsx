'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

/**
 * Pre-launch waitlist page (#8730).
 *
 * Sign-ups are intentionally disabled while SpawnForge is in development —
 * this page deliberately renders NO Clerk <SignUp> (approved users still
 * authenticate at /sign-in). Every marketing CTA ("Join the Waitlist",
 * "Request Early Access") lands here, so instead of a dead-end notice the
 * page captures the promised lead: an email form posting to /api/waitlist.
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
        setErrorMessage('Something went wrong. Please try again.');
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-1.5 text-sm text-zinc-300">
          SpawnForge
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          SpawnForge is in development
        </h1>
        <p className="mt-4 text-base leading-relaxed text-zinc-400">
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
          className={`mt-6 min-h-5 text-sm ${status === 'error' ? 'text-red-400' : 'text-emerald-400'}`}
        >
          {statusText}
        </p>

        {status !== 'success' && (
          <form onSubmit={handleSubmit} className="relative mt-2 text-left" noValidate>
            {/* Honeypot — see the component docblock for the hiding rationale. */}
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

            <label
              htmlFor="waitlist-email"
              className="block text-sm font-medium text-zinc-300"
            >
              Email address
            </label>
            <input
              id="waitlist-email"
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={status === 'error' && errorKind === 'field' ? true : undefined}
              aria-describedby={status === 'error' ? 'waitlist-status' : undefined}
              className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-white placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            {/* aria-disabled (not `disabled`): real browsers drop focus to
                <body> the instant a focused button gets the disabled attribute,
                losing the keyboard user's place even on the error path. The
                handler's re-entry guard blocks double submission instead. */}
            <button
              type="submit"
              aria-disabled={status === 'submitting' ? true : undefined}
              className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            >
              {status === 'submitting' ? 'Joining…' : 'Join the waitlist'}
            </button>
          </form>
        )}

        <p className="mt-6 text-sm text-zinc-400">
          Questions?{' '}
          <a
            href="mailto:support@spawnforge.ai"
            className="font-medium text-blue-400 underline-offset-4 transition-colors hover:text-blue-300 hover:underline"
          >
            support@spawnforge.ai
          </a>
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center justify-center rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
