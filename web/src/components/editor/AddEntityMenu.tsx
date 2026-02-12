'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, Box, Circle, Square, Cylinder, Triangle, Donut, Pill, Lightbulb, Sun, Flashlight } from 'lucide-react';

export type EntityType = 'cube' | 'sphere' | 'plane' | 'cylinder' | 'cone' | 'torus' | 'capsule' | 'point_light' | 'directional_light' | 'spot_light';

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

const lightItems: MenuItem[] = [
  { type: 'point_light', label: 'Point Light', icon: <Lightbulb size={16} /> },
  { type: 'directional_light', label: 'Directional Light', icon: <Sun size={16} /> },
  { type: 'spot_light', label: 'Spot Light', icon: <Flashlight size={16} /> },
];

export function AddEntityMenu({ onSpawn }: AddEntityMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const handleSpawn = (type: EntityType) => {
    onSpawn(type);
    setOpen(false);
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="Add Entity"
        className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
          open
            ? 'bg-blue-600 text-white'
            : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
        }`}
      >
        <Plus size={20} />
      </button>

      {open && (
        <div className="absolute left-full top-0 z-50 ml-2 min-w-[160px] rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-xl">
          {/* Mesh primitives */}
          <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Meshes
          </div>
          {meshItems.map((item) => (
            <button
              key={item.type}
              onClick={() => handleSpawn(item.type)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
            >
              {item.icon}
              {item.label}
            </button>
          ))}

          {/* Divider */}
          <div className="my-1 h-px bg-zinc-700" />

          {/* Lights */}
          <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Lights
          </div>
          {lightItems.map((item) => (
            <button
              key={item.type}
              onClick={() => handleSpawn(item.type)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
