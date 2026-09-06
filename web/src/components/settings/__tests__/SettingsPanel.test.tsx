/**
 * Render tests for SettingsPanel component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { SettingsPanel } from '../SettingsPanel';

// Mock child tabs to avoid their fetch calls
vi.mock('../TokenDashboard', () => ({
  TokenDashboard: () => <div data-testid="token-dashboard">TokenDashboard</div>,
}));

vi.mock('../ApiKeyManager', () => ({
  ApiKeyManager: () => <div data-testid="api-key-manager">ApiKeyManager</div>,
}));

vi.mock('../BillingTab', () => ({
  BillingTab: () => <div data-testid="billing-tab">BillingTab</div>,
}));

vi.mock('../AppearanceTab', () => ({
  AppearanceTab: () => <div data-testid="appearance-tab">AppearanceTab</div>,
}));

vi.mock('lucide-react', () => ({
  Settings: (props: Record<string, unknown>) => <span data-testid="settings-icon" {...props} />,
  Coins: (props: Record<string, unknown>) => <span data-testid="coins-icon" {...props} />,
  Key: (props: Record<string, unknown>) => <span data-testid="key-icon" {...props} />,
  CreditCard: (props: Record<string, unknown>) => <span data-testid="credit-card-icon" {...props} />,
  Palette: (props: Record<string, unknown>) => <span data-testid="palette-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
}));

describe('SettingsPanel', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Settings heading', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('renders dialog role', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('renders Tokens tab button', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    expect(screen.getByRole('tab', { name: /Tokens/ })).toBeDefined();
  });

  it('renders API Keys tab button', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    expect(screen.getByRole('tab', { name: /API Keys/ })).toBeDefined();
  });

  it('renders Billing tab button', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    expect(screen.getByRole('tab', { name: /Billing/ })).toBeDefined();
  });

  it('renders Appearance tab button', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    expect(screen.getByRole('tab', { name: /Appearance/ })).toBeDefined();
  });

  it('shows TokenDashboard by default', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    expect(screen.getByTestId('token-dashboard')).toBeDefined();
  });

  it('shows ApiKeyManager when API Keys tab clicked', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    fireEvent.click(screen.getByRole('tab', { name: /API Keys/ }));
    expect(screen.getByTestId('api-key-manager')).toBeDefined();
  });

  it('shows BillingTab when Billing tab clicked', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    fireEvent.click(screen.getByRole('tab', { name: /Billing/ }));
    expect(screen.getByTestId('billing-tab')).toBeDefined();
  });

  it('shows AppearanceTab when Appearance tab clicked', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    fireEvent.click(screen.getByRole('tab', { name: /Appearance/ }));
    expect(screen.getByTestId('appearance-tab')).toBeDefined();
  });

  it('calls onClose when X button clicked', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop clicked', () => {
    const { container } = render(<SettingsPanel onClose={mockOnClose} />);
    // The SettingsPanel renders a dialog with a backdrop as its parent container
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement ?? container.firstElementChild;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape key pressed', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('closes on Escape even when a descendant stops propagation', () => {
    // The test above fires on `document` itself, so it passes whether the
    // listener is registered in the capture or the bubble phase — it cannot
    // see the difference, and so cannot hold the fix in place.
    //
    // The difference is not academic. The editor canvas registers its own key
    // handling and is focusable only while the engine is running
    // (`tabIndex={isReady ? 0 : -1}` in CanvasArea), so a bubble-phase document
    // listener could be cut off before it ever ran. That is why this dialog
    // closed reliably in the engine-less UI job and intermittently refused to
    // close in the engine smoke gate (#9586).
    //
    // A modal's Escape must not be defeatable by anything it renders over.
    // Firing from a descendant that stops propagation asserts exactly that:
    // it fails in the bubble phase and passes in the capture phase.
    render(<SettingsPanel onClose={mockOnClose} />);
    const dialog = screen.getByRole('dialog');
    const swallower = document.createElement('div');
    swallower.addEventListener('keydown', (e) => e.stopPropagation());
    dialog.appendChild(swallower);

    fireEvent.keyDown(swallower, { key: 'Escape' });

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('switches to next tab on ArrowRight key', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    // After ArrowRight from 'tokens', active tab is 'keys'
    expect(screen.getByTestId('api-key-manager')).toBeDefined();
  });

  // Sidebar renders this as `{settingsTab && <SettingsPanel initialTab=... />}`,
  // so an already-open panel is UPDATED IN PLACE when the store's tab changes —
  // same position, same type, no remount. `useState(initialTab)` reads the prop
  // once at mount, so without a sync the panel keeps showing the old tab.
  //
  // This is the escape path #9741 restores: a user on `tokens` who hits a
  // blocked capability and clicks the notice's Settings link calls
  // `openSettings('keys')`, and must land on API Keys.
  it('follows initialTab when it changes while the panel is already open', () => {
    const { rerender } = render(<SettingsPanel onClose={mockOnClose} initialTab="tokens" />);
    expect(screen.getByTestId('token-dashboard')).toBeDefined();

    rerender(<SettingsPanel onClose={mockOnClose} initialTab="keys" />);

    expect(screen.getByTestId('api-key-manager')).toBeDefined();
    expect(screen.queryByTestId('token-dashboard')).toBeNull();
  });

  // The sync must be on CHANGE, not on every render, or it would fight the user:
  // a manual tab switch does not move `initialTab`, so a re-render for any other
  // reason must not drag them back to where they entered.
  it('keeps a manually chosen tab across a re-render with the same initialTab', () => {
    const { rerender } = render(<SettingsPanel onClose={mockOnClose} initialTab="tokens" />);
    fireEvent.click(screen.getByRole('tab', { name: /API Keys/i }));
    expect(screen.getByTestId('api-key-manager')).toBeDefined();

    rerender(<SettingsPanel onClose={mockOnClose} initialTab="tokens" />);

    expect(screen.getByTestId('api-key-manager')).toBeDefined();
  });
});
