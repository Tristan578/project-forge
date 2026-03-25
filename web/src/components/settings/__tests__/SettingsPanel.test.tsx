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

vi.mock('lucide-react', () => ({
  Settings: (props: Record<string, unknown>) => <span data-testid="settings-icon" {...props} />,
  Coins: (props: Record<string, unknown>) => <span data-testid="coins-icon" {...props} />,
  Key: (props: Record<string, unknown>) => <span data-testid="key-icon" {...props} />,
  CreditCard: (props: Record<string, unknown>) => <span data-testid="credit-card-icon" {...props} />,
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
    expect(screen.getByText('Settings')).not.toBeNull();
  });

  it('renders dialog role', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    expect(screen.getByRole('dialog')).not.toBeNull();
  });

  it('renders Tokens tab button', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    expect(screen.getByRole('tab', { name: /Tokens/ })).not.toBeNull();
  });

  it('renders API Keys tab button', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    expect(screen.getByRole('tab', { name: /API Keys/ })).not.toBeNull();
  });

  it('renders Billing tab button', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    expect(screen.getByRole('tab', { name: /Billing/ })).not.toBeNull();
  });

  it('shows TokenDashboard by default', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    expect(screen.getByTestId('token-dashboard')).not.toBeNull();
  });

  it('shows ApiKeyManager when API Keys tab clicked', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    fireEvent.click(screen.getByRole('tab', { name: /API Keys/ }));
    expect(screen.getByTestId('api-key-manager')).not.toBeNull();
  });

  it('shows BillingTab when Billing tab clicked', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    fireEvent.click(screen.getByRole('tab', { name: /Billing/ }));
    expect(screen.getByTestId('billing-tab')).not.toBeNull();
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

  it('switches to next tab on ArrowRight key', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    // After ArrowRight from 'tokens', active tab is 'keys'
    expect(screen.getByTestId('api-key-manager')).not.toBeNull();
  });
});
