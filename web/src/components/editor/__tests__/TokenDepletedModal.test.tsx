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

// Track navigation
const assignMock = vi.fn();
Object.defineProperty(window, 'location', {
  value: { href: '', assign: assignMock },
  writable: true,
  configurable: true,
});

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
    window.location.href = '';
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
    expect(modal).toBeDefined();
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
  });

  it('displays the "You\'re out of tokens" heading', () => {
    mockChatState.showTokenDepletedModal = true;
    render(<TokenDepletedModal />);
    expect(screen.getByText(/out of tokens/i)).toBeDefined();
  });

  it('shows the current tier name in the modal', () => {
    mockChatState.showTokenDepletedModal = true;
    mockUserState.tier = 'creator';
    render(<TokenDepletedModal />);
    expect(screen.getByText('Creator')).toBeDefined();
  });

  it('shows all three action buttons', () => {
    mockChatState.showTokenDepletedModal = true;
    render(<TokenDepletedModal />);
    expect(screen.getByTestId('upgrade-plan-button')).toBeDefined();
    expect(screen.getByTestId('buy-token-pack-button')).toBeDefined();
    expect(screen.getByTestId('byok-link')).toBeDefined();
  });

  it('navigates to /pricing when Upgrade Plan is clicked', () => {
    mockChatState.showTokenDepletedModal = true;
    render(<TokenDepletedModal />);
    fireEvent.click(screen.getByTestId('upgrade-plan-button'));
    expect(mockChatState.setShowTokenDepletedModal).toHaveBeenCalledWith(false);
    expect(window.location.href).toBe('/pricing');
  });

  it('navigates to /settings/billing when Buy Token Pack is clicked', () => {
    mockChatState.showTokenDepletedModal = true;
    render(<TokenDepletedModal />);
    fireEvent.click(screen.getByTestId('buy-token-pack-button'));
    expect(mockChatState.setShowTokenDepletedModal).toHaveBeenCalledWith(false);
    expect(window.location.href).toBe('/settings/billing');
  });

  it('navigates to /settings/api-keys when BYOK is clicked', () => {
    mockChatState.showTokenDepletedModal = true;
    render(<TokenDepletedModal />);
    fireEvent.click(screen.getByTestId('byok-link'));
    expect(mockChatState.setShowTokenDepletedModal).toHaveBeenCalledWith(false);
    expect(window.location.href).toBe('/settings/api-keys');
  });

  it('has correct aria-labelledby pointing to the heading', () => {
    mockChatState.showTokenDepletedModal = true;
    render(<TokenDepletedModal />);
    const modal = screen.getByTestId('token-depleted-modal');
    const labelId = modal.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)).toBeDefined();
  });

  it('renders backdrop element when modal is visible', () => {
    mockChatState.showTokenDepletedModal = true;
    const { container } = render(<TokenDepletedModal />);
    // Backdrop has aria-hidden="true"
    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).toBeDefined();
  });

  it('displays tier labels for all tiers', () => {
    const tierCases: Array<['starter' | 'hobbyist' | 'creator' | 'pro', string]> = [
      ['starter', 'Starter'],
      ['hobbyist', 'Hobbyist'],
      ['creator', 'Creator'],
      ['pro', 'Pro'],
    ];

    for (const [tier, label] of tierCases) {
      mockChatState.showTokenDepletedModal = true;
      mockUserState.tier = tier;
      const { unmount } = render(<TokenDepletedModal />);
      expect(screen.getByText(label)).toBeDefined();
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
