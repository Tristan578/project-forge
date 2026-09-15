'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, X, Keyboard } from 'lucide-react';
import { useEditorStore, type InputBinding } from '@/stores/editorStore';

const PRESETS = [
  { value: '', label: 'Custom' },
  { value: 'fps', label: 'FPS' },
  { value: 'platformer', label: 'Platformer' },
  { value: 'topdown', label: 'Top-Down' },
  { value: 'racing', label: 'Racing' },
] as const;

/** Pretty-print a browser event.code string. */
function formatKeyCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
}

export function InputBindingsPanel() {
  const inputBindings = useEditorStore((s) => s.inputBindings);
  const inputPresetByPlayer = useEditorStore((s) => s.inputPresetByPlayer);
  const engineMode = useEditorStore((s) => s.engineMode);
  const setInputPreset = useEditorStore((s) => s.setInputPreset);
  const setInputBinding = useEditorStore((s) => s.setInputBinding);
  const removeInputBinding = useEditorStore((s) => s.removeInputBinding);

  const [collapsed, setCollapsed] = useState(true);
  // Which local player's map is being authored (0 = Player 1, 1 = Player 2).
  // Two local players each get an independently editable action map
  // (physics.FR-1.OP-04); this selector picks the slot every control below
  // reads and writes.
  const [selectedPlayer, setSelectedPlayer] = useState(0);
  const [rebindTarget, setRebindTarget] = useState<{
    actionName: string;
    field: 'sources' | 'positiveKeys' | 'negativeKeys';
  } | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newActionName, setNewActionName] = useState('');
  const [newActionType, setNewActionType] = useState<'digital' | 'axis'>('digital');

  // Only the selected player's bindings are shown and edited. A binding with no
  // `player` field is Player 1 (slot 0), so a single-player scene renders exactly
  // as before.
  const playerBindings = inputBindings.filter((b) => (b.player ?? 0) === selectedPlayer);

  // Listen for keydown when rebinding
  useEffect(() => {
    if (!rebindTarget) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const code = e.code;
      if (code === 'Escape') {
        setRebindTarget(null);
        return;
      }

      // Find the binding within the SELECTED player's slot — player 2's action
      // of the same name is a different row and must not be caught here.
      const binding = inputBindings.find(
        (b) => b.actionName === rebindTarget.actionName && (b.player ?? 0) === selectedPlayer,
      );
      if (!binding) {
        setRebindTarget(null);
        return;
      }

      const updated: InputBinding = { ...binding, player: selectedPlayer };
      if (rebindTarget.field === 'sources') {
        updated.sources = [code];
      } else if (rebindTarget.field === 'positiveKeys') {
        updated.positiveKeys = [code];
      } else {
        updated.negativeKeys = [code];
      }

      setInputBinding(updated);
      setRebindTarget(null);
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [rebindTarget, inputBindings, setInputBinding, selectedPlayer]);

  const handlePresetChange = useCallback(
    (value: string) => {
      if (value && value !== '') {
        setInputPreset(value as 'fps' | 'platformer' | 'topdown' | 'racing', selectedPlayer);
      }
    },
    [setInputPreset, selectedPlayer]
  );

  const handleAddAction = useCallback(() => {
    if (!newActionName.trim()) return;

    const binding: InputBinding = {
      actionName: newActionName.trim(),
      actionType: newActionType,
      sources: [],
      positiveKeys: newActionType === 'axis' ? [] : undefined,
      negativeKeys: newActionType === 'axis' ? [] : undefined,
      player: selectedPlayer,
    };

    setInputBinding(binding);
    setNewActionName('');
    setAddingNew(false);
  }, [newActionName, newActionType, setInputBinding, selectedPlayer]);

  // Don't allow rebinding during Play mode
  const isEditing = engineMode === 'edit';

  return (
    <div className="border-t border-zinc-800 pt-4">
      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand input bindings' : 'Collapse input bindings'}
        className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-300"
      >
        <span className="flex items-center gap-1.5">
          <Keyboard className="w-3.5 h-3.5" aria-hidden="true" />
          Input Bindings
        </span>
        <span aria-hidden="true">{collapsed ? '+' : '-'}</span>
      </button>

      {!collapsed && (
        <div className="mt-3 space-y-3">
          {/* Local-player selector — each slot has its own editable action map. */}
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Player</label>
            <div className="flex gap-1" role="group" aria-label="Local player">
              {[0, 1].map((slot) => (
                <button
                  key={slot}
                  onClick={() => setSelectedPlayer(slot)}
                  aria-pressed={selectedPlayer === slot}
                  // A rebind capture resolves which action to rewrite against the
                  // selected player at key-press time, so switching slots mid-capture
                  // would silently retarget (or swallow) the keypress. Lock the
                  // selector until the capture completes or is cancelled.
                  disabled={rebindTarget !== null}
                  title={rebindTarget !== null ? 'Finish or cancel the rebind first' : undefined}
                  className={`flex-1 rounded px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
                    selectedPlayer === slot
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {`Player ${slot + 1}`}
                </button>
              ))}
            </div>
          </div>

          {/* Preset selector */}
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Preset</label>
            <select
              value={inputPresetByPlayer[selectedPlayer] ?? ''}
              onChange={(e) => handlePresetChange(e.target.value)}
              disabled={!isEditing}
              aria-label="Input preset"
              className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none
                focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            >
              {PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Bindings list — the selected player's slot only */}
          {playerBindings.length === 0 ? (
            <p className="text-xs text-zinc-400 italic">No bindings configured</p>
          ) : (
            <div className="space-y-2">
              {playerBindings.map((binding) => (
                <div
                  key={binding.actionName}
                  className="rounded bg-zinc-800/50 px-2 py-1.5 text-xs"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-zinc-300">{binding.actionName}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-zinc-400 text-[10px]">{binding.actionType}</span>
                      {isEditing && (
                        <button
                          onClick={() => removeInputBinding(binding.actionName, selectedPlayer)}
                          aria-label={`Remove ${binding.actionName} binding`}
                          className="text-zinc-400 hover:text-red-400"
                          title="Remove binding"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {binding.actionType === 'digital' ? (
                    <div className="flex items-center gap-1 flex-wrap">
                      {binding.sources.map((src, i) => (
                        <span key={i} className="rounded bg-zinc-700 px-1.5 py-0.5 text-zinc-300">
                          {formatKeyCode(src)}
                        </span>
                      ))}
                      {isEditing && (
                        <button
                          onClick={() =>
                            setRebindTarget({ actionName: binding.actionName, field: 'sources' })
                          }
                          aria-label={`Rebind ${binding.actionName}`}
                          className={`rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 ${
                            rebindTarget?.actionName === binding.actionName && rebindTarget.field === 'sources'
                              ? 'bg-blue-600 text-white'
                              : ''
                          }`}
                        >
                          {rebindTarget?.actionName === binding.actionName && rebindTarget.field === 'sources'
                            ? 'Press key...'
                            : 'Rebind'}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <span className="text-zinc-400 w-4">+</span>
                        {(binding.positiveKeys ?? []).map((k, i) => (
                          <span key={i} className="rounded bg-zinc-700 px-1.5 py-0.5 text-zinc-300">
                            {formatKeyCode(k)}
                          </span>
                        ))}
                        {isEditing && (
                          <button
                            onClick={() =>
                              setRebindTarget({ actionName: binding.actionName, field: 'positiveKeys' })
                            }
                            aria-label={`Rebind ${binding.actionName} positive key`}
                            className={`rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 ${
                              rebindTarget?.actionName === binding.actionName && rebindTarget.field === 'positiveKeys'
                                ? 'bg-blue-600 text-white'
                                : ''
                            }`}
                          >
                            {rebindTarget?.actionName === binding.actionName && rebindTarget.field === 'positiveKeys'
                              ? 'Press...'
                              : '+'}
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-zinc-400 w-4">-</span>
                        {(binding.negativeKeys ?? []).map((k, i) => (
                          <span key={i} className="rounded bg-zinc-700 px-1.5 py-0.5 text-zinc-300">
                            {formatKeyCode(k)}
                          </span>
                        ))}
                        {isEditing && (
                          <button
                            onClick={() =>
                              setRebindTarget({ actionName: binding.actionName, field: 'negativeKeys' })
                            }
                            aria-label={`Rebind ${binding.actionName} negative key`}
                            className={`rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 ${
                              rebindTarget?.actionName === binding.actionName && rebindTarget.field === 'negativeKeys'
                                ? 'bg-blue-600 text-white'
                                : ''
                            }`}
                          >
                            {rebindTarget?.actionName === binding.actionName && rebindTarget.field === 'negativeKeys'
                              ? 'Press...'
                              : '-'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add new binding */}
          {isEditing && !addingNew && (
            <button
              onClick={() => setAddingNew(true)}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-300"
            >
              <Plus className="w-3 h-3" />
              Add Binding
            </button>
          )}

          {isEditing && addingNew && (
            <div className="space-y-2 rounded bg-zinc-800/50 p-2">
              <input
                type="text"
                placeholder="Action name"
                value={newActionName}
                onChange={(e) => setNewActionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddAction();
                  if (e.key === 'Escape') setAddingNew(false);
                }}
                aria-label="New action name"
                className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <select
                  value={newActionType}
                  onChange={(e) => setNewActionType(e.target.value as 'digital' | 'axis')}
                  aria-label="Action type"
                  className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none"
                >
                  <option value="digital">Digital</option>
                  <option value="axis">Axis</option>
                </select>
                <button
                  onClick={handleAddAction}
                  className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500"
                >
                  Add
                </button>
                <button
                  onClick={() => setAddingNew(false)}
                  className="rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
