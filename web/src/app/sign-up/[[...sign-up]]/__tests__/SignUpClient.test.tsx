/**
 * Tests for the pre-launch sign-up notice.
 *
 * Sign-ups are intentionally disabled while SpawnForge is in development.
 * The /sign-up route renders an informational notice instead of Clerk's
 * <SignUp> form, so that prospective users get a clear "coming soon"
 * message rather than a restricted-mode error that reads like a support
 * request. See feat/signups-in-development-notice.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { SignUpClient } from '../SignUpClient';

describe('SignUpClient (in-development notice)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the in-development heading', () => {
    render(<SignUpClient />);
    expect(
      screen.getByRole('heading', { name: /in development/i })
    ).toBeDefined();
  });

  it('explains that release details will be published soon', () => {
    render(<SignUpClient />);
    expect(
      screen.getByText(/release details and timeline will be published soon/i)
    ).toBeDefined();
  });

  it('offers a mailto link to support for early-user interest', () => {
    render(<SignUpClient />);
    const mailto = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href') === 'mailto:support@spawnforge.ai');
    expect(mailto).toBeDefined();
  });

  it('links back to the home page', () => {
    render(<SignUpClient />);
    const home = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href') === '/');
    expect(home).toBeDefined();
  });

  it('does not render a Clerk sign-up form', () => {
    render(<SignUpClient />);
    // The Clerk widget renders form fields (email/password). The notice has none.
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
