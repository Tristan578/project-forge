'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Sun, Lightbulb, Mountain } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';

interface EntityOption {
  entityId: string;
  name: string;
  type: string;
}

function getEntityIcon(type: string) {
  switch (type) {
    case 'point_light':
    case 'spot_light':
      return <Lightbulb size={12} className="text-yellow-400" />;
    case 'directional_light':
      return <Sun size={12} className="text-yellow-400" />;
    case 'terrain':
      return <Mountain size={12} className="text-green-400" />;
    default:
      return <Box size={12} className="text-blue-400" />;
  }
}

function getEntityType(components: string[]): string {
  if (components.includes('TerrainEnabled')) return 'terrain';
  if (components.includes('PointLight')) return 'point_light';
  if (components.includes('DirectionalLight')) return 'directional_light';
  if (components.includes('SpotLight')) return 'spot_light';
  return 'mesh';
}

interface EntityPickerProps {
  onSelect: (name: string, entityId: string) => void;
  onClose: () => void;
}

export function EntityPicker({ onSelect, onClose }: EntityPickerProps) {
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const filter = useChatStore((s) => s.entityPickerFilter);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [prevFilteredLength, setPrevFilteredLength] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Build flattened entity list
  const entities: EntityOption[] = [];
  for (const node of Object.values(sceneGraph.nodes)) {
    entities.push({
      entityId: node.entityId,
      name: node.name,
      type: getEntityType(node.components),
    });
  }

  // Filter by typed text
  const filtered = filter
    ? entities.filter((e) =>
        e.name.toLowerCase().includes(filter.toLowerCase())
      )
    : entities;

  // Clamp selected index using prev-value pattern (no setState in effect)
  if (prevFilteredLength !== filtered.length) {
    setPrevFilteredLength(filtered.length);
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const items = listRef.current.querySelectorAll('[data-entity-item]');
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex].name, filtered[selectedIndex].entityId);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }, [filtered, selectedIndex, onSelect, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full left-0 z-50 mb-1 w-64 rounded-md border border-zinc-700 bg-zinc-900 p-2 shadow-lg">
        <p className="text-xs text-zinc-500">No entities found</p>
      </div>
    );
  }

  return (
    <div className="absolute bottom-full left-0 z-50 mb-1 w-64 rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
      <div
        ref={listRef}
        className="max-h-[200px] overflow-y-auto py-1"
      >
        {filtered.map((entity, i) => (
          <button
            key={entity.entityId}
            data-entity-item
            className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs ${
              i === selectedIndex
                ? 'bg-zinc-800 text-zinc-200'
                : 'text-zinc-400 hover:bg-zinc-800/50'
            }`}
            onMouseEnter={() => setSelectedIndex(i)}
            onClick={() => onSelect(entity.name, entity.entityId)}
          >
            {getEntityIcon(entity.type)}
            <span className="flex-1 truncate">{entity.name}</span>
            <span className="text-[9px] text-zinc-600">{entity.entityId}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
