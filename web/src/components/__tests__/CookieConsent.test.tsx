/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@/test/utils/componentTestUtils';
import { CookieConsent } from '../CookieConsent';
import { initPostHog } from '@/lib/analytics/posthog';

vi.mock('@/lib/analytics/posthog', () => ({ initPostHog: vi.fn() }));

const STORAGE_KEY = 'forge-cookie-consent';

describe('CookieConsent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(STORAGE_KEY);
    // Clear the server-readable consent cookie between cases.
    document.cookie = `${STORAGE_KEY}=; path=/; max-age=0`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.removeItem(STORAGE_KEY);
    document.cookie = `${STORAGE_KEY}=; path=/; max-age=0`;
  });

  it('shows banner when no consent is stored', () => {
    render(<CookieConsent />);
    expect(screen.getByText(/cookies/i)).toBeDefined();
    expect(screen.getByText('Accept')).toBeDefined();
    expect(screen.getByText('Decline')).toBeDefined();
    expect(initPostHog).not.toHaveBeenCalled();
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
    expect(initPostHog).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="region"]')).toBeNull();
  });

  it('writes the server-readable consent cookie =true on Accept (PF-907)', () => {
    render(<CookieConsent />);
    fireEvent.click(screen.getByText('Accept'));
    // The server reads this cookie via next/headers to consent-gate $ai_generation.
    expect(document.cookie).toContain(`${STORAGE_KEY}=true`);
  });

  it('stores decline and hides banner on Decline click', () => {
    const { container } = render(<CookieConsent />);
    fireEvent.click(screen.getByText('Decline'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
    expect(initPostHog).not.toHaveBeenCalled();
    expect(container.querySelector('[role="region"]')).toBeNull();
  });

  it('writes the server-readable consent cookie =false on Decline (PF-907)', () => {
    render(<CookieConsent />);
    fireEvent.click(screen.getByText('Decline'));
    expect(document.cookie).toContain(`${STORAGE_KEY}=false`);
  });

  it.each(['getItem', 'setItem'] as const)('keeps analytics denied when storage %s is unavailable', method => {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new Error('Storage unavailable'); });
    render(<CookieConsent />);
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Decline' }))).not.toThrow();
    expect(document.cookie).toContain(STORAGE_KEY + '=false');
    expect(initPostHog).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Cookie consent' })).toBeNull();
  });

  it.each(['Accept', 'Decline'])('dismisses %s with both storage operations blocked', choice => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    render(<CookieConsent />);
    fireEvent.click(screen.getByRole('button', { name: choice }));
    expect(screen.queryByRole('region', { name: 'Cookie consent' })).toBeNull();
    expect(document.cookie).toContain(STORAGE_KEY + '=' + (choice === 'Accept' ? 'true' : 'false'));
    expect(initPostHog).toHaveBeenCalledTimes(choice === 'Accept' ? 1 : 0);
  });

  it('has correct ARIA attributes', () => {
    render(<CookieConsent />);
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-label')).toBe('Cookie consent');
  });
});
