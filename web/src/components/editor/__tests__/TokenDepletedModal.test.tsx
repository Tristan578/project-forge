/**
 * Tests for TokenDepletedModal component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { TokenDepletedModal } from '../TokenDepletedModal';

vi.mock('lucide-react', () => ({
  AlertCircle: (props: Record<string, unknown>) => <span data-testid="alert-icon" {...props} />,
  ArrowUpCircle: (props: Record<string, unknown>) => <span data-testid="arrow-icon" {...props} />,
  CreditCard: (props: Record<string, unknown>) => <span data-testid="card-icon" {...props} />,
  Key: (props: Record<string, unknown>) => <span data-testid="key-icon" {...props} />,
}));

// Track navigation. The modal soft-navigates with the App Router, so the seam
// is `useRouter().push` — not `window.location`. A stubbed `location.href` is
// also a weaker assertion than it looks: writing a string to a plain object
// records the write whether or not anything navigated.
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const mockChatState = {
  showTokenDepletedModal: false,
  setShowTokenDepletedModal: vi.fn(),
};

const mockUserState = {
  tier: 'hobbyist' as 'starter' | 'hobbyist' | 'creator' | 'pro',
};

vi.mock('@/stores/chatStore', () => ({
  useChatStore: (selector: (s: typeof mockChatState) => unknown) => selector(mockChatState),
}));

vi.mock('@/stores/userStore', () => ({
  useUserStore: (selector: (s: typeof mockUserState) => unknown) => selector(mockUserState),
}));

describe('TokenDepletedModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatState.showTokenDepletedModal = false;
    mockChatState.setShowTokenDepletedModal = vi.fn();
    mockUserState.tier = 'hobbyist';
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when showTokenDepletedModal is false', () => {
    mockChatState.showTokenDepletedModal = false;
    const { container } = render(<TokenDepletedModal />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the modal when showTokenDepletedModal is true', () => {
    mockChatState.showTokenDepletedModal = true;
    render(<TokenDepletedModal />);
    const modal = screen.getByTestId('token-depleted-modal');
    expect(modal).toBeInTheDocument();
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
  });

  it('displays the "You\'re out of tokens" heading', () => {
    mockChatState.showTokenDepletedModal = true;
    render(<TokenDepletedModal />);
    expect(screen.getByText(/out of tokens/i)).toBeInTheDocument();
  });

  it('shows the current tier name in the modal', () => {
    mockChatState.showTokenDepletedModal = true;
    mockUserState.tier = 'creator';
    render(<TokenDepletedModal />);
    expect(screen.getByText('Creator')).toBeInTheDocument();
  });

  it('shows all three action buttons', () => {
    mockChatState.showTokenDepletedModal = true;
    render(<TokenDepletedModal />);
    expect(screen.getByTestId('upgrade-plan-button')).toBeInTheDocument();
    expect(screen.getByTestId('buy-token-pack-button')).toBeInTheDocument();
    expect(screen.getByTestId('byok-link')).toBeInTheDocument();
  });

  it('navigates to /pricing when Upgrade Plan is clicked', () => {
    mockChatState.showTokenDepletedModal = true;
    render(<TokenDepletedModal />);
    fireEvent.click(screen.getByTestId('upgrade-plan-button'));
    expect(mockChatState.setShowTokenDepletedModal).toHaveBeenCalledWith(false);
    expect(pushMock).toHaveBeenCalledExactlyOnceWith('/pricing');
  });

  // Asserted as a literal, not as SETTINGS_BILLING_HREF: the point of the test
  // is that the destination is a real, reachable URL, and importing the same
  // constant the component uses would make it pass for any value.
  it('navigates to the billing tab on /settings when Buy Token Pack is clicked', () => {
    mockChatState.showTokenDepletedModal = true;
    render(<TokenDepletedModal />);
    fireEvent.click(screen.getByTestId('buy-token-pack-button'));
    expect(mockChatState.setShowTokenDepletedModal).toHaveBeenCalledWith(false);
    expect(pushMock).toHaveBeenCalledExactlyOnceWith('/settings?tab=billing');
  });

  it('navigates to the API-keys tab on /settings when BYOK is clicked', () => {
    mockChatState.showTokenDepletedModal = true;
    render(<TokenDepletedModal />);
    fireEvent.click(screen.getByTestId('byok-link'));
    expect(mockChatState.setShowTokenDepletedModal).toHaveBeenCalledWith(false);
    expect(pushMock).toHaveBeenCalledExactlyOnceWith('/settings?tab=keys');
  });

  // The URL alone is not enough here. SettingsPage validates `?tab=` against its
  // tab ids and silently falls back to Profile for anything else, so the
  // plausible-looking `?tab=api-keys` would render a working page on the WRONG
  // tab and still strand the BYOK user. Assert the slug SettingsPage actually
  // accepts.
  it('uses the tab slug SettingsPage accepts for BYOK, not the label text', () => {
    mockChatState.showTokenDepletedModal = true;
    render(<TokenDepletedModal />);
    fireEvent.click(screen.getByTestId('byok-link'));
    const target = new URL(pushMock.mock.calls[0][0] as string, 'https://example.test');
    expect(target.pathname).toBe('/settings');
    expect(target.searchParams.get('tab')).toBe('keys');
  });

  it('has correct aria-labelledby pointing to the heading', () => {
    mockChatState.showTokenDepletedModal = true;
    render(<TokenDepletedModal />);
    const modal = screen.getByTestId('token-depleted-modal');
    const labelId = modal.getAttribute('aria-labelledby');
    expect(labelId).not.toBeNull();
    expect(document.getElementById(labelId!)).toBeInTheDocument();
  });

  it('renders backdrop element when modal is visible', () => {
    mockChatState.showTokenDepletedModal = true;
    const { container } = render(<TokenDepletedModal />);
    // Backdrop has aria-hidden="true"
    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).toBeInTheDocument();
  });

  it('names the plan the user is actually on, not the internal billing key', () => {
    // The free tier is keyed `starter`, which is also the public name of the
    // paid $9 plan. Rendering the key told a free user they were on "Starter".
    const tierCases: Array<['starter' | 'hobbyist' | 'creator' | 'pro', string]> = [
      ['starter', 'Free'],
      ['hobbyist', 'Starter'],
      ['creator', 'Creator'],
      ['pro', 'Studio'],
    ];

    for (const [tier, label] of tierCases) {
      mockChatState.showTokenDepletedModal = true;
      mockUserState.tier = tier;
      const { unmount } = render(<TokenDepletedModal />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('cannot be dismissed by clicking the backdrop', () => {
    mockChatState.showTokenDepletedModal = true;
    const { container } = render(<TokenDepletedModal />);
    const backdrop = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop);
    // setShowTokenDepletedModal should NOT have been called
    expect(mockChatState.setShowTokenDepletedModal).not.toHaveBeenCalled();
  });
});
