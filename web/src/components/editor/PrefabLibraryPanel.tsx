'use client';

/** Read-only inspection of saved prefab link metadata until engine integration ships (#9811). */
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Button, Card, Select } from '@spawnforge/ui';
import { Boxes } from 'lucide-react';
import {
  listAllPrefabs,
  getPrefabInstances,
  subscribeToPrefabChanges,
  type PrefabInstance,
} from '@/lib/prefabs/prefabStore';
import { getOverriddenFields } from '@/lib/prefabs/prefabInstance';

/** Show saved link identity and the fields with explicit overrides. */
function InstanceRow({ instance }: { instance: PrefabInstance }) {
  const overridden = getOverriddenFields(instance);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--sf-border)] bg-[var(--sf-bg-surface)] px-2 py-1 text-xs">
      <span className="truncate font-mono text-[var(--sf-text-secondary)]" title={instance.instanceId}>
        {instance.instanceId}
      </span>
      <span className="text-[var(--sf-text-secondary)]">
        {overridden.length === 0 ? 'no overrides' : `overrides: ${overridden.join(', ')}`}
      </span>
    </li>
  );
}

/** Inspect saved prefab metadata; linked scene mutations remain visibly unavailable. */
export function PrefabLibraryPanel() {
  const sourceId = useId();
  const availabilityId = useId();
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
        <Card className="w-full border-dashed text-center">
          <div className="flex flex-col items-center gap-3">
            <Boxes size={28} className="text-[var(--sf-text-secondary)]" aria-hidden="true" />
            <div className="space-y-1">
              <h3 className="text-sm font-medium">No prefabs yet</h3>
              <p className="text-xs text-[var(--sf-text-secondary)]">
                Save an entity as a prefab to reuse it as an independent copy.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-2 text-[var(--sf-text-secondary)]">
      <div className="flex flex-col gap-1 text-xs">
        <label htmlFor={sourceId}>Source prefab</label>
        <Select
          className="min-h-[44px] sm:min-h-0"
          id={sourceId}
          value={selectedId}
          onChange={(event) => setSelection(event.target.value)}
          options={prefabs.map((prefab) => ({
            value: prefab.id,
            label: `${prefab.name} (${prefab.category})`,
          }))}
        />
      </div>
      <p id={availabilityId} className="text-xs leading-snug text-[var(--sf-text-secondary)]">
        Linked placement, nesting, and propagation are not available yet. Existing prefabs can still be placed as independent copies.
      </p>
      <div className="flex flex-wrap gap-2" aria-describedby={availabilityId}>
        {['Add Linked Instance', 'Nest', 'Apply to Instances'].map((label) => (
          <Button
            key={label}
            type="button"
            disabled
            aria-describedby={availabilityId}
            title="Linked prefab editing is not available yet"
            variant="outline"
            size="sm"
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs">Saved links ({instances.length})</span>
        <p className="text-xs text-[var(--sf-text-secondary)]">Saved links describe prefab metadata; they do not confirm that an entity is placed in the scene.</p>
        {instances.length === 0 ? (
          <p className="text-xs text-[var(--sf-text-secondary)]">No saved links for this prefab.</p>
        ) : (
          <ul className="flex flex-col gap-1">{instances.map((instance) => <InstanceRow key={instance.instanceId} instance={instance} />)}</ul>
        )}
      </div>
    </div>
  );
}
