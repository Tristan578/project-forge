'use client';

import { useUIBuilderStore, type UIWidget, type WidgetConstraints } from '@/stores/uiBuilderStore';
import { DataBindingEditor } from './DataBindingEditor';

const EMPTY_CONSTRAINTS: WidgetConstraints = {
  offsetX: 0,
  offsetY: 0,
  minWidth: null,
  maxWidth: null,
  minHeight: null,
  maxHeight: null,
};

export function WidgetPropertyPanel() {
  const activeScreenId = useUIBuilderStore((s) => s.activeScreenId);
  const selectedWidgetId = useUIBuilderStore((s) => s.selectedWidgetId);
  const screens = useUIBuilderStore((s) => s.screens);
  const updateWidget = useUIBuilderStore((s) => s.updateWidget);
  const moveWidget = useUIBuilderStore((s) => s.moveWidget);
  const resizeWidget = useUIBuilderStore((s) => s.resizeWidget);

  const activeScreen = screens.find((s) => s.id === activeScreenId);
  const widget = activeScreen?.widgets.find((w) => w.id === selectedWidgetId);

  if (!widget || !activeScreenId) return null;

  const handleChange = (field: string, value: unknown) => {
    updateWidget(activeScreenId, widget.id, { [field]: value });
  };

  const handlePositionChange = (axis: 'x' | 'y', value: number) => {
    const clamped = Math.max(0, Math.min(100, value));
    if (axis === 'x') {
      moveWidget(activeScreenId, widget.id, clamped, widget.y);
    } else {
      moveWidget(activeScreenId, widget.id, widget.x, clamped);
    }
  };

  const handleSizeChange = (dimension: 'width' | 'height', value: number) => {
    const clamped = Math.max(0, Math.min(100, value));
    if (dimension === 'width') {
      resizeWidget(activeScreenId, widget.id, clamped, widget.height);
    } else {
      resizeWidget(activeScreenId, widget.id, widget.width, clamped);
    }
  };

  const handleConfigChange = (field: string, value: unknown) => {
    const updatedConfig = { ...widget.config, [field]: value };
    updateWidget(activeScreenId, widget.id, { config: updatedConfig } as Partial<UIWidget>);
  };

  const constraints: WidgetConstraints = widget.constraints ?? EMPTY_CONSTRAINTS;

  const handleOffsetChange = (field: 'offsetX' | 'offsetY', raw: string) => {
    const n = Number(raw);
    const next: WidgetConstraints = { ...constraints, [field]: Number.isFinite(n) ? n : 0 };
    updateWidget(activeScreenId, widget.id, { constraints: next });
  };

  const handleBoundChange = (
    field: 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight',
    raw: string
  ) => {
    // Empty input clears the bound (unconstrained); negatives clamp to 0.
    let value: number | null = null;
    if (raw.trim() !== '') {
      const n = Number(raw);
      value = Number.isFinite(n) ? Math.max(0, n) : null;
    }
    const next: WidgetConstraints = { ...constraints, [field]: value };
    updateWidget(activeScreenId, widget.id, { constraints: next });
  };

  const widthConflict =
    constraints.minWidth !== null &&
    constraints.maxWidth !== null &&
    constraints.minWidth > constraints.maxWidth;
  const heightConflict =
    constraints.minHeight !== null &&
    constraints.maxHeight !== null &&
    constraints.minHeight > constraints.maxHeight;

  const boundValue = (v: number | null): string => (v === null ? '' : String(v));

  return (
    <div className="space-y-3 text-xs">
      {/* Common properties */}
      <div className="space-y-2">
        <label className="block">
          <span className="text-zinc-400">Name</span>
          <input
            type="text"
            value={widget.name}
            onChange={(e) => handleChange('name', e.target.value)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-zinc-400">X (%)</span>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={widget.x}
              onChange={(e) => handlePositionChange('x', parseFloat(e.target.value))}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
            />
          </label>

          <label className="block">
            <span className="text-zinc-400">Y (%)</span>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={widget.y}
              onChange={(e) => handlePositionChange('y', parseFloat(e.target.value))}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-zinc-400">Width (%)</span>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={widget.width}
              onChange={(e) => handleSizeChange('width', parseFloat(e.target.value))}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
            />
          </label>

          <label className="block">
            <span className="text-zinc-400">Height (%)</span>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={widget.height}
              onChange={(e) => handleSizeChange('height', parseFloat(e.target.value))}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-zinc-400">Anchor</span>
          <select
            value={widget.anchor}
            onChange={(e) => handleChange('anchor', e.target.value)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
          >
            <option value="top_left">Top Left</option>
            <option value="top_center">Top Center</option>
            <option value="top_right">Top Right</option>
            <option value="center_left">Center Left</option>
            <option value="center">Center</option>
            <option value="center_right">Center Right</option>
            <option value="bottom_left">Bottom Left</option>
            <option value="bottom_center">Bottom Center</option>
            <option value="bottom_right">Bottom Right</option>
          </select>
        </label>

        {/* Responsive layout constraints (ui.FR-1.OP-01) */}
        <div className="border-t border-zinc-800 pt-2">
          <span className="text-zinc-400 block mb-1 font-semibold">Layout Constraints</span>
          <p className="text-zinc-500 text-[10px] mb-2">
            Pixel offsets from the anchor and min/max size bounds. Leave a bound blank for
            unconstrained. Bounds keep core actions tappable (e.g. 44px) from mobile to desktop.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-zinc-400">Offset X (px)</span>
              <input
                type="number"
                step="1"
                value={constraints.offsetX}
                onChange={(e) => handleOffsetChange('offsetX', e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
              />
            </label>
            <label className="block">
              <span className="text-zinc-400">Offset Y (px)</span>
              <input
                type="number"
                step="1"
                value={constraints.offsetY}
                onChange={(e) => handleOffsetChange('offsetY', e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-2">
            <label className="block">
              <span className="text-zinc-400">Min Width (px)</span>
              <input
                type="number"
                min="0"
                placeholder="none"
                value={boundValue(constraints.minWidth)}
                onChange={(e) => handleBoundChange('minWidth', e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
              />
            </label>
            <label className="block">
              <span className="text-zinc-400">Max Width (px)</span>
              <input
                type="number"
                min="0"
                placeholder="none"
                value={boundValue(constraints.maxWidth)}
                onChange={(e) => handleBoundChange('maxWidth', e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
              />
            </label>
          </div>
          {widthConflict && (
            <p role="alert" className="text-amber-400 text-[10px] mt-1">
              Min Width ({constraints.minWidth}px) exceeds Max Width ({constraints.maxWidth}px); the
              minimum will win at render.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 mt-2">
            <label className="block">
              <span className="text-zinc-400">Min Height (px)</span>
              <input
                type="number"
                min="0"
                placeholder="none"
                value={boundValue(constraints.minHeight)}
                onChange={(e) => handleBoundChange('minHeight', e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
              />
            </label>
            <label className="block">
              <span className="text-zinc-400">Max Height (px)</span>
              <input
                type="number"
                min="0"
                placeholder="none"
                value={boundValue(constraints.maxHeight)}
                onChange={(e) => handleBoundChange('maxHeight', e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
              />
            </label>
          </div>
          {heightConflict && (
            <p role="alert" className="text-amber-400 text-[10px] mt-1">
              Min Height ({constraints.minHeight}px) exceeds Max Height ({constraints.maxHeight}px);
              the minimum will win at render.
            </p>
          )}
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={widget.visible}
              onChange={(e) => handleChange('visible', e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-800 text-blue-600"
            />
            <span className="text-zinc-400">Visible</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={widget.interactable}
              onChange={(e) => handleChange('interactable', e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-800 text-blue-600"
            />
            <span className="text-zinc-400">Interactable</span>
          </label>
        </div>
      </div>

      {/* Type-specific properties */}
      <div className="border-t border-zinc-800 pt-3">
        <h4 className="text-zinc-400 font-semibold mb-2">Type-Specific Settings</h4>

        {widget.type === 'text' && (
          <div className="space-y-2">
            <label className="block">
              <span className="text-zinc-400">Content</span>
              <textarea
                value={widget.config.content}
                onChange={(e) => handleConfigChange('content', e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300 h-20"
                placeholder="Use {{variableName}} for bindings"
              />
            </label>
            <DataBindingEditor
              screenId={activeScreenId}
              widgetId={widget.id}
              property="binding"
              binding={widget.config.binding}
            />
          </div>
        )}

        {widget.type === 'image' && (
          <div className="space-y-2">
            <label className="block">
              <span className="text-zinc-400">Asset ID</span>
              <input
                type="text"
                value={widget.config.assetId ?? ''}
                onChange={(e) => handleConfigChange('assetId', e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
                placeholder="asset_123"
              />
            </label>
            <label className="block">
              <span className="text-zinc-400">Fit</span>
              <select
                value={widget.config.fit}
                onChange={(e) => handleConfigChange('fit', e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
              >
                <option value="contain">Contain</option>
                <option value="cover">Cover</option>
                <option value="fill">Fill</option>
                <option value="none">None</option>
              </select>
            </label>
          </div>
        )}

        {widget.type === 'button' && (
          <div className="space-y-2">
            <label className="block">
              <span className="text-zinc-400">Label</span>
              <input
                type="text"
                value={widget.config.label}
                onChange={(e) => handleConfigChange('label', e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
              />
            </label>
            <label className="block">
              <span className="text-zinc-400">Action</span>
              <select
                value={widget.config.action.type}
                onChange={(e) => handleConfigChange('action', { type: e.target.value })}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
              >
                <option value="none">None</option>
                <option value="show_screen">Show Screen</option>
                <option value="hide_screen">Hide Screen</option>
                <option value="toggle_screen">Toggle Screen</option>
                <option value="set_state">Set State</option>
                <option value="call_function">Call Function</option>
                <option value="scene_reset">Reset Scene</option>
              </select>
            </label>
          </div>
        )}

        {widget.type === 'progress_bar' && (
          <div className="space-y-2">
            <DataBindingEditor
              screenId={activeScreenId}
              widgetId={widget.id}
              property="valueBinding"
              binding={widget.config.valueBinding}
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-zinc-400">Min</span>
                <input
                  type="number"
                  value={widget.config.min}
                  onChange={(e) => handleConfigChange('min', parseFloat(e.target.value))}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
                />
              </label>
              <label className="block">
                <span className="text-zinc-400">Max</span>
                <input
                  type="number"
                  value={widget.config.max}
                  onChange={(e) => handleConfigChange('max', parseFloat(e.target.value))}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-zinc-400">Direction</span>
              <select
                value={widget.config.direction}
                onChange={(e) => handleConfigChange('direction', e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
              >
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
                <option value="radial">Radial</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-zinc-400">Fill Color</span>
                <input
                  type="color"
                  value={widget.config.fillColor}
                  onChange={(e) => handleConfigChange('fillColor', e.target.value)}
                  className="mt-1 w-full h-8 rounded border border-zinc-700 bg-zinc-800"
                />
              </label>
              <label className="block">
                <span className="text-zinc-400">Track Color</span>
                <input
                  type="color"
                  value={widget.config.trackColor}
                  onChange={(e) => handleConfigChange('trackColor', e.target.value)}
                  className="mt-1 w-full h-8 rounded border border-zinc-700 bg-zinc-800"
                />
              </label>
            </div>
          </div>
        )}

        {widget.type === 'slider' && (
          <div className="space-y-2">
            <DataBindingEditor
              screenId={activeScreenId}
              widgetId={widget.id}
              property="valueBinding"
              binding={widget.config.valueBinding}
            />
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="text-zinc-400">Min</span>
                <input
                  type="number"
                  value={widget.config.min}
                  onChange={(e) => handleConfigChange('min', parseFloat(e.target.value))}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
                />
              </label>
              <label className="block">
                <span className="text-zinc-400">Max</span>
                <input
                  type="number"
                  value={widget.config.max}
                  onChange={(e) => handleConfigChange('max', parseFloat(e.target.value))}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
                />
              </label>
              <label className="block">
                <span className="text-zinc-400">Step</span>
                <input
                  type="number"
                  value={widget.config.step}
                  onChange={(e) => handleConfigChange('step', parseFloat(e.target.value))}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
                />
              </label>
            </div>
          </div>
        )}

        {widget.type === 'toggle' && (
          <div className="space-y-2">
            <DataBindingEditor
              screenId={activeScreenId}
              widgetId={widget.id}
              property="valueBinding"
              binding={widget.config.valueBinding}
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-zinc-400">On Label</span>
                <input
                  type="text"
                  value={widget.config.onLabel}
                  onChange={(e) => handleConfigChange('onLabel', e.target.value)}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
                />
              </label>
              <label className="block">
                <span className="text-zinc-400">Off Label</span>
                <input
                  type="text"
                  value={widget.config.offLabel}
                  onChange={(e) => handleConfigChange('offLabel', e.target.value)}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
