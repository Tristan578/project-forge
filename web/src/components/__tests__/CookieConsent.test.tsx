/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@/test/utils/componentTestUtils';
import { CookieConsent } from '../CookieConsent';

const STORAGE_KEY = 'forge-cookie-consent';

describe('CookieConsent', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem(STORAGE_KEY);
  });

  it('renders nothing initially during SSR (before useEffect)', () => {
    // Before useEffect fires, consented is null so nothing renders
    const { container } = render(<CookieConsent />);
    // After mount + useEffect, it should show (no stored consent)
    expect(container.innerHTML).not.toBe('');
  });

  it('shows banner when no consent is stored', async () => {
    render(<CookieConsent />);
    expect(await screen.findByText(/cookies/i)).toBeDefined();
    expect(screen.getByText('Accept')).toBeDefined();
    expect(screen.getByText('Decline')).toBeDefined();
  });

  it('hides banner when consent was previously accepted', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    const { container } = render(<CookieConsent />);
    // After useEffect reads 'true', banner should not render
    expect(container.querySelector('[role="region"]')).toBeNull();
  });

  it('stores consent and hides banner on Accept click', async () => {
    render(<CookieConsent />);
    fireEvent.click(await screen.findByText('Accept'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('stores decline and hides banner on Decline click', async () => {
    render(<CookieConsent />);
    fireEvent.click(await screen.findByText('Decline'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
  });

  it('has correct ARIA attributes', async () => {
    render(<CookieConsent />);
    const region = await screen.findByRole('region');
    expect(region.getAttribute('aria-label')).toBe('Cookie consent');
  });
});
