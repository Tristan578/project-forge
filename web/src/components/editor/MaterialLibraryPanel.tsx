'use client';

import { useState, useMemo } from 'react';
import { Search, Trash2, Bookmark } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import {
  MATERIAL_PRESETS,
  ALL_CATEGORIES,
  loadCustomMaterials,
  deleteCustomMaterial,
  type MaterialPreset,
  type MaterialCategory,
  type CustomMaterial,
} from '@/lib/materialPresets';

/** Generate a CSS radial gradient that approximates a PBR sphere */
function materialSphereStyle(
  baseColor: [number, number, number, number],
  metallic: number,
  roughness: number,
): React.CSSProperties {
  const r = Math.round(baseColor[0] * 255);
  const g = Math.round(baseColor[1] * 255);
  const b = Math.round(baseColor[2] * 255);

  // Highlight brightness scales with inverse roughness
  const highlightBrightness = 1.0 - roughness;
  // Metallic materials get a brighter, tighter highlight
  const highlightSize = metallic > 0.5 ? 25 : 35;

  const hr = Math.min(255, Math.round(r + (255 - r) * highlightBrightness * (metallic > 0.5 ? 0.8 : 0.5)));
  const hg = Math.min(255, Math.round(g + (255 - g) * highlightBrightness * (metallic > 0.5 ? 0.8 : 0.5)));
  const hb = Math.min(255, Math.round(b + (255 - b) * highlightBrightness * (metallic > 0.5 ? 0.8 : 0.5)));

  const dr = Math.round(r * 0.3);
  const dg = Math.round(g * 0.3);
  const db = Math.round(b * 0.3);

  return {
    background: `radial-gradient(circle at 35% 35%, rgb(${hr},${hg},${hb}) ${highlightSize}%, rgb(${r},${g},${b}) 55%, rgb(${dr},${dg},${db}) 100%)`,
    borderRadius: '50%',
  };
}

const CATEGORY_COLORS: Record<MaterialCategory, string> = {
  basic: 'bg-zinc-500',
  metal: 'bg-blue-400',
  natural: 'bg-green-500',
  glass: 'bg-cyan-400',
  special: 'bg-purple-400',
  fabric: 'bg-rose-400',
  plastic: 'bg-orange-400',
  stone: 'bg-amber-600',
  wood: 'bg-yellow-700',
};

function MaterialCard({
  id,
  name,
  baseColor,
  metallic,
  roughness,
  description,
  category,
  onApply,
  onDelete,
  isCustom,
}: {
  id: string;
  name: string;
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
  description: string;
  category: MaterialCategory | 'custom';
  onApply: () => void;
  onDelete?: () => void;
  isCustom?: boolean;
}) {
  const categoryColor = category === 'custom' ? 'bg-pink-400' : CATEGORY_COLORS[category];

  return (
    <div
      className="group relative flex cursor-pointer flex-col items-center gap-1 rounded border border-zinc-700/50 bg-zinc-800/30 p-1.5 hover:border-zinc-600 hover:bg-zinc-800 transition-colors"
      onClick={onApply}
      title={`${name} — ${description}`}
    >
      {isCustom && onDelete && (
        <button
          className="absolute right-0.5 top-0.5 hidden rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-red-400 group-hover:block z-10"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete custom material"
        >
          <Trash2 size={10} />
        </button>
      )}
      <div
        className="h-10 w-10"
        style={materialSphereStyle(baseColor, metallic, roughness)}
        data-preset-id={id}
      />
      <span className="max-w-full truncate text-[9px] text-zinc-400 leading-tight">{name}</span>
      <span className={`h-1.5 w-1.5 rounded-full ${categoryColor}`} />
    </div>
  );
}

export function MaterialLibraryPanel() {
  const [search, setSearch] = useState('');
  const [activeCategories, setActiveCategories] = useState<Set<MaterialCategory>>(new Set());
  const [customVersion, setCustomVersion] = useState(0);

  const primaryId = useEditorStore((s) => s.primaryId);
  const updateMaterial = useEditorStore((s) => s.updateMaterial);

  const customMaterials = useMemo(() => {
    // Re-read when customVersion changes
    void customVersion;
    return loadCustomMaterials();
  }, [customVersion]);

  const toggleCategory = (cat: MaterialCategory) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // Filter presets by search and category
  const filtered = useMemo(() => {
    let presets = MATERIAL_PRESETS;

    if (activeCategories.size > 0) {
      presets = presets.filter((p) => activeCategories.has(p.category));
    }

    if (search) {
      const q = search.toLowerCase();
      presets = presets.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.tags.some((t) => t.includes(q))
      );
    }

    return presets;
  }, [search, activeCategories]);

  // Filter custom materials by search
  const filteredCustom = useMemo(() => {
    if (!search) return customMaterials;
    const q = search.toLowerCase();
    return customMaterials.filter((m) => m.name.toLowerCase().includes(q));
  }, [search, customMaterials]);

  const handleApplyPreset = (preset: MaterialPreset) => {
    if (!primaryId) return;
    updateMaterial(primaryId, preset.data);
  };

  const handleApplyCustom = (material: CustomMaterial) => {
    if (!primaryId) return;
    updateMaterial(primaryId, material.data);
  };

  const handleDeleteCustom = (id: string) => {
    deleteCustomMaterial(id);
    setCustomVersion((v) => v + 1);
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      {/* Search bar */}
      <div className="relative">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search materials..."
          className="w-full rounded border border-zinc-700 bg-zinc-800 py-1 pl-6 pr-2 text-[11px] text-zinc-300 placeholder-zinc-600 outline-none focus:border-zinc-600"
        />
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap gap-1">
        {ALL_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => toggleCategory(cat)}
            className={`rounded-full px-2 py-0.5 text-[9px] capitalize transition-colors ${
              activeCategories.has(cat)
                ? 'bg-zinc-600 text-zinc-200'
                : 'bg-zinc-800 text-zinc-500 hover:text-zinc-400'
            }`}
          >
            <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${CATEGORY_COLORS[cat]}`} />
            {cat}
          </button>
        ))}
      </div>

      {/* No selection warning */}
      {!primaryId && (
        <p className="text-center text-[10px] text-zinc-600 py-1">
          Select an entity to apply materials
        </p>
      )}

      {/* Custom materials section */}
      {filteredCustom.length > 0 && (
        <>
          <div className="flex items-center gap-1 mt-1">
            <Bookmark size={10} className="text-pink-400" />
            <span className="text-[9px] font-medium text-zinc-500 uppercase tracking-wider">Custom</span>
          </div>
          <div className="grid grid-cols-5 gap-1">
            {filteredCustom.map((mat) => (
              <MaterialCard
                key={mat.id}
                id={mat.id}
                name={mat.name}
                baseColor={mat.data.baseColor}
                metallic={mat.data.metallic}
                roughness={mat.data.perceptualRoughness}
                description="Custom material"
                category="custom"
                onApply={() => handleApplyCustom(mat)}
                onDelete={() => handleDeleteCustom(mat.id)}
                isCustom
              />
            ))}
          </div>
        </>
      )}

      {/* Preset grid */}
      <div className="grid grid-cols-5 gap-1 mt-1">
        {filtered.map((preset) => (
          <MaterialCard
            key={preset.id}
            id={preset.id}
            name={preset.name}
            baseColor={preset.data.baseColor}
            metallic={preset.data.metallic}
            roughness={preset.data.perceptualRoughness}
            description={preset.description}
            category={preset.category}
            onApply={() => handleApplyPreset(preset)}
          />
        ))}
      </div>

      {filtered.length === 0 && filteredCustom.length === 0 && (
        <p className="text-center text-[10px] text-zinc-600 py-4">
          No materials found
        </p>
      )}
    </div>
  );
}
