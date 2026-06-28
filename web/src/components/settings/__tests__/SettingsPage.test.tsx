/**
 * Tests for SettingsPage — tab navigation, URL syncing, back button,
 * and active tab highlighting.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { UserProfile } from '@clerk/nextjs';
import { SettingsPage } from '../SettingsPage';

// ── Router & navigation mocks ──────────────────────────────────────────────

const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn();
const mockSearchParamsGet = vi.fn().mockReturnValue(null);
const mockSearchParamsToString = vi.fn().mockReturnValue('');

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
  }),
  useSearchParams: () => ({
    get: mockSearchParamsGet,
    toString: mockSearchParamsToString,
  }),
}));

// ── Sub-tab component stubs ────────────────────────────────────────────────

vi.mock('../ProfileTab', () => ({
  ProfileTab: () => <div data-testid="profile-tab">Profile Content</div>,
}));

vi.mock('../TokenDashboard', () => ({
  TokenDashboard: () => <div data-testid="token-dashboard">Tokens Content</div>,
}));

vi.mock('../ApiKeyManager', () => ({
  ApiKeyManager: () => <div data-testid="api-key-manager">API Keys Content</div>,
}));

vi.mock('../BillingTab', () => ({
  BillingTab: () => <div data-testid="billing-tab">Billing Content</div>,
}));

vi.mock('../AccountTab', () => ({
  AccountTab: () => <div data-testid="account-tab">Account Content</div>,
}));

// Clerk's prebuilt <UserProfile> (Security tab) is mocked because CI/E2E run in
// Clerk passthrough mode (no keys → <ClerkProvider> is not mounted). Mirrors how
// DashboardLayout/EditorLayout tests stub <UserButton>. The mock is a vi.fn that
// reflects the `routing` prop onto data-routing so a test can assert the
// routing="hash" guard (which keeps Clerk's internal nav from hijacking the
// page's own ?tab= routing) actually reaches the component.
vi.mock('@clerk/nextjs', () => ({
  UserProfile: vi.fn(({ routing }: { routing?: string }) => (
    <div data-testid="clerk-user-profile" data-routing={routing}>
      Clerk Security
    </div>
  )),
}));

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsGet.mockReturnValue(null);
    mockSearchParamsToString.mockReturnValue('');
  });

  afterEach(() => cleanup());

  // ── Basic rendering ────────────────────────────────────────────────────

  it('renders the Settings page heading', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('renders all six navigation tabs', () => {
    render(<SettingsPage />);
    expect(screen.getAllByText('Profile').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tokens').length).toBeGreaterThan(0);
    expect(screen.getAllByText('API Keys').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Billing').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Security').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Account').length).toBeGreaterThan(0);
  });

  // ── Default active tab ─────────────────────────────────────────────────
  // Note: SettingsPage renders both a desktop column layout and a mobile
  // horizontal layout. Each renders the active tab content, so we use
  // getAllByTestId and assert at least one element is present.

  it('shows ProfileTab by default (no URL param)', () => {
    mockSearchParamsGet.mockReturnValue(null);
    render(<SettingsPage />);
    expect(screen.getAllByTestId('profile-tab').length).toBeGreaterThan(0);
  });

  it('shows correct tab when URL param is "tokens"', () => {
    mockSearchParamsGet.mockReturnValue('tokens');
    render(<SettingsPage />);
    expect(screen.getAllByTestId('token-dashboard').length).toBeGreaterThan(0);
  });

  it('shows correct tab when URL param is "keys"', () => {
    mockSearchParamsGet.mockReturnValue('keys');
    render(<SettingsPage />);
    expect(screen.getAllByTestId('api-key-manager').length).toBeGreaterThan(0);
  });

  it('shows correct tab when URL param is "billing"', () => {
    mockSearchParamsGet.mockReturnValue('billing');
    render(<SettingsPage />);
    expect(screen.getAllByTestId('billing-tab').length).toBeGreaterThan(0);
  });

  it('shows correct tab when URL param is "account"', () => {
    mockSearchParamsGet.mockReturnValue('account');
    render(<SettingsPage />);
    expect(screen.getAllByTestId('account-tab').length).toBeGreaterThan(0);
  });

  it('shows Clerk <UserProfile> when URL param is "security"', () => {
    mockSearchParamsGet.mockReturnValue('security');
    render(<SettingsPage />);
    const profiles = screen.getAllByTestId('clerk-user-profile');
    expect(profiles.length).toBeGreaterThan(0);
    // routing="hash" is the critical guard: it scopes Clerk's internal navigation
    // to the URL hash so it cannot hijack the page's own ?tab= query routing.
    // Assert it actually reaches <UserProfile> (rendered attr + the real prop on
    // the mock call) so a future edit that drops the prop fails here.
    expect(profiles[0].getAttribute('data-routing')).toBe('hash');
    expect(vi.mocked(UserProfile).mock.calls[0]?.[0]).toMatchObject({ routing: 'hash' });
  });

  it('falls back to profile tab for invalid URL param', () => {
    mockSearchParamsGet.mockReturnValue('invalid_tab_value');
    render(<SettingsPage />);
    expect(screen.getAllByTestId('profile-tab').length).toBeGreaterThan(0);
  });

  // ── Tab switching ──────────────────────────────────────────────────────

  it('switches to Tokens tab on click', () => {
    render(<SettingsPage />);
    const tokensButtons = screen.getAllByText('Tokens');
    fireEvent.click(tokensButtons[0]);
    expect(screen.getAllByTestId('token-dashboard').length).toBeGreaterThan(0);
  });

  it('switches to API Keys tab on click', () => {
    render(<SettingsPage />);
    const apiKeyButtons = screen.getAllByText('API Keys');
    fireEvent.click(apiKeyButtons[0]);
    expect(screen.getAllByTestId('api-key-manager').length).toBeGreaterThan(0);
  });

  it('switches to Billing tab on click', () => {
    render(<SettingsPage />);
    const billingButtons = screen.getAllByText('Billing');
    fireEvent.click(billingButtons[0]);
    expect(screen.getAllByTestId('billing-tab').length).toBeGreaterThan(0);
  });

  it('switches to Account tab on click', () => {
    render(<SettingsPage />);
    const accountButtons = screen.getAllByText('Account');
    fireEvent.click(accountButtons[0]);
    expect(screen.getAllByTestId('account-tab').length).toBeGreaterThan(0);
  });

  it('switches to Security tab on click', () => {
    render(<SettingsPage />);
    const securityButtons = screen.getAllByText('Security');
    fireEvent.click(securityButtons[0]);
    expect(screen.getAllByTestId('clerk-user-profile').length).toBeGreaterThan(0);
  });

  // ── URL updates ────────────────────────────────────────────────────────

  it('calls router.replace with tab param when switching tabs', () => {
    render(<SettingsPage />);
    const tokensButtons = screen.getAllByText('Tokens');
    fireEvent.click(tokensButtons[0]);
    expect(mockRouterReplace).toHaveBeenCalledWith(
      expect.stringContaining('tokens'),
      expect.any(Object)
    );
  });

  it('removes tab param when switching back to Profile', () => {
    mockSearchParamsGet.mockReturnValue('tokens');
    render(<SettingsPage />);
    const profileButtons = screen.getAllByText('Profile');
    fireEvent.click(profileButtons[0]);
    // URL should not contain 'tab='
    expect(mockRouterReplace).toHaveBeenCalledWith(
      expect.not.stringContaining('tab='),
      expect.any(Object)
    );
  });

  it('syncs ?tab=security to the URL when switching to Security tab', () => {
    render(<SettingsPage />);
    const securityButtons = screen.getAllByText('Security');
    fireEvent.click(securityButtons[0]);
    expect(mockRouterReplace).toHaveBeenCalledWith(
      expect.stringContaining('security'),
      expect.any(Object)
    );
  });

  // ── Accessibility (aria-current parity with existing tabs) ───────────────

  it('marks the active Security tab with aria-current="page", matching other tabs', () => {
    mockSearchParamsGet.mockReturnValue('security');
    render(<SettingsPage />);
    // Desktop + mobile layouts each render a Security button; the active tab(s)
    // must expose aria-current="page" exactly like every other tab does.
    const securityButtons = screen.getAllByText('Security');
    const currentSecurity = securityButtons.filter(
      (btn) => btn.closest('button')?.getAttribute('aria-current') === 'page'
    );
    expect(currentSecurity.length).toBeGreaterThan(0);
    // A non-active tab (Billing) must NOT carry aria-current while Security is active.
    const billingButtons = screen.getAllByText('Billing');
    const currentBilling = billingButtons.filter(
      (btn) => btn.closest('button')?.getAttribute('aria-current') === 'page'
    );
    expect(currentBilling.length).toBe(0);
  });

  // ── Back button ────────────────────────────────────────────────────────

  it('navigates to /dashboard when back button is clicked', () => {
    render(<SettingsPage />);
    const backBtn = screen.getByRole('button', { name: /back to dashboard/i });
    fireEvent.click(backBtn);
    expect(mockRouterPush).toHaveBeenCalledWith('/dashboard');
  });
});
