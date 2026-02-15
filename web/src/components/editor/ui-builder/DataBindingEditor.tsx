'use client';

import { useUIBuilderStore, type DataBinding } from '@/stores/uiBuilderStore';

interface DataBindingEditorProps {
  screenId: string;
  widgetId: string;
  property: string;
  binding: DataBinding | null;
}

export function DataBindingEditor({ screenId, widgetId, property, binding }: DataBindingEditorProps) {
  const setBinding = useUIBuilderStore((s) => s.setBinding);
  const removeBinding = useUIBuilderStore((s) => s.removeBinding);

  const handleToggle = () => {
    if (binding) {
      removeBinding(screenId, widgetId, property);
    } else {
      setBinding(screenId, widgetId, property, {
        stateKey: '',
        direction: 'read',
        transform: null,
      });
    }
  };

  const handleChange = (field: keyof DataBinding, value: unknown) => {
    if (!binding) return;
    setBinding(screenId, widgetId, property, {
      ...binding,
      [field]: value,
    });
  };

  return (
    <div className="space-y-2 rounded border border-zinc-700 bg-zinc-800/50 p-2">
      <div className="flex items-center justify-between">
        <span className="text-zinc-500 text-xs font-semibold">Data Binding</span>
        <button
          onClick={handleToggle}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          {binding ? 'Remove' : 'Add'}
        </button>
      </div>

      {binding && (
        <div className="space-y-2">
          <label className="block">
            <span className="text-zinc-500 text-xs">State Key</span>
            <input
              type="text"
              value={binding.stateKey}
              onChange={(e) => handleChange('stateKey', e.target.value)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
              placeholder="health, score, etc."
            />
          </label>

          <label className="block">
            <span className="text-zinc-500 text-xs">Direction</span>
            <select
              value={binding.direction}
              onChange={(e) => handleChange('direction', e.target.value)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
            >
              <option value="read">Read</option>
              <option value="write">Write</option>
              <option value="read_write">Read/Write</option>
            </select>
          </label>

          <label className="block">
            <span className="text-zinc-500 text-xs">Transform</span>
            <select
              value={binding.transform?.type || 'none'}
              onChange={(e) => {
                if (e.target.value === 'none') {
                  handleChange('transform', null);
                } else {
                  handleChange('transform', { type: e.target.value });
                }
              }}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
            >
              <option value="none">None</option>
              <option value="format">Format</option>
              <option value="map">Map</option>
              <option value="clamp">Clamp</option>
              <option value="multiply">Multiply</option>
              <option value="round">Round</option>
            </select>
          </label>

          {/* Transform-specific fields */}
          {binding.transform?.type === 'format' && (
            <label className="block">
              <span className="text-zinc-500 text-xs">Template</span>
              <input
                type="text"
                value={binding.transform.template}
                onChange={(e) =>
                  handleChange('transform', { type: 'format', template: e.target.value })
                }
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
                placeholder="HP: {value}/{max}"
              />
            </label>
          )}

          {binding.transform?.type === 'clamp' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-zinc-500 text-xs">Min</span>
                <input
                  type="number"
                  value={binding.transform.min}
                  onChange={(e) =>
                    handleChange('transform', {
                      type: 'clamp',
                      min: parseFloat(e.target.value),
                      max: binding.transform?.type === 'clamp' ? binding.transform.max : 100,
                    })
                  }
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
                />
              </label>
              <label className="block">
                <span className="text-zinc-500 text-xs">Max</span>
                <input
                  type="number"
                  value={binding.transform.max}
                  onChange={(e) =>
                    handleChange('transform', {
                      type: 'clamp',
                      min: binding.transform?.type === 'clamp' ? binding.transform.min : 0,
                      max: parseFloat(e.target.value),
                    })
                  }
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
                />
              </label>
            </div>
          )}

          {binding.transform?.type === 'multiply' && (
            <label className="block">
              <span className="text-zinc-500 text-xs">Factor</span>
              <input
                type="number"
                step="0.1"
                value={binding.transform.factor}
                onChange={(e) =>
                  handleChange('transform', { type: 'multiply', factor: parseFloat(e.target.value) })
                }
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
              />
            </label>
          )}

          {binding.transform?.type === 'round' && (
            <label className="block">
              <span className="text-zinc-500 text-xs">Decimals</span>
              <input
                type="number"
                min="0"
                max="10"
                value={binding.transform.decimals}
                onChange={(e) =>
                  handleChange('transform', { type: 'round', decimals: parseInt(e.target.value, 10) })
                }
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}
