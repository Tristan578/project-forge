/**
 * Render tests for AccountTab component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock('@clerk/nextjs', () => ({
  useClerk: vi.fn(() => ({ signOut: vi.fn() })),
}));

vi.mock('lucide-react', () => ({
  AlertTriangle: (props: Record<string, unknown>) => <span data-testid="alert-triangle-icon" {...props} />,
}));

import { AccountTab } from '../AccountTab';

describe('AccountTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Danger Zone heading', () => {
    render(<AccountTab />);
    expect(screen.getByText('Danger Zone')).toBeDefined();
  });

  it('renders warning message about deletion', () => {
    render(<AccountTab />);
    expect(screen.getByText(/Permanently delete your account/)).toBeDefined();
  });

  it('renders Delete Account button initially', () => {
    render(<AccountTab />);
    expect(screen.getByText('Delete Account')).toBeDefined();
  });

  it('shows confirmation form when Delete Account clicked', () => {
    render(<AccountTab />);
    fireEvent.click(screen.getByText('Delete Account'));
    expect(screen.getByText(/Type/)).toBeDefined();
    expect(screen.getByPlaceholderText('Type DELETE')).toBeDefined();
  });

  it('shows Permanently Delete button (disabled) in confirmation state', () => {
    render(<AccountTab />);
    fireEvent.click(screen.getByText('Delete Account'));
    const deleteBtn = screen.getByText('Permanently Delete') as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(true);
  });

  it('enables Permanently Delete when DELETE typed', () => {
    render(<AccountTab />);
    fireEvent.click(screen.getByText('Delete Account'));
    const input = screen.getByPlaceholderText('Type DELETE') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'DELETE' } });
    const deleteBtn = screen.getByText('Permanently Delete') as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(false);
  });

  it('shows Cancel button in confirmation state', () => {
    render(<AccountTab />);
    fireEvent.click(screen.getByText('Delete Account'));
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('hides confirmation form when Cancel clicked', () => {
    render(<AccountTab />);
    fireEvent.click(screen.getByText('Delete Account'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('Type DELETE')).toBeNull();
    expect(screen.getByText('Delete Account')).toBeDefined();
  });

  it('renders This action cannot be undone warning', () => {
    render(<AccountTab />);
    expect(screen.getByText('This action cannot be undone.')).toBeDefined();
  });
});
