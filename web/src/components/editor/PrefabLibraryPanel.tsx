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
 * Scope for this slice: define linked-instance records (with overrides), nest a
 * child prefab (with cycle rejection), inspect each instance's overridden
 * fields, and compute the propagated snapshot a source prefab would apply to its
 * instances. This is LIBRARY bookkeeping only — it does not yet spawn scene
 * entities or write resolved data back onto entities in the viewport, so the
 * controls and their toasts are deliberately worded as library operations, not
 * as scene placement/propagation (the issue's acceptance rejects a success
 * message for an operation with no observable in-scene effect). Scene binding —
 * spawning an entity per instance and writing resolved snapshots onto it —
 * plus variant management and selective per-field apply/revert are tracked on
 * the FR-1 follow-up child issue.
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
      // No scene entity is spawned here (no entityId is passed), so the copy
      // reports the library record it actually created, not a placement that
      // did not happen (the issue rejects a success toast for an ineffective
      // in-scene operation).
      showSuccess(`Registered a linked instance of "${selected?.name ?? selectedId}" in the prefab library`);
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
      // `applyPrefabToInstances` computes the resolved snapshot per instance
      // (source fields with overrides preserved) but writes nothing back onto a
      // scene entity, so the copy describes the resolve, not an in-scene apply.
      showSuccess(
        res.value.length === 0
          ? 'No linked instances to resolve'
          : `Resolved ${res.value.length} linked instance(s) of "${selected?.name ?? selectedId}", preserving overrides`,
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
          title="Register a linked instance of the selected prefab in the library (does not place it in the scene yet)"
        >
          <Link2 size={12} />
          Add Linked Instance
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={!selectedId}
          className="flex items-center gap-1 rounded bg-emerald-900/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-50"
          title="Resolve how the source prefab would propagate onto its instances, preserving overrides (does not write to the scene yet)"
        >
          <RefreshCw size={12} />
          Resolve Instances
        </button>
      </div>

      {/* Out-of-scope note: these are library operations only. Scene placement
          (spawning an entity per instance and writing resolved snapshots onto
          it) is tracked on the FR-1 follow-up child issue. Stated so the copy
          above is not read as a claim that anything changed in the viewport. */}
      <p className="text-[10px] leading-snug text-zinc-500">
        Library bookkeeping only — instances are not placed in the scene yet.
      </p>

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
            No linked instances yet — use Add Linked Instance above.
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
