'use client';

/** Read-only inspection of saved prefab link metadata until engine integration ships (#9811). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes } from 'lucide-react';
import {
  listAllPrefabs,
  getPrefabInstances,
  subscribeToPrefabChanges,
  type PrefabInstance,
} from '@/lib/prefabs/prefabStore';
import { getOverriddenFields } from '@/lib/prefabs/prefabInstance';
import { EmptyState } from '@/components/ui/EmptyState';

/** Show saved link identity and the fields with explicit overrides. */
function InstanceRow({ instance }: { instance: PrefabInstance }) {
  const overridden = getOverriddenFields(instance);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs">
      <span className="truncate font-mono text-zinc-300" title={instance.instanceId}>
        {instance.instanceId}
      </span>
      <span className="text-zinc-300">
        {overridden.length === 0 ? 'no overrides' : `overrides: ${overridden.join(', ')}`}
      </span>
    </li>
  );
}

/** Inspect saved prefab metadata; linked scene mutations remain visibly unavailable. */
export function PrefabLibraryPanel() {
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => subscribeToPrefabChanges(refresh), [refresh]);
  const prefabs = useMemo(() => {
    void revision;
    return listAllPrefabs();
  }, [revision]);
  const [selection, setSelection] = useState('');
  // A deletion must also remove the stale selection, including its link rows.
  const selectedId = prefabs.find((prefab) => prefab.id === selection)?.id ?? prefabs[0]?.id ?? '';
  const instances = useMemo(() => {
    void revision;
    return selectedId ? getPrefabInstances(selectedId) : [];
  }, [revision, selectedId]);

  if (prefabs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <EmptyState icon={Boxes} title="No prefabs yet" description="Save an entity as a prefab to reuse it as an independent copy." />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-2 text-zinc-300">
      <label className="flex flex-col gap-1 text-xs">
        <span>Source prefab</span>
        <select
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:ring-2 focus:ring-blue-500"
          value={selectedId}
          onChange={(event) => setSelection(event.target.value)}
          aria-label="Source prefab"
        >
          {prefabs.map((prefab) => (
            <option key={prefab.id} value={prefab.id}>{prefab.name} ({prefab.category})</option>
          ))}
        </select>
      </label>
      <p id="linked-prefab-availability" className="text-xs leading-snug text-zinc-300">
        Linked placement, nesting, and propagation are not available yet. Existing prefabs can still be placed as independent copies.
      </p>
      <div className="flex flex-wrap gap-2" aria-describedby="linked-prefab-availability">
        {['Add Linked Instance', 'Nest', 'Apply to Instances'].map((label) => (
          <button
            key={label}
            type="button"
            disabled
            aria-describedby="linked-prefab-availability"
            title="Linked prefab editing is not available yet"
            className="cursor-not-allowed rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-400"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs">Saved links ({instances.length})</span>
        <p className="text-xs text-zinc-300">Saved links describe prefab metadata; they do not confirm that an entity is placed in the scene.</p>
        {instances.length === 0 ? (
          <p className="text-xs text-zinc-300">No saved links for this prefab.</p>
        ) : (
          <ul className="flex flex-col gap-1">{instances.map((instance) => <InstanceRow key={instance.instanceId} instance={instance} />)}</ul>
        )}
      </div>
    </div>
  );
}
