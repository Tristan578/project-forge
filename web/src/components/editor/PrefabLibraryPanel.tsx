'use client';

/**
 * Manual editor control for nested / linked prefab instances (scene.FR-1).
 *
 * This is the MANUAL half of the FR-1 F2 parity requirement: every action here
 * calls the SAME `prefabStore` instance functions the in-app AI commands
 * (`create_prefab_instance`, `nest_prefab`, `apply_prefab_to_instances`,
 * `list_prefab_instances` in `gameplayHandlers.ts`) call, so the two entry
 * points share one validated operation/data contract. Nothing about override
 * tracking, cycle detection or propagation is re-implemented in the UI — it
 * only presents the store's results and surfaces its errors (a cyclic reference
 * comes back with the offending chain, shown verbatim).
 *
 * Scope for this slice: create/instantiate linked instances, nest a child
 * prefab (with cycle rejection), inspect each instance's overridden fields, and
 * apply a source prefab onto its instances. Variant management, selective
 * per-field apply/revert, and the richer override-inspection surface are
 * tracked on the FR-1 follow-up child issue.
 */

import { useCallback, useMemo, useState } from 'react';
import { Boxes, Link2, RefreshCw, Layers } from 'lucide-react';
import {
  listAllPrefabs,
  getPrefabInstances,
  createPrefabInstance,
  addNestedPrefab,
  applyPrefabToInstances,
  type Prefab,
  type PrefabInstance,
} from '@/lib/prefabs/prefabStore';
import { getOverriddenFields } from '@/lib/prefabs/prefabInstance';
import { showError, showSuccess } from '@/lib/toast';
import { EmptyState } from '@/components/ui/EmptyState';

/** One linked instance row, showing the fields it overrides (OP-03 inspection). */
function InstanceRow({ instance }: { instance: PrefabInstance }) {
  const overridden = getOverriddenFields(instance);
  return (
    <li className="flex items-center justify-between gap-2 rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs">
      <span className="truncate font-mono text-[10px] text-zinc-400" title={instance.instanceId}>
        {instance.instanceId}
      </span>
      <span className="shrink-0 text-[10px] text-zinc-400">
        {overridden.length === 0
          ? 'no overrides'
          : `overrides: ${overridden.join(', ')}`}
      </span>
    </li>
  );
}

export function PrefabLibraryPanel() {
  const prefabs = useMemo(() => listAllPrefabs(), []);
  const [selectedId, setSelectedId] = useState<string>(() => prefabs[0]?.id ?? '');
  const [childId, setChildId] = useState<string>('');
  // The store (localStorage) is the source of truth. Bumping `revision` after a
  // mutating call re-reads it below; `revision` is a genuine input to the memo,
  // not an effect, so the list stays a pure derivation of store + selection.
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);

  const instances = useMemo<PrefabInstance[]>(() => {
    void revision; // re-read whenever a mutation bumps the revision
    return selectedId ? getPrefabInstances(selectedId) : [];
  }, [selectedId, revision]);

  const selected: Prefab | undefined = useMemo(
    () => prefabs.find((p) => p.id === selectedId),
    [prefabs, selectedId],
  );

  const handleCreateInstance = useCallback(() => {
    if (!selectedId) return;
    const res = createPrefabInstance(selectedId);
    if (res.ok) {
      showSuccess(`Created linked instance of "${selected?.name ?? selectedId}"`);
      refresh();
    } else {
      showError(res.error);
    }
  }, [selectedId, selected, refresh]);

  const handleNest = useCallback(() => {
    if (!selectedId || !childId) return;
    const res = addNestedPrefab(selectedId, childId);
    if (res.ok) {
      showSuccess(`Nested "${childId}" inside "${selected?.name ?? selectedId}"`);
      setChildId('');
      refresh();
    } else {
      // A cyclic reference is rejected WITH the offending chain and no mutation;
      // show it so the manual path recovers exactly as the AI path does.
      showError(res.error);
    }
  }, [selectedId, childId, selected, refresh]);

  const handleApply = useCallback(() => {
    if (!selectedId) return;
    const res = applyPrefabToInstances(selectedId);
    if (res.ok) {
      showSuccess(
        res.value.length === 0
          ? 'No linked instances to update'
          : `Applied "${selected?.name ?? selectedId}" to ${res.value.length} instance(s)`,
      );
      refresh();
    } else {
      showError(res.error);
    }
  }, [selectedId, selected, refresh]);

  if (prefabs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <EmptyState
          icon={Boxes}
          title="No prefabs yet"
          description="Save an entity as a prefab first, then create linked instances and nest prefabs here."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-2 text-zinc-300">
      {/* Source prefab picker */}
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-zinc-400">Source prefab</span>
        <select
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          aria-label="Source prefab"
        >
          {prefabs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.category})
            </option>
          ))}
        </select>
      </label>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleCreateInstance}
          disabled={!selectedId}
          className="flex items-center gap-1 rounded bg-blue-900/40 px-2 py-1 text-xs text-blue-300 hover:bg-blue-900/60 disabled:cursor-not-allowed disabled:opacity-50"
          title="Create a linked instance of the selected prefab"
        >
          <Link2 size={12} />
          Create Instance
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={!selectedId}
          className="flex items-center gap-1 rounded bg-emerald-900/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-50"
          title="Propagate the prefab onto its instances, preserving overrides"
        >
          <RefreshCw size={12} />
          Apply to Instances
        </button>
      </div>

      {/* Nest a child prefab */}
      <div className="flex flex-col gap-1 rounded border border-zinc-800 p-2">
        <span className="flex items-center gap-1 text-xs text-zinc-400">
          <Layers size={12} /> Nest a prefab
        </span>
        <div className="flex gap-2">
          <select
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
            value={childId}
            onChange={(e) => setChildId(e.target.value)}
            aria-label="Child prefab to nest"
          >
            <option value="">Select a child prefab…</option>
            {prefabs
              .filter((p) => p.id !== selectedId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            onClick={handleNest}
            disabled={!selectedId || !childId}
            className="shrink-0 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
            title="Nest the selected child prefab inside the source prefab"
          >
            Nest
          </button>
        </div>
      </div>

      {/* Linked instances + override inspection */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-zinc-400">
          Linked instances ({instances.length})
        </span>
        {instances.length === 0 ? (
          <p className="text-[10px] text-zinc-500">
            No linked instances yet — use Create Instance above.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {instances.map((inst) => (
              <InstanceRow key={inst.instanceId} instance={inst} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
