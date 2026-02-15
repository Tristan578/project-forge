/**
 * Shader Node Palette
 * Displays available shader nodes grouped by category for drag-and-drop.
 */

import { useState, useCallback } from 'react';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import { SHADER_NODE_DEFINITIONS, SHADER_NODE_CATEGORIES } from '@/lib/shaders/shaderNodeTypes';

interface ShaderNodePaletteProps {
  onClose: () => void;
}

export function ShaderNodePalette({ onClose }: ShaderNodePaletteProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['input', 'math', 'output'])
  );

  const toggleCategory = useCallback((categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }, []);

  const onDragStart = useCallback((event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  return (
    <div className="absolute left-0 top-0 z-10 h-full w-64 border-r border-zinc-700 bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-2">
        <span className="text-sm font-semibold text-zinc-300">Node Palette</span>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Categories */}
      <div className="h-[calc(100%-45px)] overflow-y-auto">
        {SHADER_NODE_CATEGORIES.map((category) => {
          const isExpanded = expandedCategories.has(category.id);
          const nodes = Object.values(SHADER_NODE_DEFINITIONS).filter(
            (n) => n.category === category.id
          );

          return (
            <div key={category.id} className="border-b border-zinc-800">
              {/* Category header */}
              <button
                onClick={() => toggleCategory(category.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-zinc-500" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-zinc-500" />
                )}
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: category.color }}
                />
                <span className="text-xs font-medium text-zinc-300">{category.label}</span>
                <span className="ml-auto text-xs text-zinc-600">{nodes.length}</span>
              </button>

              {/* Node list */}
              {isExpanded && (
                <div className="bg-zinc-950 px-2 py-1">
                  {nodes.map((node) => (
                    <div
                      key={node.type}
                      draggable
                      onDragStart={(e) => onDragStart(e, node.type)}
                      className="mb-1 cursor-move rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 hover:border-zinc-700 hover:bg-zinc-800"
                    >
                      <div className="text-xs font-medium text-zinc-300">{node.label}</div>
                      <div className="mt-0.5 text-[10px] text-zinc-600">{node.description}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
