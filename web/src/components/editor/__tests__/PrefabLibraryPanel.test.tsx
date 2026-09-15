/**
 * Tests for PrefabLibraryPanel — the MANUAL half of the scene.FR-1 prefab
 * instance parity. Asserts each control drives the shared `prefabStore`
 * contract and that a cyclic-reference rejection surfaces its error (matching
 * the AI path in prefabInstanceHandlers.test.ts).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';

const mockListAllPrefabs = vi.fn();
const mockGetPrefabInstances = vi.fn();
const mockCreatePrefabInstance = vi.fn();
const mockAddNestedPrefab = vi.fn();
const mockApplyPrefabToInstances = vi.fn();

vi.mock('@/lib/prefabs/prefabStore', () => ({
  listAllPrefabs: (...a: unknown[]) => mockListAllPrefabs(...a),
  getPrefabInstances: (...a: unknown[]) => mockGetPrefabInstances(...a),
  createPrefabInstance: (...a: unknown[]) => mockCreatePrefabInstance(...a),
  addNestedPrefab: (...a: unknown[]) => mockAddNestedPrefab(...a),
  applyPrefabToInstances: (...a: unknown[]) => mockApplyPrefabToInstances(...a),
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
});
afterEach(() => cleanup());

describe('PrefabLibraryPanel (manual FR-1 control)', () => {
  it('shows an empty state when there are no prefabs', () => {
    mockListAllPrefabs.mockReturnValue([]);
    render(<PrefabLibraryPanel />);
    expect(screen.getByText(/No prefabs yet/)).toBeInTheDocument();
  });

  it('creates a linked instance through the shared store contract (OP-01)', () => {
    mockCreatePrefabInstance.mockReturnValue({ ok: true, value: { instanceId: 'i1', prefabId: 'p1', overrides: {} } });
    render(<PrefabLibraryPanel />);
    fireEvent.click(screen.getByTitle(/Register a linked instance/));
    expect(mockCreatePrefabInstance).toHaveBeenCalledWith('p1');
    expect(mockShowSuccess).toHaveBeenCalled();
  });

  it('reports the create as library bookkeeping, not a scene placement (ineffective-success guard)', () => {
    // createPrefabInstance is called with no entityId, so nothing is spawned in
    // the scene. The toast must say so — a regression to "Created ... in the
    // scene" copy (a success message for an operation with no in-scene effect)
    // fails here, matching #9811's acceptance rule.
    mockCreatePrefabInstance.mockReturnValue({ ok: true, value: { instanceId: 'i1', prefabId: 'p1', overrides: {} } });
    render(<PrefabLibraryPanel />);
    fireEvent.click(screen.getByTitle(/Register a linked instance/));
    const msg = mockShowSuccess.mock.calls[0][0] as string;
    expect(msg).toContain('prefab library');
    expect(msg).not.toMatch(/in the scene|placed|spawned/i);
  });

  it('surfaces a store error when instance creation fails', () => {
    mockCreatePrefabInstance.mockReturnValue({ ok: false, error: 'Prefab not found: p1' });
    render(<PrefabLibraryPanel />);
    fireEvent.click(screen.getByTitle(/Register a linked instance/));
    expect(mockShowError).toHaveBeenCalledWith('Prefab not found: p1');
  });

  it('rejects a cyclic nest with the offending chain shown (OP-02)', () => {
    mockAddNestedPrefab.mockReturnValue({ ok: false, error: 'Cyclic prefab reference rejected: p1 -> p2 -> p1', cycle: ['p1', 'p2', 'p1'] });
    render(<PrefabLibraryPanel />);
    fireEvent.change(screen.getByLabelText('Child prefab to nest'), { target: { value: 'p2' } });
    fireEvent.click(screen.getByText('Nest'));
    expect(mockAddNestedPrefab).toHaveBeenCalledWith('p1', 'p2');
    expect(mockShowError).toHaveBeenCalledWith('Cyclic prefab reference rejected: p1 -> p2 -> p1');
  });

  it('resolves the prefab onto its instances (OP-04)', () => {
    mockApplyPrefabToInstances.mockReturnValue({ ok: true, value: [{ instanceId: 'i1', snapshot: {} }] });
    render(<PrefabLibraryPanel />);
    fireEvent.click(screen.getByTitle(/Resolve how the source prefab/));
    expect(mockApplyPrefabToInstances).toHaveBeenCalledWith('p1');
    // Copy names the resolve, not an in-scene apply — `applyPrefabToInstances`
    // returns resolved snapshots and writes nothing to a scene entity.
    const msg = mockShowSuccess.mock.calls[0][0] as string;
    expect(msg).toContain('Resolved 1 linked instance');
    expect(msg).not.toMatch(/in the scene|applied to the scene/i);
  });

  it('lists linked instances with their overridden fields (OP-03 inspection)', () => {
    mockGetPrefabInstances.mockReturnValue([{ instanceId: 'inst_abc', prefabId: 'p1', overrides: { name: 'x' } }]);
    render(<PrefabLibraryPanel />);
    expect(screen.getByText('inst_abc')).toBeInTheDocument();
    expect(screen.getByText(/overrides: name/)).toBeInTheDocument();
  });
});
