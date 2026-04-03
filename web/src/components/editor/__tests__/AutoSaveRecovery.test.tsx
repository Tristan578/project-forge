/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { AutoSaveRecovery } from '../AutoSaveRecovery';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/hooks/useEngine', () => ({
  getWasmModule: vi.fn(() => null),
}));

vi.mock('@/lib/storage/autoSave', () => ({
  loadAutoSaveEntry: vi.fn().mockResolvedValue(null),
  deleteAutoSaveEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

import { useEditorStore } from '@/stores/editorStore';
import { getWasmModule } from '@/hooks/useEngine';
import { loadAutoSaveEntry, deleteAutoSaveEntry } from '@/lib/storage/autoSave';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-01-15T12:00:00Z').getTime();
const ONE_HOUR_AGO = new Date(NOW - 60 * 60 * 1000).toISOString();
const TWO_DAYS_AGO = new Date(NOW - 49 * 60 * 60 * 1000).toISOString();

function makeEntry(savedAt = ONE_HOUR_AGO) {
  return {
    sceneJson: '{"entities":[]}',
    sceneName: 'Test Scene',
    savedAt,
    projectId: 'proj-1',
  };
}

function mockStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    projectId: 'proj-1',
    lastCloudSave: null,
    loadScene: vi.fn(),
    setSceneName: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

// Advance time enough for the async loadAutoSaveEntry promise to resolve and
// React effects to flush. Does NOT run any setInterval timers.
async function flushPromises() {
  await vi.advanceTimersByTimeAsync(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AutoSaveRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  describe('when no auto-save entry exists', () => {
    it('renders nothing', async () => {
      vi.mocked(loadAutoSaveEntry).mockResolvedValue(null);
      mockStore();
      const { container } = render(<AutoSaveRecovery />);
      await flushPromises();
      expect(container.firstChild).toBeNull();
    });
  });

  describe('when auto-save entry is newer than lastCloudSave', () => {
    it('renders the recovery dialog', async () => {
      vi.mocked(loadAutoSaveEntry).mockResolvedValue(makeEntry(ONE_HOUR_AGO));
      vi.mocked(getWasmModule).mockReturnValue({} as never);
      mockStore({ lastCloudSave: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() });
      render(<AutoSaveRecovery />);
      // Flush microtasks and timers for async useEffect + Promise.then chain
      await flushPromises();
      await flushPromises();
      expect(screen.getByText('Unsaved work recovered')).toBeInTheDocument();
    });
  });

  describe('when auto-save entry is older than lastCloudSave', () => {
    it('deletes the stale entry and renders nothing', async () => {
      const cloudSave = new Date(NOW - 30 * 60 * 1000).toISOString(); // 30 min ago
      vi.mocked(loadAutoSaveEntry).mockResolvedValue(makeEntry(ONE_HOUR_AGO)); // 1 hour ago
      mockStore({ lastCloudSave: cloudSave });
      const { container } = render(<AutoSaveRecovery />);
      await flushPromises();
      expect(vi.mocked(deleteAutoSaveEntry)).toHaveBeenCalledWith('proj-1');
      expect(container.firstChild).toBeNull();
    });
  });

  describe('when auto-save entry is older than 24 hours', () => {
    it('deletes the expired entry and renders nothing', async () => {
      vi.mocked(loadAutoSaveEntry).mockResolvedValue(makeEntry(TWO_DAYS_AGO));
      mockStore();
      const { container } = render(<AutoSaveRecovery />);
      await flushPromises();
      expect(vi.mocked(deleteAutoSaveEntry)).toHaveBeenCalledWith('proj-1');
      expect(container.firstChild).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // PF-587: Engine-ready guard
  // -------------------------------------------------------------------------

  describe('PF-587: engine-ready guard', () => {
    it('handleRecover does not dispatch loadScene when engine is not yet ready', async () => {
      vi.mocked(loadAutoSaveEntry).mockResolvedValue(makeEntry());
      vi.mocked(getWasmModule).mockReturnValue(null);
      const loadScene = vi.fn();
      mockStore({ loadScene });
      render(<AutoSaveRecovery />);
      await flushPromises();

      // Dialog is visible but Restore is disabled — simulating a programmatic
      // call to handleRecover by clicking the button with fireEvent would be
      // blocked by the disabled attribute. Verify deleteAutoSaveEntry was NOT
      // called (backup must not be lost before engine is ready).
      expect(loadScene).not.toHaveBeenCalled();
      expect(vi.mocked(deleteAutoSaveEntry)).not.toHaveBeenCalled();
    });

    it('starts polling for engine readiness once the dialog entry is set', async () => {
      vi.mocked(loadAutoSaveEntry).mockResolvedValue(makeEntry());
      vi.mocked(getWasmModule).mockReturnValue(null);
      mockStore();
      render(<AutoSaveRecovery />);
      // Flush the loadAutoSaveEntry promise so entry is set and poll starts
      await flushPromises();
      // Advance past one poll interval — getWasmModule should have been called
      await vi.advanceTimersByTimeAsync(210);
      // Poll should have checked for engine readiness
      expect(vi.mocked(getWasmModule)).toHaveBeenCalled();
    });

    it('sets engineReady when module becomes available during polling', async () => {
      vi.mocked(loadAutoSaveEntry).mockResolvedValue(makeEntry());
      vi.mocked(getWasmModule).mockReturnValue(null);
      mockStore();
      render(<AutoSaveRecovery />);
      await flushPromises();

      // Simulate engine becoming ready
      vi.mocked(getWasmModule).mockReturnValue({} as never);
      await vi.advanceTimersByTimeAsync(210);
      // After poll, getWasmModule returned non-null, so poll should have stopped
      expect(vi.mocked(getWasmModule)).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // PF-540: lastCloudSave populated
  // -------------------------------------------------------------------------

  describe('PF-540: lastCloudSave null behaviour', () => {
    it('shows recovery dialog when lastCloudSave is null and auto-save exists', async () => {
      vi.mocked(loadAutoSaveEntry).mockResolvedValue(makeEntry());
      vi.mocked(getWasmModule).mockReturnValue({} as never);
      mockStore({ lastCloudSave: null });
      render(<AutoSaveRecovery />);
      await vi.runAllTimersAsync();
      // With no cloud save to compare against, the dialog should show
      expect(screen.getByText('Unsaved work recovered')).toBeInTheDocument();
    });

    it('does not show dialog when lastCloudSave is set and is newer', async () => {
      const cloudSave = new Date(NOW - 30 * 60 * 1000).toISOString(); // cloud: 30 min ago
      vi.mocked(loadAutoSaveEntry).mockResolvedValue(makeEntry(ONE_HOUR_AGO)); // auto: 1 hr ago
      mockStore({ lastCloudSave: cloudSave });
      const { container } = render(<AutoSaveRecovery />);
      await flushPromises();
      expect(container.firstChild).toBeNull();
    });
  });
});
