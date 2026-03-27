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

  it('switches to next tab on ArrowRight key', () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    // After ArrowRight from 'tokens', active tab is 'keys'
    expect(screen.getByTestId('api-key-manager')).toBeDefined();
  });
});
