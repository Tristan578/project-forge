/**
 * Base Shader Node Component
 * Renders a visual node with typed input/output handles.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { SHADER_NODE_DEFINITIONS, type ShaderDataType } from '@/lib/shaders/shaderNodeTypes';

function getHandleColor(type: ShaderDataType): string {
  switch (type) {
    case 'float':
      return '#60a5fa'; // blue-400
    case 'vec2':
      return '#34d399'; // emerald-400
    case 'vec3':
      return '#a78bfa'; // violet-400
    case 'vec4':
      return '#fb7185'; // rose-400
    case 'color':
      return '#f472b6'; // pink-400
    case 'texture2d':
      return '#fbbf24'; // amber-400
    default:
      return '#9ca3af'; // gray-400
  }
}

export const ShaderNodeBase = memo(({ data, selected }: NodeProps) => {
  const nodeType = (data?.nodeType as string) || 'unknown';
  const def = SHADER_NODE_DEFINITIONS[nodeType];

  if (!def) {
    return (
      <div className="rounded border-2 border-red-500 bg-zinc-900 px-3 py-2">
        <div className="text-xs font-semibold text-red-400">Unknown: {nodeType}</div>
      </div>
    );
  }

  return (
    <div
      className={`min-w-[160px] rounded border-2 bg-zinc-900 ${
        selected ? 'border-blue-500' : 'border-zinc-700'
      }`}
    >
      {/* Node header */}
      <div className="border-b border-zinc-700 bg-zinc-800 px-3 py-1.5">
        <div className="text-xs font-semibold text-zinc-300">{def.label}</div>
      </div>

      {/* Node body with handles */}
      <div className="px-3 py-2">
        {/* Input handles */}
        {def.inputs.map((input, idx) => (
          <div key={input.id} className="mb-1.5 flex items-center gap-2 text-xs">
            <Handle
              type="target"
              position={Position.Left}
              id={input.id}
              style={{
                width: 10,
                height: 10,
                left: -5,
                top: 36 + idx * 24,
                background: getHandleColor(input.type),
                border: '2px solid #18181b',
              }}
            />
            <span className="text-zinc-400">{input.label}</span>
          </div>
        ))}

        {/* Output handles */}
        {def.outputs.map((output, idx) => (
          <div key={output.id} className="mb-1.5 flex items-center justify-end gap-2 text-xs">
            <span className="text-zinc-400">{output.label}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={output.id}
              style={{
                width: 10,
                height: 10,
                right: -5,
                top: 36 + (def.inputs.length + idx) * 24,
                background: getHandleColor(output.type),
                border: '2px solid #18181b',
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
});

ShaderNodeBase.displayName = 'ShaderNodeBase';
