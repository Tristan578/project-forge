/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@/test/utils/componentTestUtils';
import { EngineCrashOverlay } from '../EngineCrashOverlay';

let capturedListener: ((message: string) => void) | null = null;

const mockOnEngineCrash = vi.fn((listener: (message: string) => void) => {
  capturedListener = listener;
  return mockUnsubscribe;
});
const mockUnsubscribe = vi.fn();
const mockResetEngine = vi.fn();
const mockIsEngineCrashed = vi.fn(() => false);
const mockGetEngineCrashMessage = vi.fn(() => null as string | null);

vi.mock('@/hooks/useEngine', () => ({
  onEngineCrash: (...args: unknown[]) => mockOnEngineCrash(...(args as [(_: string) => void])),
  resetEngine: (...args: unknown[]) => mockResetEngine(...args),
  isEngineCrashed: () => mockIsEngineCrashed(),
  getEngineCrashMessage: () => mockGetEngineCrashMessage(),
}));

vi.mock('lucide-react', () => ({
  AlertTriangle: (props: Record<string, unknown>) => <span data-testid="alert-icon" {...props} />,
  RefreshCw: (props: Record<string, unknown>) => <span data-testid="refresh-icon" {...props} />,
  Save: (props: Record<string, unknown>) => <span data-testid="save-icon" {...props} />,
}));

describe('EngineCrashOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedListener = null;
    Object.defineProperty(window, 'location', { value: { ...window.location, reload: vi.fn() }, writable: true });
  });
  afterEach(() => { cleanup(); });

  it('renders nothing when engine has not crashed', () => {
    const { container } = render(<EngineCrashOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('subscribes to engine crash on mount', () => {
    render(<EngineCrashOverlay />);
    expect(mockOnEngineCrash).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<EngineCrashOverlay />);
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('shows crash dialog when engine crashes', async () => {
    render(<EngineCrashOverlay />);
    expect(screen.queryByText('Engine Crashed')).toBeNull();
    if (capturedListener) capturedListener('panicked at core::slice');
    expect(await screen.findByText('Engine Crashed')).not.toBeNull();
  });

  it('shows Save and Reload buttons', async () => {
    render(<EngineCrashOverlay />);
    if (capturedListener) capturedListener('test panic');
    expect(await screen.findByText('Reload Engine')).not.toBeNull();
    expect(screen.getByText(/Save/)).not.toBeNull();
  });

  it('has correct ARIA attributes', async () => {
    render(<EngineCrashOverlay />);
    if (capturedListener) capturedListener('test panic');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('calls resetEngine and reloads on Reload Engine click', async () => {
    render(<EngineCrashOverlay />);
    if (capturedListener) capturedListener('test panic');
    fireEvent.click(await screen.findByText('Reload Engine'));
    expect(mockResetEngine).toHaveBeenCalled();
    expect(window.location.reload).toHaveBeenCalled();
  });

  it('shows crash dialog immediately if engine already crashed before mount', () => {
    mockIsEngineCrashed.mockReturnValue(true);
    mockGetEngineCrashMessage.mockReturnValue('pre-existing panic');
    render(<EngineCrashOverlay />);
    expect(screen.getByText('Engine Crashed')).not.toBeNull();
    mockIsEngineCrashed.mockReturnValue(false);
    mockGetEngineCrashMessage.mockReturnValue(null);
  });

  it('saves state to localStorage on Save & Refresh click', async () => {
    localStorage.setItem('forge-editor-store', '{"test": true}');
    render(<EngineCrashOverlay />);
    if (capturedListener) capturedListener('test panic');
    fireEvent.click(await screen.findByText(/Save/));
    const backup = localStorage.getItem('forge-editor-crash-backup');
    expect(backup).not.toBeNull();
    const parsed = JSON.parse(backup!);
    expect(parsed.state).toBe('{"test": true}');
    expect(parsed.timestamp).not.toBeUndefined();
    localStorage.removeItem('forge-editor-store');
    localStorage.removeItem('forge-editor-crash-backup');
  });
});
