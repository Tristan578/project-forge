'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, Box, Circle, Square, Cylinder, Triangle, Donut, Pill, Lightbulb, Sun, Flashlight, Mountain, RotateCcw } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';

export type EntityType = 'cube' | 'sphere' | 'plane' | 'cylinder' | 'cone' | 'torus' | 'capsule' | 'terrain' | 'point_light' | 'directional_light' | 'spot_light';

interface AddEntityMenuProps {
  onSpawn: (type: EntityType) => void;
}

interface MenuItem {
  type: EntityType;
  label: string;
  icon: React.ReactNode;
}

const meshItems: MenuItem[] = [
  { type: 'cube', label: 'Cube', icon: <Box size={16} /> },
  { type: 'sphere', label: 'Sphere', icon: <Circle size={16} /> },
  { type: 'plane', label: 'Plane', icon: <Square size={16} /> },
  { type: 'cylinder', label: 'Cylinder', icon: <Cylinder size={16} /> },
  { type: 'cone', label: 'Cone', icon: <Triangle size={16} /> },
  { type: 'torus', label: 'Torus', icon: <Donut size={16} /> },
  { type: 'capsule', label: 'Capsule', icon: <Pill size={16} /> },
];

const environmentItems: MenuItem[] = [
  { type: 'terrain', label: 'Terrain', icon: <Mountain size={16} /> },
];

const lightItems: MenuItem[] = [
  { type: 'point_light', label: 'Point Light', icon: <Lightbulb size={16} /> },
  { type: 'directional_light', label: 'Directional Light', icon: <Sun size={16} /> },
  { type: 'spot_light', label: 'Spot Light', icon: <Flashlight size={16} /> },
];

// All actionable items in menu order (for keyboard navigation)
const allActionItems = [
  ...meshItems.map((item) => ({ id: item.type, label: item.label })),
  { id: 'extrude_circle' as const, label: 'Extrude Circle' },
  { id: 'lathe_profile' as const, label: 'Lathe Profile' },
  ...environmentItems.map((item) => ({ id: item.type, label: item.label })),
  ...lightItems.map((item) => ({ id: item.type, label: item.label })),
];

export function AddEntityMenu({ onSpawn }: AddEntityMenuProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const extrudeShape = useEditorStore((s) => s.extrudeShape);
  const latheShape = useEditorStore((s) => s.latheShape);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  // Auto-focus first item when menu opens
  useEffect(() => {
    if (open) {
      setFocusedIndex(0);
      requestAnimationFrame(() => {
        itemRefs.current[0]?.focus();
      });
    } else {
      setFocusedIndex(-1);
    }
  }, [open]);

  const handleSpawn = useCallback((type: EntityType) => {
    onSpawn(type);
    setOpen(false);
  }, [onSpawn]);

  const handleExtrudeCircle = useCallback(() => {
    extrudeShape('circle', { radius: 0.5, length: 2.0, segments: 16 });
    setOpen(false);
  }, [extrudeShape]);

  const handleLatheProfile = useCallback(() => {
    latheShape([[0.5, 0.0], [0.3, 0.5], [0.4, 1.0], [0.0, 1.2]], { segments: 32 });
    setOpen(false);
  }, [latheShape]);

  const handleItemAction = useCallback((index: number) => {
    const item = allActionItems[index];
    if (!item) return;
    if (item.id === 'extrude_circle') {
      handleExtrudeCircle();
    } else if (item.id === 'lathe_profile') {
      handleLatheProfile();
    } else {
      handleSpawn(item.id as EntityType);
    }
  }, [handleExtrudeCircle, handleLatheProfile, handleSpawn]);

  const focusItem = useCallback((index: number) => {
    setFocusedIndex(index);
    itemRefs.current[index]?.focus();
  }, []);

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const itemCount = allActionItems.length;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          focusItem((focusedIndex + 1) % itemCount);
          break;
        case 'ArrowUp':
          e.preventDefault();
          focusItem((focusedIndex - 1 + itemCount) % itemCount);
          break;
        case 'Home':
          e.preventDefault();
          focusItem(0);
          break;
        case 'End':
          e.preventDefault();
          focusItem(itemCount - 1);
          break;
        case 'Escape':
          e.preventDefault();
          setOpen(false);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (focusedIndex >= 0) {
            handleItemAction(focusedIndex);
          }
          break;
      }
    },
    [focusedIndex, focusItem, handleItemAction]
  );

  // Track the running button index for ref assignment
  let itemIndex = 0;

  const renderMenuItem = (item: MenuItem, action: () => void) => {
    const idx = itemIndex++;
    return (
      <button
        key={item.type}
        ref={(el) => { itemRefs.current[idx] = el; }}
        role="menuitem"
        tabIndex={focusedIndex === idx ? 0 : -1}
        onClick={action}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700 focus:bg-zinc-700 focus:outline-none"
      >
        {item.icon}
        {item.label}
      </button>
    );
  };

  const renderProceduralItem = (id: string, label: string, icon: React.ReactNode, action: () => void) => {
    const idx = itemIndex++;
    return (
      <button
        key={id}
        ref={(el) => { itemRefs.current[idx] = el; }}
        role="menuitem"
        tabIndex={focusedIndex === idx ? 0 : -1}
        onClick={action}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700 focus:bg-zinc-700 focus:outline-none"
      >
        {icon}
        {label}
      </button>
    );
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="Add Entity"
        aria-label="Add Entity"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
          open
            ? 'bg-blue-600 text-white'
            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300'
        }`}
      >
        <Plus size={20} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Add entity"
          onKeyDown={handleMenuKeyDown}
          className="absolute left-full top-0 z-50 ml-2 min-w-[160px] rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-xl"
        >
          {/* Mesh primitives */}
          <div role="group" aria-label="Meshes">
            <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
              Meshes
            </div>
            {meshItems.map((item) => renderMenuItem(item, () => handleSpawn(item.type)))}
          </div>

          <div role="separator" className="my-1 h-px bg-zinc-700" />

          {/* Procedural */}
          <div role="group" aria-label="Procedural">
            <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
              Procedural
            </div>
            {renderProceduralItem('extrude_circle', 'Extrude Circle', <Circle size={16} />, handleExtrudeCircle)}
            {renderProceduralItem('lathe_profile', 'Lathe Profile', <RotateCcw size={16} />, handleLatheProfile)}
          </div>

          <div role="separator" className="my-1 h-px bg-zinc-700" />

          {/* Environment */}
          <div role="group" aria-label="Environment">
            <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
              Environment
            </div>
            {environmentItems.map((item) => renderMenuItem(item, () => handleSpawn(item.type)))}
          </div>

          <div role="separator" className="my-1 h-px bg-zinc-700" />

          {/* Lights */}
          <div role="group" aria-label="Lights">
            <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
              Lights
            </div>
            {lightItems.map((item) => renderMenuItem(item, () => handleSpawn(item.type)))}
          </div>
        </div>
      )}
    </div>
  );
}
