'use client';

import { useState, useCallback } from 'react';
import { X, Search } from 'lucide-react';
import { NODE_CATEGORIES } from '@/lib/scripting/nodeDefinitions';

interface NodePaletteProps {
  onClose: () => void;
}

export function NodePalette({ onClose }: NodePaletteProps) {
  const [search, setSearch] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>('events');

  const filteredCategories = search
    ? NODE_CATEGORIES.map(cat => ({
        ...cat,
        nodes: cat.nodes.filter(n =>
          n.label.toLowerCase().includes(search.toLowerCase()) ||
          n.description.toLowerCase().includes(search.toLowerCase())
        ),
      })).filter(cat => cat.nodes.length > 0)
    : NODE_CATEGORIES;

  const onDragStart = useCallback((event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  return (
    <div className="absolute left-0 top-0 z-10 h-full w-56 overflow-y-auto border-r border-zinc-700 bg-zinc-900/95 backdrop-blur-sm">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-zinc-700 bg-zinc-900 p-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-400">Node Palette</span>
          <button onClick={onClose} className="rounded p-0.5 text-zinc-500 hover:text-zinc-300">
            <X size={14} />
          </button>
        </div>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nodes..."
            className="w-full rounded border border-zinc-700 bg-zinc-800 py-1 pl-7 pr-2 text-xs text-zinc-300 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Categories */}
      <div className="p-1">
        {filteredCategories.map(cat => (
          <div key={cat.category} className="mb-1">
            <button
              onClick={() => setExpandedCategory(expandedCategory === cat.category ? null : cat.category)}
              className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs font-medium text-zinc-400 hover:bg-zinc-800"
            >
              <span className={`text-[10px] ${expandedCategory === cat.category ? 'rotate-90' : ''} transition-transform`}>▶</span>
              {cat.label}
              <span className="ml-auto text-[10px] text-zinc-600">{cat.nodes.length}</span>
            </button>

            {(expandedCategory === cat.category || search) && (
              <div className="ml-2 space-y-0.5">
                {cat.nodes.map(node => (
                  <div
                    key={node.type}
                    draggable
                    onDragStart={(e) => onDragStart(e, node.type)}
                    className="cursor-grab rounded px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 active:cursor-grabbing"
                    title={node.description}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-sm" style={{ background: node.color }} />
                      {node.label}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
