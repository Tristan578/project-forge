/**
 * Render tests for ProfileTab component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ProfileTab } from '../ProfileTab';
import { useUserStore } from '@/stores/userStore';

vi.mock('@/stores/userStore', () => ({
  useUserStore: vi.fn(() => ({})),
}));

vi.mock('@clerk/nextjs', () => ({
  useUser: vi.fn(() => ({ user: null })),
}));

vi.mock('lucide-react', () => ({
  Check: (props: Record<string, unknown>) => <span data-testid="check-icon" {...props} />,
  Pencil: (props: Record<string, unknown>) => <span data-testid="pencil-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
}));

function setupStore(overrides: Record<string, unknown> = {}) {
  const defaults = {
    displayName: 'GameDev123',
    email: 'gamedev@example.com',
    tier: 'hobbyist',
    createdAt: '2024-01-15',
    updateDisplayName: vi.fn().mockResolvedValue(true),
    fetchProfile: vi.fn(),
  };
  const state = { ...defaults, ...overrides };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useUserStore).mockImplementation((selector: any) => {
    return typeof selector === 'function' ? selector(state) : state;
  });
}

describe('ProfileTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Display Name section', () => {
    render(<ProfileTab />);
    expect(screen.getByText('Display Name')).toBeDefined();
  });

  it('renders current display name', () => {
    render(<ProfileTab />);
    expect(screen.getByText('GameDev123')).toBeDefined();
  });

  it('renders Email section', () => {
    render(<ProfileTab />);
    expect(screen.getByText('Email')).toBeDefined();
    expect(screen.getByText('gamedev@example.com')).toBeDefined();
  });

  it('renders Plan section with tier badge', () => {
    render(<ProfileTab />);
    expect(screen.getByText('Plan')).toBeDefined();
    expect(screen.getAllByText(/hobbyist/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders Member Since section', () => {
    render(<ProfileTab />);
    expect(screen.getByText('Member Since')).toBeDefined();
    // Date rendering may shift by timezone — just verify year/month are present
    expect(screen.getByText(/2024/)).toBeDefined();
  });

  it('renders Edit button for display name', () => {
    render(<ProfileTab />);
    expect(screen.getByText('Edit')).toBeDefined();
  });

  it('shows edit input when Edit clicked', () => {
    render(<ProfileTab />);
    fireEvent.click(screen.getByText('Edit'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input).toBeDefined();
    expect(input.value).toBe('GameDev123');
  });

  it('shows character counter when editing', () => {
    render(<ProfileTab />);
    fireEvent.click(screen.getByText('Edit'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'NewName' } });
    expect(screen.getByText('7/50')).toBeDefined();
  });

  it('cancels edit on Cancel click', () => {
    render(<ProfileTab />);
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByLabelText('Cancel'));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('GameDev123')).toBeDefined();
  });

  it('shows Not set when displayName is null', () => {
    setupStore({ displayName: null });
    render(<ProfileTab />);
    expect(screen.getByText('Not set')).toBeDefined();
  });

  it('renders Avatar managed by Clerk message', () => {
    render(<ProfileTab />);
    expect(screen.getByText('Avatar managed by your Clerk account')).toBeDefined();
  });

  it('renders initials avatar fallback when no Clerk image', () => {
    render(<ProfileTab />);
    // Should render 'G' for 'GameDev123'
    expect(screen.getByText('G')).toBeDefined();
  });
});
