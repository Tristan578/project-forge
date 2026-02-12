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
  const inputPreset = useEditorStore((s) => s.inputPreset);
  const engineMode = useEditorStore((s) => s.engineMode);
  const setInputPreset = useEditorStore((s) => s.setInputPreset);
  const setInputBinding = useEditorStore((s) => s.setInputBinding);
  const removeInputBinding = useEditorStore((s) => s.removeInputBinding);

  const [collapsed, setCollapsed] = useState(true);
  const [rebindTarget, setRebindTarget] = useState<{
    actionName: string;
    field: 'sources' | 'positiveKeys' | 'negativeKeys';
  } | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newActionName, setNewActionName] = useState('');
  const [newActionType, setNewActionType] = useState<'digital' | 'axis'>('digital');

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

      // Find the binding and update it
      const binding = inputBindings.find((b) => b.actionName === rebindTarget.actionName);
      if (!binding) {
        setRebindTarget(null);
        return;
      }

      const updated: InputBinding = { ...binding };
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
  }, [rebindTarget, inputBindings, setInputBinding]);

  const handlePresetChange = useCallback(
    (value: string) => {
      if (value && value !== '') {
        setInputPreset(value as 'fps' | 'platformer' | 'topdown' | 'racing');
      }
    },
    [setInputPreset]
  );

  const handleAddAction = useCallback(() => {
    if (!newActionName.trim()) return;

    const binding: InputBinding = {
      actionName: newActionName.trim(),
      actionType: newActionType,
      sources: [],
      positiveKeys: newActionType === 'axis' ? [] : undefined,
      negativeKeys: newActionType === 'axis' ? [] : undefined,
    };

    setInputBinding(binding);
    setNewActionName('');
    setAddingNew(false);
  }, [newActionName, newActionType, setInputBinding]);

  // Don't allow rebinding during Play mode
  const isEditing = engineMode === 'edit';

  return (
    <div className="border-t border-zinc-800 pt-4">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-300"
      >
        <span className="flex items-center gap-1.5">
          <Keyboard className="w-3.5 h-3.5" />
          Input Bindings
        </span>
        <span>{collapsed ? '+' : '-'}</span>
      </button>

      {!collapsed && (
        <div className="mt-3 space-y-3">
          {/* Preset selector */}
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Preset</label>
            <select
              value={inputPreset ?? ''}
              onChange={(e) => handlePresetChange(e.target.value)}
              disabled={!isEditing}
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

          {/* Bindings list */}
          {inputBindings.length === 0 ? (
            <p className="text-xs text-zinc-500 italic">No bindings configured</p>
          ) : (
            <div className="space-y-2">
              {inputBindings.map((binding) => (
                <div
                  key={binding.actionName}
                  className="rounded bg-zinc-800/50 px-2 py-1.5 text-xs"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-zinc-300">{binding.actionName}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-zinc-600 text-[10px]">{binding.actionType}</span>
                      {isEditing && (
                        <button
                          onClick={() => removeInputBinding(binding.actionName)}
                          className="text-zinc-600 hover:text-red-400"
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
                          className={`rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 ${
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
                        <span className="text-zinc-500 w-4">+</span>
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
                            className={`rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 ${
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
                        <span className="text-zinc-500 w-4">-</span>
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
                            className={`rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 ${
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
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
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
                className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <select
                  value={newActionType}
                  onChange={(e) => setNewActionType(e.target.value as 'digital' | 'axis')}
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
