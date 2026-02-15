'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NODE_DEFINITION_MAP } from '@/lib/scripting/nodeDefinitions';
import { PORT_COLORS } from '@/lib/scripting/visualScriptTypes';
import type { PortType } from '@/lib/scripting/visualScriptTypes';

function CustomNodeComponent({ data, selected }: NodeProps) {
  const nodeType = data.nodeType as string;
  const def = NODE_DEFINITION_MAP[nodeType];

  if (!def) {
    return (
      <div className="rounded border border-red-500 bg-zinc-900 px-3 py-2 text-xs text-red-400">
        Unknown: {nodeType}
      </div>
    );
  }

  return (
    <div className={`min-w-[150px] rounded-lg border ${selected ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-zinc-700'} bg-zinc-900 text-xs shadow-md`}>
      {/* Header */}
      <div
        className="rounded-t-lg px-3 py-1.5 font-medium text-white"
        style={{ background: def.color }}
      >
        {def.label}
      </div>

      {/* Ports */}
      <div className="relative px-1 py-2">
        {/* Input ports */}
        {def.inputs.map((port, i) => (
          <div key={port.id} className="relative flex items-center py-0.5 pl-3 pr-1">
            <Handle
              type="target"
              position={Position.Left}
              id={port.id}
              style={{
                background: PORT_COLORS[port.type as PortType] || '#94a3b8',
                width: port.type === 'exec' ? 10 : 8,
                height: port.type === 'exec' ? 10 : 8,
                borderRadius: port.type === 'exec' ? 2 : '50%',
                border: '1px solid rgba(255,255,255,0.3)',
                left: -4,
                top: `${28 + i * 22}px`,
              }}
            />
            <span className="text-zinc-400">{port.name}</span>
          </div>
        ))}

        {/* Output ports */}
        {def.outputs.map((port, i) => (
          <div key={port.id} className="relative flex items-center justify-end py-0.5 pl-1 pr-3">
            <span className="text-zinc-400">{port.name}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={port.id}
              style={{
                background: PORT_COLORS[port.type as PortType] || '#94a3b8',
                width: port.type === 'exec' ? 10 : 8,
                height: port.type === 'exec' ? 10 : 8,
                borderRadius: port.type === 'exec' ? 2 : '50%',
                border: '1px solid rgba(255,255,255,0.3)',
                right: -4,
                top: `${28 + (def.inputs.length + i) * 22}px`,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export const CustomNode = memo(CustomNodeComponent);
