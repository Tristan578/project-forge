/** Read-only prefab inspection and unavailable scene controls.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@/test/utils/componentTestUtils';

const mockListAllPrefabs = vi.fn();
const mockGetPrefabInstances = vi.fn();
const mockCreatePrefabInstance = vi.fn();
const mockAddNestedPrefab = vi.fn();
const mockApplyPrefabToInstances = vi.fn();
// scene.FR-1 N1: captures the listener the panel subscribes with, so a test
// can simulate an EXTERNAL mutation (a chat command, another mounted panel)
// notifying it — not just the panel's own local `refresh()` calls.
let externalChangeListeners: Array<() => void> = [];

vi.mock('@/lib/prefabs/prefabStore', () => ({
  listAllPrefabs: (...a: unknown[]) => mockListAllPrefabs(...a),
  getPrefabInstances: (...a: unknown[]) => mockGetPrefabInstances(...a),
  createPrefabInstance: (...a: unknown[]) => mockCreatePrefabInstance(...a),
  addNestedPrefab: (...a: unknown[]) => mockAddNestedPrefab(...a),
  applyPrefabToInstances: (...a: unknown[]) => mockApplyPrefabToInstances(...a),
  subscribeToPrefabChanges: (listener: () => void) => {
    externalChangeListeners.push(listener);
    return () => {
      externalChangeListeners = externalChangeListeners.filter((l) => l !== listener);
    };
  },
}));

vi.mock('@/lib/prefabs/prefabInstance', () => ({
  getOverriddenFields: (inst: { overrides: Record<string, unknown> }) => Object.keys(inst.overrides ?? {}),
}));

const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();
vi.mock('@/lib/toast', () => ({
  showError: (...a: unknown[]) => mockShowError(...a),
  showSuccess: (...a: unknown[]) => mockShowSuccess(...a),
}));

import { PrefabLibraryPanel } from '../PrefabLibraryPanel';

const PREFABS = [
  { id: 'p1', name: 'Crate', category: 'props' },
  { id: 'p2', name: 'Barrel', category: 'props' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockListAllPrefabs.mockReturnValue(PREFABS);
  mockGetPrefabInstances.mockReturnValue([]);
  externalChangeListeners = [];
});
afterEach(() => cleanup());

describe('PrefabLibraryPanel (manual FR-1 control)', () => {
  it('shows an empty state when there are no prefabs', () => {
    mockListAllPrefabs.mockReturnValue([]);
    render(<PrefabLibraryPanel />);
    expect(screen.getByText(/No prefabs yet/)).toBeInTheDocument();
  });

  it('disables every unavailable scene action without mutating the library or showing success', () => {
    render(<PrefabLibraryPanel />);
    for (const name of ['Add Linked Instance', 'Nest', 'Apply to Instances']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription(/not available yet/);
      fireEvent.click(button);
    }
    expect(mockCreatePrefabInstance).not.toHaveBeenCalled();
    expect(mockAddNestedPrefab).not.toHaveBeenCalled();
    expect(mockApplyPrefabToInstances).not.toHaveBeenCalled();
    expect(mockShowSuccess).not.toHaveBeenCalled();
    expect(screen.getByText(/independent copies/)).toBeInTheDocument();
  });

  it('lists linked instances with their overridden fields (OP-03 inspection)', () => {
    mockGetPrefabInstances.mockReturnValue([{ instanceId: 'inst_abc', prefabId: 'p1', overrides: { name: 'x' } }]);
    render(<PrefabLibraryPanel />);
    expect(screen.getByText('inst_abc')).toBeInTheDocument();
    expect(screen.getByText(/overrides: name/)).toBeInTheDocument();
  });

  // scene.FR-1 N1: the library used to be memoized once at mount with an empty
  // dependency array, so a prefab created/deleted/imported through a DIFFERENT
  // entry point (chat, another mounted panel) never appeared here until the
  // component remounted. Subscribing to the store's change notification closes
  // that gap.
  it('re-reads the library when an EXTERNAL mutation notifies it, without a remount', () => {
    render(<PrefabLibraryPanel />);
    expect(screen.queryAllByRole('option', { name: /Explosive Barrel/ })).toHaveLength(0);
    expect(mockListAllPrefabs).toHaveBeenCalledTimes(1);

    // A prefab was created/imported via chat while this panel stayed mounted.
    mockListAllPrefabs.mockReturnValue([...PREFABS, { id: 'p3', name: 'Explosive Barrel', category: 'props' }]);
    expect(externalChangeListeners.length).toBeGreaterThan(0);
    act(() => {
      for (const listener of externalChangeListeners) listener();
    });

    expect(mockListAllPrefabs).toHaveBeenCalledTimes(2);
    // The source picker refreshes without remounting.
    expect(screen.getAllByRole('option', { name: /Explosive Barrel/ }).length).toBeGreaterThan(0);
  });

  it('selects a remaining source when the selected prefab is deleted externally', () => {
    render(<PrefabLibraryPanel />);
    fireEvent.change(screen.getByLabelText('Source prefab'), { target: { value: 'p2' } });
    mockListAllPrefabs.mockReturnValue([PREFABS[0]]);
    act(() => externalChangeListeners.forEach((listener) => listener()));
    expect(screen.getByLabelText('Source prefab')).toHaveValue('p1');
    expect(mockGetPrefabInstances).toHaveBeenLastCalledWith('p1');
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<PrefabLibraryPanel />);
    expect(externalChangeListeners.length).toBe(1);
    unmount();
    expect(externalChangeListeners.length).toBe(0);
  });
});
