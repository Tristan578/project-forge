'use client';

import { useCallback } from 'react';
import { NODE_DEFINITION_MAP } from '@/lib/scripting/nodeDefinitions';
import type { VisualScriptNode } from '@/lib/scripting/visualScriptTypes';

interface NodeInspectorProps {
  node: VisualScriptNode | null;
  onNodeDataChange: (nodeId: string, data: Record<string, unknown>) => void;
}

export function NodeInspector({ node, onNodeDataChange }: NodeInspectorProps) {
  const handleChange = useCallback((key: string, value: unknown) => {
    if (!node) return;
    onNodeDataChange(node.id, { ...node.data, [key]: value });
  }, [node, onNodeDataChange]);

  if (!node) {
    return (
      <div className="p-3 text-center text-xs text-zinc-600">
        Select a node to edit its properties
      </div>
    );
  }

  const def = NODE_DEFINITION_MAP[node.type];
  if (!def) return null;

  // Filter editable inputs (those with defaultValue or that accept user input)
  const editableInputs = def.inputs.filter(p => p.type !== 'exec');

  return (
    <div className="space-y-3 p-3">
      <div>
        <div className="text-xs font-semibold text-zinc-300" style={{ color: def.color }}>
          {def.label}
        </div>
        <p className="mt-0.5 text-[10px] text-zinc-600">{def.description}</p>
      </div>

      {editableInputs.length === 0 ? (
        <p className="text-[10px] text-zinc-600">No editable properties</p>
      ) : (
        <div className="space-y-2">
          {editableInputs.map(port => {
            const value = node.data[port.id] ?? port.defaultValue ?? '';

            return (
              <div key={port.id} className="flex items-center gap-2">
                <label className="w-16 shrink-0 text-[10px] text-zinc-400">{port.name}</label>
                {port.type === 'bool' ? (
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) => handleChange(port.id, e.target.checked)}
                    className="h-3 w-3 rounded border-zinc-600 bg-zinc-800"
                  />
                ) : port.type === 'float' || port.type === 'int' ? (
                  <input
                    type="number"
                    value={Number(value) || 0}
                    step={port.type === 'float' ? 0.1 : 1}
                    onChange={(e) => handleChange(port.id, parseFloat(e.target.value) || 0)}
                    className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 focus:border-blue-500 focus:outline-none"
                  />
                ) : (
                  <input
                    type="text"
                    value={String(value)}
                    onChange={(e) => handleChange(port.id, e.target.value)}
                    className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 focus:border-blue-500 focus:outline-none"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
