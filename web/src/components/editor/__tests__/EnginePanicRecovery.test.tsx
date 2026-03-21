/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@/test/utils/componentTestUtils';
import { EnginePanicRecovery, loadPanicSceneBackup, clearPanicSceneBackup } from '../EnginePanicRecovery';

// --- useEngine mocks ---
let capturedCrashListener: ((message: string) => void) | null = null;
const mockUnsubscribe = vi.fn();
const mockOnEngineCrash = vi.fn((listener: (message: string) => void) => {
  capturedCrashListener = listener;
  return mockUnsubscribe;
});
const mockResetEngine = vi.fn();
const mockIsEngineCrashed = vi.fn(() => false);
const mockGetEngineCrashMessage = vi.fn(() => null as string | null);
const mockGetWasmModule = vi.fn(() => null);

vi.mock('@/hooks/useEngine', () => ({
  onEngineCrash: (...args: unknown[]) => mockOnEngineCrash(...(args as [(_: string) => void])),
  resetEngine: (...args: unknown[]) => mockResetEngine(...args),
  isEngineCrashed: () => mockIsEngineCrashed(),
  getEngineCrashMessage: () => mockGetEngineCrashMessage(),
  getWasmModule: () => mockGetWasmModule(),
}));

// --- storageQuota mock ---
const mockSafeLocalStorageSet = vi.fn((_key: string, _value: string, _protected?: Set<string>) => ({ success: true, evicted: 0 }));
vi.mock('@/lib/storage/storageQuota', () => ({
  safeLocalStorageSet: (key: string, value: string, _protected?: Set<string>) => mockSafeLocalStorageSet(key, value, _protected),
}));

// --- editorStore mock ---
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: (selector: (s: { sceneName: string }) => unknown) =>
    selector({ sceneName: 'Test Scene' }),
}));

// --- lucide-react mock ---
vi.mock('lucide-react', () => ({
  AlertTriangle: (props: Record<string, unknown>) => <span data-testid="alert-icon" {...props} />,
  RefreshCw: (props: Record<string, unknown>) => <span data-testid="refresh-icon" {...props} />,
  Save: (props: Record<string, unknown>) => <span data-testid="save-icon" {...props} />,
  Loader2: (props: Record<string, unknown>) => <span data-testid="loader-icon" {...props} />,
}));

describe('EnginePanicRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Explicitly reset return values so tests don't bleed into each other
    mockIsEngineCrashed.mockReturnValue(false);
    mockGetEngineCrashMessage.mockReturnValue(null);
    capturedCrashListener = null;
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: vi.fn() },
      writable: true,
    });
    localStorage.clear();
    try { sessionStorage.clear(); } catch { /* ignore */ }
  });

  afterEach(() => { cleanup(); });

  // --- Visibility ---
  it('renders nothing when engine has not crashed', () => {
    const { container } = render(<EnginePanicRecovery />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the overlay immediately if engine crashed before mount', () => {
    mockIsEngineCrashed.mockReturnValue(true);
    mockGetEngineCrashMessage.mockReturnValue('panic at the disco');
    render(<EnginePanicRecovery />);
    expect(screen.getByText('Engine Crashed')).toBeDefined();
  });

  it('shows the overlay when a crash event arrives after mount', async () => {
    render(<EnginePanicRecovery />);
    expect(screen.queryByText('Engine Crashed')).toBeNull();
    capturedCrashListener?.('panicked at core::slice');
    expect(await screen.findByText('Engine Crashed')).toBeDefined();
  });

  // --- Subscription lifecycle ---
  it('subscribes to engine crash events on mount', () => {
    render(<EnginePanicRecovery />);
    expect(mockOnEngineCrash).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<EnginePanicRecovery />);
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  // --- ARIA accessibility ---
  it('renders as an alertdialog with aria-modal=true', async () => {
    render(<EnginePanicRecovery />);
    capturedCrashListener?.('panic');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('panic-recovery-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('panic-recovery-desc');
  });

  // --- Buttons ---
  it('shows Save & Refresh and Reload Engine buttons', async () => {
    render(<EnginePanicRecovery />);
    capturedCrashListener?.('panic message');
    expect(await screen.findByText('Save & Refresh')).toBeDefined();
    expect(screen.getByText('Reload Engine')).toBeDefined();
  });

  // --- Reload Engine button ---
  it('calls resetEngine and reloads on Reload Engine click', async () => {
    render(<EnginePanicRecovery />);
    capturedCrashListener?.('panic message');
    fireEvent.click(await screen.findByText('Reload Engine'));
    expect(mockResetEngine).toHaveBeenCalledTimes(1);
    expect(window.location.reload).toHaveBeenCalled();
  });

  // --- Save & Refresh button ---
  it('calls resetEngine and reloads on Save & Refresh click', async () => {
    render(<EnginePanicRecovery />);
    capturedCrashListener?.('panic message');
    fireEvent.click(await screen.findByText('Save & Refresh'));
    await waitFor(() => expect(mockResetEngine).toHaveBeenCalledTimes(1));
    expect(window.location.reload).toHaveBeenCalled();
  });

  it('writes a backup to localStorage on Save & Refresh', async () => {
    localStorage.setItem('forge-editor-store', '{"entities":[]}');
    render(<EnginePanicRecovery />);
    capturedCrashListener?.('panic occurred');
    fireEvent.click(await screen.findByText('Save & Refresh'));
    await waitFor(() => expect(mockSafeLocalStorageSet).toHaveBeenCalled());

    const call = mockSafeLocalStorageSet.mock.calls[0];
    const key = call[0] as string;
    const serialised = call[1] as string;
    expect(key).toBe('forge-editor-panic-scene-backup');
    const parsed = JSON.parse(serialised) as {
      sceneName: string;
      panicMessage: string;
      timestamp: string;
    };
    expect(parsed.sceneName).toBe('Test Scene');
    expect(parsed.panicMessage).toContain('panic occurred');
    expect(parsed.timestamp).toBeDefined();
  });

  // --- Panic message display ---
  it('shows a collapsible "What went wrong?" section with the panic message', async () => {
    render(<EnginePanicRecovery />);
    capturedCrashListener?.('panicked at foo.rs:42');
    await screen.findByText('Engine Crashed');
    expect(screen.getByText(/What went wrong/)).toBeDefined();
  });

  it('truncates very long panic messages', async () => {
    const longMessage = 'x'.repeat(500);
    render(<EnginePanicRecovery />);
    capturedCrashListener?.(longMessage);
    await screen.findByText('Engine Crashed');
    // The ellipsis character is appended for truncated messages
    const pre = document.querySelector('pre');
    expect(pre?.textContent).toContain('\u2026');
  });

  it('does not show "What went wrong?" when crash message is empty', async () => {
    mockIsEngineCrashed.mockReturnValue(true);
    mockGetEngineCrashMessage.mockReturnValue('');
    render(<EnginePanicRecovery />);
    expect(screen.queryByText(/What went wrong/)).toBeNull();
  });
});

// --- Utility function tests ---
describe('loadPanicSceneBackup', () => {
  afterEach(() => { localStorage.clear(); });

  it('returns null when no backup exists', () => {
    expect(loadPanicSceneBackup()).toBeNull();
  });

  it('returns parsed backup when key exists', () => {
    const payload = {
      timestamp: '2026-03-21T00:00:00Z',
      sceneName: 'MyScene',
      sceneJson: '{}',
      panicMessage: 'panic',
    };
    localStorage.setItem('forge-editor-panic-scene-backup', JSON.stringify(payload));
    const result = loadPanicSceneBackup();
    expect(result?.sceneName).toBe('MyScene');
    expect(result?.sceneJson).toBe('{}');
  });

  it('returns null when stored value is malformed JSON', () => {
    localStorage.setItem('forge-editor-panic-scene-backup', '{not-json}');
    expect(loadPanicSceneBackup()).toBeNull();
  });
});

describe('clearPanicSceneBackup', () => {
  it('removes the backup key', () => {
    localStorage.setItem('forge-editor-panic-scene-backup', '{}');
    clearPanicSceneBackup();
    expect(localStorage.getItem('forge-editor-panic-scene-backup')).toBeNull();
  });

  it('does not throw when key does not exist', () => {
    expect(() => clearPanicSceneBackup()).not.toThrow();
  });
});
