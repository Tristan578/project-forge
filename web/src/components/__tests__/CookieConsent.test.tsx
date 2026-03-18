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

  it('shows banner when no consent is stored', () => {
    render(<CookieConsent />);
    expect(screen.getByText(/cookies/i)).toBeDefined();
    expect(screen.getByText('Accept')).toBeDefined();
    expect(screen.getByText('Decline')).toBeDefined();
  });

  it('hides banner when consent was previously accepted', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    const { container } = render(<CookieConsent />);
    expect(container.querySelector('[role="region"]')).toBeNull();
  });

  it('hides banner when consent was previously declined', () => {
    localStorage.setItem(STORAGE_KEY, 'false');
    const { container } = render(<CookieConsent />);
    expect(container.querySelector('[role="region"]')).toBeNull();
  });

  it('stores consent and hides banner on Accept click', () => {
    const { container } = render(<CookieConsent />);
    fireEvent.click(screen.getByText('Accept'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    expect(container.querySelector('[role="region"]')).toBeNull();
  });

  it('stores decline and hides banner on Decline click', () => {
    const { container } = render(<CookieConsent />);
    fireEvent.click(screen.getByText('Decline'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
    expect(container.querySelector('[role="region"]')).toBeNull();
  });

  it('has correct ARIA attributes', () => {
    render(<CookieConsent />);
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-label')).toBe('Cookie consent');
  });
});
