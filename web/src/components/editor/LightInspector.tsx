'use client';

import { useCallback } from 'react';
import { useEditorStore, type LightData } from '@/stores/editorStore';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

/** Convert linear RGB [0-1] to sRGB hex string. */
function linearToHex(r: number, g: number, b: number): string {
  const toSrgb = (c: number) => Math.round(Math.pow(Math.max(0, Math.min(1, c)), 1 / 2.2) * 255);
  const rr = toSrgb(r).toString(16).padStart(2, '0');
  const gg = toSrgb(g).toString(16).padStart(2, '0');
  const bb = toSrgb(b).toString(16).padStart(2, '0');
  return `#${rr}${gg}${bb}`;
}

/** Convert sRGB hex string to linear RGB [0-1] array. */
function hexToLinear(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => Math.pow(c, 2.2);
  return [toLinear(r), toLinear(g), toLinear(b)];
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function LightInspector() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const primaryLight = useEditorStore((s) => s.primaryLight);
  const updateLight = useEditorStore((s) => s.updateLight);

  const handleUpdate = useCallback(
    (partial: Partial<LightData>) => {
      if (primaryId && primaryLight) {
        updateLight(primaryId, { ...primaryLight, ...partial });
      }
    },
    [primaryId, primaryLight, updateLight]
  );

  if (!primaryLight) return null;

  const colorHex = linearToHex(
    primaryLight.color[0],
    primaryLight.color[1],
    primaryLight.color[2]
  );

  const isDirectional = primaryLight.lightType === 'directional';
  const isSpot = primaryLight.lightType === 'spot';

  const typeLabel =
    primaryLight.lightType === 'point'
      ? 'Point'
      : primaryLight.lightType === 'directional'
        ? 'Directional'
        : 'Spot';

  const intensityLabel = isDirectional ? 'Illuminance' : 'Intensity';
  const intensityMax = isDirectional ? 150_000 : 1_000_000;

  return (
    <div className="border-t border-zinc-800 pt-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Light ({typeLabel})
      </h3>

      <div className="space-y-3">
        {/* Color */}
        <div className="flex items-center gap-2">
          <label className="w-20 shrink-0 text-xs text-zinc-400">Color</label>
          <input
            type="color"
            value={colorHex}
            onChange={(e) => {
              const [r, g, b] = hexToLinear(e.target.value);
              handleUpdate({ color: [r, g, b] });
            }}
            className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
          />
          <span className="text-xs text-zinc-500">{colorHex}</span>
        </div>

        {/* Intensity */}
        <div className="flex items-center gap-2">
          <label className="w-20 shrink-0 text-xs text-zinc-400">{intensityLabel}<InfoTooltip term="intensity" /></label>
          <input
            type="range"
            min={0}
            max={intensityMax}
            step={isDirectional ? 100 : 1000}
            value={primaryLight.intensity}
            onChange={(e) => handleUpdate({ intensity: parseFloat(e.target.value) })}
            className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
              [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-zinc-300"
          />
          <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
            {primaryLight.intensity.toFixed(0)}
          </span>
        </div>

        {/* Range (Point/Spot only) */}
        {!isDirectional && (
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Range<InfoTooltip term="range" /></label>
            <input
              type="range"
              min={1}
              max={100}
              step={0.5}
              value={primaryLight.range}
              onChange={(e) => handleUpdate({ range: parseFloat(e.target.value) })}
              className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
                [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-zinc-300"
            />
            <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
              {primaryLight.range.toFixed(1)}
            </span>
          </div>
        )}

        {/* Radius (Point/Spot only) */}
        {!isDirectional && (
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Radius</label>
            <input
              type="range"
              min={0}
              max={5}
              step={0.05}
              value={primaryLight.radius}
              onChange={(e) => handleUpdate({ radius: parseFloat(e.target.value) })}
              className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
                [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-zinc-300"
            />
            <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
              {primaryLight.radius.toFixed(2)}
            </span>
          </div>
        )}

        {/* Spot angles */}
        {isSpot && (
          <>
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Inner Angle<InfoTooltip term="innerAngle" /></label>
              <input
                type="range"
                min={0}
                max={radToDeg(primaryLight.outerAngle)}
                step={1}
                value={radToDeg(primaryLight.innerAngle)}
                onChange={(e) => handleUpdate({ innerAngle: degToRad(parseFloat(e.target.value)) })}
                className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
                  [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-zinc-300"
              />
              <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                {radToDeg(primaryLight.innerAngle).toFixed(0)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Outer Angle<InfoTooltip term="outerAngle" /></label>
              <input
                type="range"
                min={radToDeg(primaryLight.innerAngle)}
                max={89}
                step={1}
                value={radToDeg(primaryLight.outerAngle)}
                onChange={(e) => handleUpdate({ outerAngle: degToRad(parseFloat(e.target.value)) })}
                className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
                  [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-zinc-300"
              />
              <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                {radToDeg(primaryLight.outerAngle).toFixed(0)}
              </span>
            </div>
          </>
        )}

        {/* Shadows */}
        <div className="flex items-center gap-2">
          <label className="w-20 shrink-0 text-xs text-zinc-400">Shadows</label>
          <input
            type="checkbox"
            checked={primaryLight.shadowsEnabled}
            onChange={(e) => handleUpdate({ shadowsEnabled: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
              focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
          />
        </div>

        {/* Shadow bias (only when shadows enabled) */}
        {primaryLight.shadowsEnabled && (
          <>
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Depth Bias<InfoTooltip term="shadowDepthBias" /></label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={primaryLight.shadowDepthBias}
                onChange={(e) => handleUpdate({ shadowDepthBias: parseFloat(e.target.value) })}
                className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
                  [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-zinc-300"
              />
              <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                {primaryLight.shadowDepthBias.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Normal Bias<InfoTooltip term="shadowNormalBias" /></label>
              <input
                type="range"
                min={0}
                max={10}
                step={0.1}
                value={primaryLight.shadowNormalBias}
                onChange={(e) => handleUpdate({ shadowNormalBias: parseFloat(e.target.value) })}
                className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
                  [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-zinc-300"
              />
              <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                {primaryLight.shadowNormalBias.toFixed(1)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
