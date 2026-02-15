'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useUIBuilderStore } from '@/stores/uiBuilderStore';

export function WidgetStyleEditor() {
  const [expanded, setExpanded] = useState(true);
  const activeScreenId = useUIBuilderStore((s) => s.activeScreenId);
  const selectedWidgetId = useUIBuilderStore((s) => s.selectedWidgetId);
  const screens = useUIBuilderStore((s) => s.screens);
  const updateWidgetStyle = useUIBuilderStore((s) => s.updateWidgetStyle);

  const activeScreen = screens.find((s) => s.id === activeScreenId);
  const widget = activeScreen?.widgets.find((w) => w.id === selectedWidgetId);

  if (!widget || !activeScreenId) return null;

  const handleChange = (field: string, value: unknown) => {
    updateWidgetStyle(activeScreenId, widget.id, { [field]: value });
  };

  const handlePaddingChange = (index: number, value: number) => {
    const newPadding: [number, number, number, number] = [...widget.style.padding];
    newPadding[index] = value;
    updateWidgetStyle(activeScreenId, widget.id, { padding: newPadding });
  };

  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-300"
      >
        <span>Style Properties</span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {expanded && (
        <div className="space-y-3 px-3 pb-3 text-xs">
          {/* Background & Border */}
          <div className="space-y-2">
            <label className="block">
              <span className="text-zinc-500">Background Color</span>
              <input
                type="text"
                value={widget.style.backgroundColor || ''}
                onChange={(e) => handleChange('backgroundColor', e.target.value || null)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
                placeholder="transparent, #000, rgba(0,0,0,0.5)"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-zinc-500">Border Width</span>
                <input
                  type="number"
                  min="0"
                  value={widget.style.borderWidth}
                  onChange={(e) => handleChange('borderWidth', parseFloat(e.target.value))}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
                />
              </label>

              <label className="block">
                <span className="text-zinc-500">Border Color</span>
                <input
                  type="color"
                  value={widget.style.borderColor}
                  onChange={(e) => handleChange('borderColor', e.target.value)}
                  className="mt-1 w-full h-8 rounded border border-zinc-700 bg-zinc-800"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-zinc-500">Border Radius (px)</span>
              <input
                type="number"
                min="0"
                value={widget.style.borderRadius}
                onChange={(e) => handleChange('borderRadius', parseFloat(e.target.value))}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
              />
            </label>
          </div>

          {/* Padding */}
          <div>
            <span className="text-zinc-500 block mb-1">Padding (px)</span>
            <div className="grid grid-cols-4 gap-1">
              {['T', 'R', 'B', 'L'].map((label, index) => (
                <label key={label} className="block">
                  <span className="text-zinc-600 text-[10px]">{label}</span>
                  <input
                    type="number"
                    min="0"
                    value={widget.style.padding[index]}
                    onChange={(e) => handlePaddingChange(index, parseFloat(e.target.value))}
                    className="w-full rounded border border-zinc-700 bg-zinc-800 px-1 py-1 text-zinc-300"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Opacity */}
          <label className="block">
            <span className="text-zinc-500">Opacity</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={widget.style.opacity}
              onChange={(e) => handleChange('opacity', parseFloat(e.target.value))}
              className="mt-1 w-full"
            />
            <span className="text-zinc-600 text-[10px]">{widget.style.opacity.toFixed(2)}</span>
          </label>

          {/* Font Properties */}
          <div className="space-y-2 border-t border-zinc-700 pt-2">
            <label className="block">
              <span className="text-zinc-500">Font Family</span>
              <select
                value={widget.style.fontFamily}
                onChange={(e) => handleChange('fontFamily', e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
              >
                <option value="system-ui">System UI</option>
                <option value="monospace">Monospace</option>
                <option value="serif">Serif</option>
                <option value="sans-serif">Sans-serif</option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-zinc-500">Font Size</span>
                <input
                  type="number"
                  min="0"
                  value={widget.style.fontSize}
                  onChange={(e) => handleChange('fontSize', parseFloat(e.target.value))}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
                />
              </label>

              <label className="block">
                <span className="text-zinc-500">Font Weight</span>
                <select
                  value={widget.style.fontWeight}
                  onChange={(e) => handleChange('fontWeight', e.target.value)}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
                >
                  <option value="normal">Normal</option>
                  <option value="bold">Bold</option>
                </select>
              </label>
            </div>

            <label className="block">
              <span className="text-zinc-500">Text Color</span>
              <input
                type="color"
                value={widget.style.color}
                onChange={(e) => handleChange('color', e.target.value)}
                className="mt-1 w-full h-8 rounded border border-zinc-700 bg-zinc-800"
              />
            </label>

            <label className="block">
              <span className="text-zinc-500">Text Align</span>
              <select
                value={widget.style.textAlign}
                onChange={(e) => handleChange('textAlign', e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
          </div>

          {/* Transform */}
          <div className="space-y-2 border-t border-zinc-700 pt-2">
            <label className="block">
              <span className="text-zinc-500">Rotation (deg)</span>
              <input
                type="number"
                step="15"
                value={widget.style.rotation}
                onChange={(e) => handleChange('rotation', parseFloat(e.target.value))}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-zinc-500">Scale X</span>
                <input
                  type="number"
                  step="0.1"
                  value={widget.style.scaleX}
                  onChange={(e) => handleChange('scaleX', parseFloat(e.target.value))}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
                />
              </label>

              <label className="block">
                <span className="text-zinc-500">Scale Y</span>
                <input
                  type="number"
                  step="0.1"
                  value={widget.style.scaleY}
                  onChange={(e) => handleChange('scaleY', parseFloat(e.target.value))}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
