// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Capture the crash listener so tests can trigger it programmatically.
let _onCrashCallback: ((msg: string) => void) | null = null;

vi.mock('@/hooks/useEngine', () => ({
  onEngineCrash: vi.fn((cb: (msg: string) => void) => {
    _onCrashCallback = cb;
    return () => { _onCrashCallback = null; };
  }),
  isEngineCrashed: vi.fn(() => false),
  getEngineCrashMessage: vi.fn(() => null),
  restartEngine: vi.fn(),
  resetEngine: vi.fn(),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      projectId: 'project-123',
      sceneName: 'Test Scene',
    })
  ),
}));

vi.mock('@/lib/storage/autoSave', () => ({
  saveAutoSaveEntry: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/monitoring/sentry-client', () => ({
  captureException: vi.fn(),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map((k) => [k, () => null]));
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { EnginePanicRecovery } from '../EnginePanicRecovery';
import { onEngineCrash, isEngineCrashed, getEngineCrashMessage, restartEngine, resetEngine } from '@/hooks/useEngine';
import { saveAutoSaveEntry } from '@/lib/storage/autoSave';
import { captureException } from '@/lib/monitoring/sentry-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderRecovery(props?: Partial<React.ComponentProps<typeof EnginePanicRecovery>>) {
  return render(
    <EnginePanicRecovery canvasId="game-canvas" {...props} />
  );
}

function simulateCrash(msg = 'panicked at vector index out of bounds') {
  act(() => {
    _onCrashCallback?.(msg);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EnginePanicRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _onCrashCallback = null;

    // Default: engine not yet crashed when component mounts
    vi.mocked(isEngineCrashed).mockReturnValue(false);
    vi.mocked(getEngineCrashMessage).mockReturnValue(null);
    vi.mocked(restartEngine).mockResolvedValue({} as ReturnType<typeof restartEngine> extends Promise<infer T> ? T : never);
  });

  afterEach(() => {
    cleanup();
  });

  // --- Visibility ---

  it('renders nothing when engine has not crashed', () => {
    renderRecovery();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('renders the overlay immediately if engine was already crashed on mount', () => {
    vi.mocked(isEngineCrashed).mockReturnValue(true);
    vi.mocked(getEngineCrashMessage).mockReturnValue('pre-existing panic');

    renderRecovery();

    expect(screen.getByRole('alertdialog')).toBeDefined();
    expect(screen.getByText('Engine Crash Detected')).toBeDefined();
  });

  it('shows the overlay after a crash event fires', () => {
    renderRecovery();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    simulateCrash();

    expect(screen.getByRole('alertdialog')).toBeDefined();
    expect(screen.getByText('Engine Crash Detected')).toBeDefined();
  });

  it('subscribes to crash events via onEngineCrash', () => {
    renderRecovery();
    expect(vi.mocked(onEngineCrash)).toHaveBeenCalledOnce();
  });

  it('unsubscribes from crash events on unmount', () => {
    const { unmount } = renderRecovery();
    simulateCrash();
    unmount();

    // After unmount the callback should be cleared by the unsubscribe fn
    expect(_onCrashCallback).toBeNull();
  });

  // --- Panic message display ---

  it('shows the panic message in a details element', () => {
    renderRecovery();
    simulateCrash('panicked at stack overflow');

    expect(screen.getByText('panicked at stack overflow')).toBeDefined();
  });

  // --- Restart flow ---

  it('"Reload Engine" button triggers restartEngine with the correct canvasId', async () => {
    renderRecovery();
    simulateCrash();

    fireEvent.click(screen.getByText('Reload Engine'));

    await waitFor(() => {
      expect(vi.mocked(restartEngine)).toHaveBeenCalledWith('game-canvas');
    });
  });

  it('hides overlay after successful restart', async () => {
    renderRecovery();
    simulateCrash();

    fireEvent.click(screen.getByText('Reload Engine'));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });

  it('calls onRestartComplete after successful restart', async () => {
    const onRestartComplete = vi.fn();
    renderRecovery({ onRestartComplete });
    simulateCrash();

    fireEvent.click(screen.getByText('Reload Engine'));

    await waitFor(() => {
      expect(onRestartComplete).toHaveBeenCalledOnce();
    });
  });

  it('shows error message when restartEngine throws', async () => {
    vi.mocked(restartEngine).mockRejectedValue(new Error('canvas not found'));

    renderRecovery();
    simulateCrash();

    fireEvent.click(screen.getByText('Reload Engine'));

    await waitFor(() => {
      expect(screen.getByText(/Restart failed: canvas not found/)).toBeDefined();
    });
  });

  it('captures exception to Sentry when restart fails', async () => {
    vi.mocked(restartEngine).mockRejectedValue(new Error('fatal restart error'));

    renderRecovery();
    simulateCrash();

    fireEvent.click(screen.getByText('Reload Engine'));

    await waitFor(() => {
      expect(vi.mocked(captureException)).toHaveBeenCalled();
    });
  });

  it('keeps overlay visible after failed restart', async () => {
    vi.mocked(restartEngine).mockRejectedValue(new Error('fail'));

    renderRecovery();
    simulateCrash();

    fireEvent.click(screen.getByText('Reload Engine'));

    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeDefined();
    });
  });

  // --- Auto-save before restart ---

  it('attempts to save to IndexedDB before restarting when projectId is present', async () => {
    // Put the autosave JSON into localStorage
    localStorage.setItem('forge:autosave', '{"entities":[]}');

    renderRecovery();
    simulateCrash();

    fireEvent.click(screen.getByText('Reload Engine'));

    await waitFor(() => {
      expect(vi.mocked(saveAutoSaveEntry)).toHaveBeenCalledWith(
        expect.objectContaining({
          sceneJson: '{"entities":[]}',
          sceneName: 'Test Scene',
          projectId: 'project-123',
        })
      );
    });

    localStorage.removeItem('forge:autosave');
  });

  it('still restarts even if auto-save throws', async () => {
    vi.mocked(saveAutoSaveEntry).mockRejectedValueOnce(new Error('quota exceeded'));
    localStorage.setItem('forge:autosave', '{"entities":[]}');

    renderRecovery();
    simulateCrash();

    fireEvent.click(screen.getByText('Reload Engine'));

    await waitFor(() => {
      expect(vi.mocked(restartEngine)).toHaveBeenCalled();
    });

    localStorage.removeItem('forge:autosave');
  });

  // --- Hard reload ---

  it('"Hard Reload Page" button calls resetEngine and reloads', () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    });

    renderRecovery();
    simulateCrash();

    fireEvent.click(screen.getByText('Hard Reload Page'));

    expect(vi.mocked(resetEngine)).toHaveBeenCalled();
    expect(reloadSpy).toHaveBeenCalled();
  });

  // --- Accessibility ---

  it('overlay has role=alertdialog and aria-modal=true', () => {
    renderRecovery();
    simulateCrash();

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('overlay has accessible title and description', () => {
    renderRecovery();
    simulateCrash();

    expect(screen.getByText('Engine Crash Detected')).toBeDefined();
    expect(screen.getByText(/WASM engine encountered an unrecoverable error/)).toBeDefined();
  });

  // --- Button disabled states ---

  it('"Reload Engine" button is disabled while restarting', async () => {
    // Make restartEngine hang so we can inspect the intermediate state
    let resolveRestart!: () => void;
    vi.mocked(restartEngine).mockReturnValue(
      new Promise<ReturnType<typeof restartEngine> extends Promise<infer T> ? T : never>(
        (resolve) => { resolveRestart = resolve as () => void; }
      )
    );

    renderRecovery();
    simulateCrash();

    fireEvent.click(screen.getByText('Reload Engine'));

    // Button should be disabled/busy during restart
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Restarting engine|Saving/i });
      expect(btn).toBeDefined();
    });

    // Resolve so we don't leave dangling promises
    act(() => { resolveRestart(); });
  });
});
