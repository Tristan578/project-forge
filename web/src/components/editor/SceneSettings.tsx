'use client';

import { useCallback, useState } from 'react';
import { Sparkles, HelpCircle, Smartphone, Wifi } from 'lucide-react';
import { useEditorStore, type AmbientLightData, type EnvironmentData, type ColorGradingSectionData, type QualityPreset } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useMultiplayerStore } from '@/stores/multiplayerStore';
import { GenerateSkyboxDialog } from './GenerateSkyboxDialog';
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

const sliderClass = `h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
  [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
  [&::-webkit-slider-thumb]:bg-zinc-300`;

export function SceneSettings() {
  const [colorGradingSection, setColorGradingSection] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');
  const [generateSkyboxOpen, setGenerateSkyboxOpen] = useState(false);

  const ambientLight = useEditorStore((s) => s.ambientLight);
  const updateAmbientLight = useEditorStore((s) => s.updateAmbientLight);
  const environment = useEditorStore((s) => s.environment);
  const updateEnvironment = useEditorStore((s) => s.updateEnvironment);
  const setSkybox = useEditorStore((s) => s.setSkybox);
  const removeSkybox = useEditorStore((s) => s.removeSkybox);
  const updateSkybox = useEditorStore((s) => s.updateSkybox);
  const postProcessing = useEditorStore((s) => s.postProcessing);
  const updateBloom = useEditorStore((s) => s.updateBloom);
  const updateChromaticAberration = useEditorStore((s) => s.updateChromaticAberration);
  const updateColorGrading = useEditorStore((s) => s.updateColorGrading);
  const updateSharpening = useEditorStore((s) => s.updateSharpening);
  const updateSsao = useEditorStore((s) => s.updateSsao);
  const updateDepthOfField = useEditorStore((s) => s.updateDepthOfField);
  const updateMotionBlur = useEditorStore((s) => s.updateMotionBlur);
  const qualityPreset = useEditorStore((s) => s.qualityPreset);
  const setQualityPreset = useEditorStore((s) => s.setQualityPreset);
  const mobileTouchConfig = useEditorStore((s) => s.mobileTouchConfig);
  const setMobileTouchConfig = useEditorStore((s) => s.setMobileTouchConfig);
  const updateMobileTouchConfig = useEditorStore((s) => s.updateMobileTouchConfig);
  const navigateDocs = useWorkspaceStore((s) => s.navigateDocs);

  const handleAmbientUpdate = useCallback(
    (partial: Partial<AmbientLightData>) => {
      updateAmbientLight(partial);
    },
    [updateAmbientLight]
  );

  const handleEnvUpdate = useCallback(
    (partial: Partial<EnvironmentData>) => {
      updateEnvironment(partial);
    },
    [updateEnvironment]
  );

  const ambientColorHex = linearToHex(
    ambientLight.color[0],
    ambientLight.color[1],
    ambientLight.color[2]
  );

  const clearColorHex = linearToHex(
    environment.clearColor[0],
    environment.clearColor[1],
    environment.clearColor[2]
  );

  const fogColorHex = linearToHex(
    environment.fogColor[0],
    environment.fogColor[1],
    environment.fogColor[2]
  );

  return (
    <div className="space-y-4">
      {/* Quality Preset */}
      <div className="border-t border-zinc-800 pt-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Quality Preset
        </h3>
        <div className="flex items-center gap-2">
          <label className="w-20 shrink-0 text-xs text-zinc-400">Preset<InfoTooltip term="qualityPreset" /></label>
          <select
            value={qualityPreset}
            onChange={(e) => setQualityPreset(e.target.value as QualityPreset)}
            className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300
              focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="ultra">Ultra</option>
          </select>
        </div>
        <p className="mt-1 text-[9px] text-zinc-600">
          Adjusts MSAA, shadows, bloom, sharpening, and particle density
        </p>
      </div>

      {/* Ambient Light */}
      <div className="border-t border-zinc-800 pt-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Ambient Light<InfoTooltip term="ambientLight" />
        </h3>

        <div className="space-y-3">
          {/* Color */}
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Color<InfoTooltip text="The color of ambient light filling the scene" /></label>
            <input
              type="color"
              value={ambientColorHex}
              onChange={(e) => {
                const [r, g, b] = hexToLinear(e.target.value);
                handleAmbientUpdate({ color: [r, g, b] });
              }}
              className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
            />
            <span className="text-xs text-zinc-500">{ambientColorHex}</span>
          </div>

          {/* Brightness */}
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Brightness<InfoTooltip text="How bright the ambient light is" /></label>
            <input
              type="range"
              min={0}
              max={2000}
              step={10}
              value={ambientLight.brightness}
              onChange={(e) => handleAmbientUpdate({ brightness: parseFloat(e.target.value) })}
              className={sliderClass}
            />
            <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
              {ambientLight.brightness.toFixed(0)}
            </span>
          </div>
        </div>
      </div>

      {/* Environment */}
      <div className="border-t border-zinc-800 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Environment
            </h3>
            <button onClick={() => navigateDocs('features/scene-management')} className="rounded p-0.5 text-zinc-600 hover:text-zinc-400" title="Documentation">
              <HelpCircle size={12} />
            </button>
          </div>
          <button
            onClick={() => setGenerateSkyboxOpen(true)}
            className="flex items-center gap-1 rounded bg-purple-900/30 px-2 py-0.5 text-[10px] text-purple-400 hover:bg-purple-900/50"
            title="Generate skybox with AI"
          >
            <Sparkles size={10} />
            Generate Skybox
          </button>
        </div>

        <div className="space-y-3">
          {/* Clear Color */}
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Clear Color<InfoTooltip term="clearColor" /></label>
            <input
              type="color"
              value={clearColorHex}
              onChange={(e) => {
                const [r, g, b] = hexToLinear(e.target.value);
                handleEnvUpdate({ clearColor: [r, g, b] });
              }}
              className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
            />
            <span className="text-xs text-zinc-500">{clearColorHex}</span>
          </div>

          {/* Skybox Preset */}
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Skybox<InfoTooltip term="skybox" /></label>
            <select
              value={environment.skyboxPreset || 'none'}
              onChange={(e) => {
                const value = e.target.value;
                if (value === 'none') {
                  removeSkybox();
                } else {
                  setSkybox(value);
                }
              }}
              className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300
                focus:border-blue-500 focus:outline-none"
            >
              <option value="none">None</option>
              <option value="studio">Studio</option>
              <option value="sunset">Sunset</option>
              <option value="overcast">Overcast</option>
              <option value="night">Night</option>
              <option value="bright_day">Bright Day</option>
            </select>
          </div>

          {/* Skybox Brightness (shown when skybox active) */}
          {environment.skyboxPreset && (
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Brightness<InfoTooltip term="skyboxBrightness" /></label>
              <input
                type="range"
                min={100}
                max={5000}
                step={50}
                value={environment.skyboxBrightness}
                onChange={(e) => updateSkybox({ brightness: parseFloat(e.target.value) })}
                className={sliderClass}
              />
              <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                {environment.skyboxBrightness.toFixed(0)}
              </span>
            </div>
          )}

          {/* IBL Intensity (shown when skybox active) */}
          {environment.skyboxPreset && (
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">IBL<InfoTooltip term="ibl" /></label>
              <input
                type="range"
                min={100}
                max={5000}
                step={50}
                value={environment.iblIntensity}
                onChange={(e) => updateSkybox({ iblIntensity: parseFloat(e.target.value) })}
                className={sliderClass}
              />
              <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                {environment.iblIntensity.toFixed(0)}
              </span>
            </div>
          )}

          {/* IBL Rotation (shown when skybox active) */}
          {environment.skyboxPreset && (
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Rotation<InfoTooltip term="skyboxRotation" /></label>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={environment.iblRotationDegrees}
                onChange={(e) => updateSkybox({ rotation: parseFloat(e.target.value) })}
                className={sliderClass}
              />
              <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                {environment.iblRotationDegrees.toFixed(0)}°
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Fog */}
      <div className="border-t border-zinc-800 pt-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Fog<InfoTooltip term="fog" />
        </h3>

        <div className="space-y-3">
          {/* Enabled toggle */}
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Enabled<InfoTooltip text="Turn fog on or off" /></label>
            <input
              type="checkbox"
              checked={environment.fogEnabled}
              onChange={(e) => handleEnvUpdate({ fogEnabled: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
                focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
            />
          </div>

          {/* Fog controls (only when enabled) */}
          {environment.fogEnabled && (
            <>
              {/* Fog Color */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Color<InfoTooltip text="The color objects fade into with distance" /></label>
                <input
                  type="color"
                  value={fogColorHex}
                  onChange={(e) => {
                    const [r, g, b] = hexToLinear(e.target.value);
                    handleEnvUpdate({ fogColor: [r, g, b] });
                  }}
                  className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
                />
                <span className="text-xs text-zinc-500">{fogColorHex}</span>
              </div>

              {/* Fog Start */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Start<InfoTooltip text="The distance where fog starts to appear" /></label>
                <input
                  type="range"
                  min={0}
                  max={environment.fogEnd}
                  step={1}
                  value={environment.fogStart}
                  onChange={(e) => handleEnvUpdate({ fogStart: parseFloat(e.target.value) })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {environment.fogStart.toFixed(0)}
                </span>
              </div>

              {/* Fog End */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">End<InfoTooltip text="The distance where objects are fully hidden by fog" /></label>
                <input
                  type="range"
                  min={environment.fogStart}
                  max={500}
                  step={1}
                  value={environment.fogEnd}
                  onChange={(e) => handleEnvUpdate({ fogEnd: parseFloat(e.target.value) })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {environment.fogEnd.toFixed(0)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bloom */}
      <div className="border-t border-zinc-800 pt-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Bloom<InfoTooltip term="bloom" />
        </h3>

        <div className="space-y-3">
          {/* Enabled toggle */}
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Enabled<InfoTooltip text="Turn the glow effect on or off" /></label>
            <input
              type="checkbox"
              checked={postProcessing.bloom.enabled}
              onChange={(e) => updateBloom({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
                focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
            />
          </div>

          {/* Bloom controls (only when enabled) */}
          {postProcessing.bloom.enabled && (
            <>
              {/* Intensity */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Intensity<InfoTooltip term="bloomIntensity" /></label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={postProcessing.bloom.intensity}
                  onChange={(e) => updateBloom({ intensity: parseFloat(e.target.value) })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.bloom.intensity.toFixed(2)}
                </span>
              </div>

              {/* Low Freq Boost */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Low Freq Boost<InfoTooltip term="bloomLowFreqBoost" /></label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={postProcessing.bloom.lowFrequencyBoost}
                  onChange={(e) => updateBloom({ lowFrequencyBoost: parseFloat(e.target.value) })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.bloom.lowFrequencyBoost.toFixed(2)}
                </span>
              </div>

              {/* High Pass */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">High Pass<InfoTooltip term="bloomHighPass" /></label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={postProcessing.bloom.highPassFrequency}
                  onChange={(e) => updateBloom({ highPassFrequency: parseFloat(e.target.value) })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.bloom.highPassFrequency.toFixed(2)}
                </span>
              </div>

              {/* Threshold */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Threshold<InfoTooltip term="bloomThreshold" /></label>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.1}
                  value={postProcessing.bloom.prefilterThreshold}
                  onChange={(e) => updateBloom({ prefilterThreshold: parseFloat(e.target.value) })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.bloom.prefilterThreshold.toFixed(1)}
                </span>
              </div>

              {/* Softness */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Softness<InfoTooltip term="bloomSoftness" /></label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={postProcessing.bloom.prefilterThresholdSoftness}
                  onChange={(e) => updateBloom({ prefilterThresholdSoftness: parseFloat(e.target.value) })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.bloom.prefilterThresholdSoftness.toFixed(2)}
                </span>
              </div>

              {/* Composite Mode */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Mode<InfoTooltip term="bloomMode" /></label>
                <select
                  value={postProcessing.bloom.compositeMode}
                  onChange={(e) => updateBloom({ compositeMode: e.target.value as 'energy_conserving' | 'additive' })}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300
                    focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="energy_conserving">Energy Conserving</option>
                  <option value="additive">Additive</option>
                </select>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Chromatic Aberration */}
      <div className="border-t border-zinc-800 pt-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Chromatic Aberration<InfoTooltip term="chromaticAberration" />
        </h3>

        <div className="space-y-3">
          {/* Enabled toggle */}
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Enabled</label>
            <input
              type="checkbox"
              checked={postProcessing.chromaticAberration.enabled}
              onChange={(e) => updateChromaticAberration({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
                focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
            />
          </div>

          {/* CA controls (only when enabled) */}
          {postProcessing.chromaticAberration.enabled && (
            <>
              {/* Intensity */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Intensity<InfoTooltip term="caIntensity" /></label>
                <input
                  type="range"
                  min={0}
                  max={0.2}
                  step={0.001}
                  value={postProcessing.chromaticAberration.intensity}
                  onChange={(e) => updateChromaticAberration({ intensity: parseFloat(e.target.value) })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.chromaticAberration.intensity.toFixed(3)}
                </span>
              </div>

              {/* Max Samples */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Max Samples<InfoTooltip term="caMaxSamples" /></label>
                <input
                  type="range"
                  min={2}
                  max={32}
                  step={2}
                  value={postProcessing.chromaticAberration.maxSamples}
                  onChange={(e) => updateChromaticAberration({ maxSamples: parseInt(e.target.value) })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.chromaticAberration.maxSamples}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Color Grading */}
      <div className="border-t border-zinc-800 pt-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Color Grading<InfoTooltip term="colorGrading" />
        </h3>

        <div className="space-y-3">
          {/* Enabled toggle */}
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Enabled</label>
            <input
              type="checkbox"
              checked={postProcessing.colorGrading.enabled}
              onChange={(e) => updateColorGrading({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
                focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
            />
          </div>

          {/* Color grading controls (only when enabled) */}
          {postProcessing.colorGrading.enabled && (
            <>
              {/* Global section header */}
              <div className="mt-2 text-xs font-semibold text-zinc-400">Global<InfoTooltip text="Color adjustments that affect the entire image" /></div>

              {/* Exposure */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Exposure<InfoTooltip term="exposure" /></label>
                <input
                  type="range"
                  min={-3}
                  max={3}
                  step={0.05}
                  value={postProcessing.colorGrading.global.exposure}
                  onChange={(e) => updateColorGrading({ global: { ...postProcessing.colorGrading.global, exposure: parseFloat(e.target.value) } })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.colorGrading.global.exposure.toFixed(2)}
                </span>
              </div>

              {/* Temperature */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Temperature<InfoTooltip term="temperature" /></label>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={postProcessing.colorGrading.global.temperature}
                  onChange={(e) => updateColorGrading({ global: { ...postProcessing.colorGrading.global, temperature: parseFloat(e.target.value) } })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.colorGrading.global.temperature.toFixed(2)}
                </span>
              </div>

              {/* Tint */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Tint<InfoTooltip term="tint" /></label>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={postProcessing.colorGrading.global.tint}
                  onChange={(e) => updateColorGrading({ global: { ...postProcessing.colorGrading.global, tint: parseFloat(e.target.value) } })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.colorGrading.global.tint.toFixed(2)}
                </span>
              </div>

              {/* Hue (show as degrees) */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Hue<InfoTooltip term="hue" /></label>
                <input
                  type="range"
                  min={-3.14159}
                  max={3.14159}
                  step={0.01}
                  value={postProcessing.colorGrading.global.hue}
                  onChange={(e) => updateColorGrading({ global: { ...postProcessing.colorGrading.global, hue: parseFloat(e.target.value) } })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {Math.round((postProcessing.colorGrading.global.hue * 180) / Math.PI)}°
                </span>
              </div>

              {/* Post Saturation */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Saturation<InfoTooltip term="saturation" /></label>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.01}
                  value={postProcessing.colorGrading.global.postSaturation}
                  onChange={(e) => updateColorGrading({ global: { ...postProcessing.colorGrading.global, postSaturation: parseFloat(e.target.value) } })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.colorGrading.global.postSaturation.toFixed(2)}
                </span>
              </div>

              {/* Section tabs */}
              <div className="mt-3 flex gap-1 border-t border-zinc-800 pt-2">
                <button
                  onClick={() => setColorGradingSection('shadows')}
                  className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
                    colorGradingSection === 'shadows'
                      ? 'bg-zinc-700 text-zinc-200'
                      : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-750'
                  }`}
                  title="Adjust the darkest parts of the image"
                >
                  Shadows
                </button>
                <button
                  onClick={() => setColorGradingSection('midtones')}
                  className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
                    colorGradingSection === 'midtones'
                      ? 'bg-zinc-700 text-zinc-200'
                      : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-750'
                  }`}
                  title="Adjust the middle brightness values"
                >
                  Midtones
                </button>
                <button
                  onClick={() => setColorGradingSection('highlights')}
                  className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
                    colorGradingSection === 'highlights'
                      ? 'bg-zinc-700 text-zinc-200'
                      : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-750'
                  }`}
                  title="Adjust the brightest parts of the image"
                >
                  Highlights
                </button>
              </div>

              {/* Section controls */}
              {(() => {
                const section = postProcessing.colorGrading[colorGradingSection];
                const updateSection = (partial: Partial<ColorGradingSectionData>) => {
                  updateColorGrading({ [colorGradingSection]: { ...section, ...partial } });
                };

                return (
                  <div className="space-y-2 pt-2">
                    {/* Saturation */}
                    <div className="flex items-center gap-2">
                      <label className="w-20 shrink-0 text-xs text-zinc-400">Saturation<InfoTooltip term="saturation" /></label>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.01}
                        value={section.saturation}
                        onChange={(e) => updateSection({ saturation: parseFloat(e.target.value) })}
                        className={sliderClass}
                      />
                      <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                        {section.saturation.toFixed(2)}
                      </span>
                    </div>

                    {/* Contrast */}
                    <div className="flex items-center gap-2">
                      <label className="w-20 shrink-0 text-xs text-zinc-400">Contrast<InfoTooltip term="contrast" /></label>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.01}
                        value={section.contrast}
                        onChange={(e) => updateSection({ contrast: parseFloat(e.target.value) })}
                        className={sliderClass}
                      />
                      <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                        {section.contrast.toFixed(2)}
                      </span>
                    </div>

                    {/* Gamma */}
                    <div className="flex items-center gap-2">
                      <label className="w-20 shrink-0 text-xs text-zinc-400">Gamma<InfoTooltip term="gamma" /></label>
                      <input
                        type="range"
                        min={0.1}
                        max={3}
                        step={0.01}
                        value={section.gamma}
                        onChange={(e) => updateSection({ gamma: parseFloat(e.target.value) })}
                        className={sliderClass}
                      />
                      <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                        {section.gamma.toFixed(2)}
                      </span>
                    </div>

                    {/* Gain */}
                    <div className="flex items-center gap-2">
                      <label className="w-20 shrink-0 text-xs text-zinc-400">Gain<InfoTooltip term="gain" /></label>
                      <input
                        type="range"
                        min={0}
                        max={3}
                        step={0.01}
                        value={section.gain}
                        onChange={(e) => updateSection({ gain: parseFloat(e.target.value) })}
                        className={sliderClass}
                      />
                      <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                        {section.gain.toFixed(2)}
                      </span>
                    </div>

                    {/* Lift */}
                    <div className="flex items-center gap-2">
                      <label className="w-20 shrink-0 text-xs text-zinc-400">Lift<InfoTooltip term="lift" /></label>
                      <input
                        type="range"
                        min={-0.5}
                        max={0.5}
                        step={0.01}
                        value={section.lift}
                        onChange={(e) => updateSection({ lift: parseFloat(e.target.value) })}
                        className={sliderClass}
                      />
                      <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                        {section.lift.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>

      {/* Sharpening (CAS) */}
      <div className="border-t border-zinc-800 pt-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Sharpening<InfoTooltip term="sharpening" />
        </h3>

        <div className="space-y-3">
          {/* Enabled toggle */}
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Enabled</label>
            <input
              type="checkbox"
              checked={postProcessing.sharpening.enabled}
              onChange={(e) => updateSharpening({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
                focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
            />
          </div>

          {/* Sharpening controls (only when enabled) */}
          {postProcessing.sharpening.enabled && (
            <>
              {/* Strength */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Strength<InfoTooltip term="sharpenStrength" /></label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={postProcessing.sharpening.sharpeningStrength}
                  onChange={(e) => updateSharpening({ sharpeningStrength: parseFloat(e.target.value) })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.sharpening.sharpeningStrength.toFixed(2)}
                </span>
              </div>

              {/* Denoise */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Denoise<InfoTooltip term="sharpenDenoise" /></label>
                <input
                  type="checkbox"
                  checked={postProcessing.sharpening.denoise}
                  onChange={(e) => updateSharpening({ denoise: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
                    focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* SSAO (WebGPU only) */}
      {typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu && (
        <div className="border-t border-zinc-800 pt-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            SSAO<InfoTooltip term="ssao" />
          </h3>

          <div className="space-y-3">
            {/* Enabled toggle */}
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Enabled</label>
              <input
                type="checkbox"
                checked={postProcessing.ssao !== null}
                onChange={(e) => {
                  if (e.target.checked) {
                    updateSsao({ quality: 'medium' });
                  } else {
                    updateSsao(null);
                  }
                }}
                className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
                  focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
              />
            </div>

            {/* SSAO controls (only when enabled) */}
            {postProcessing.ssao && (
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Quality<InfoTooltip term="ssaoQuality" /></label>
                <select
                  value={postProcessing.ssao.quality}
                  onChange={(e) => updateSsao({ quality: e.target.value as 'low' | 'medium' | 'high' | 'ultra' })}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300
                    focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="ultra">Ultra</option>
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Depth of Field */}
      <div className="border-t border-zinc-800 pt-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Depth of Field<InfoTooltip term="depthOfField" />
        </h3>

        <div className="space-y-3">
          {/* Enabled toggle */}
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Enabled</label>
            <input
              type="checkbox"
              checked={postProcessing.depthOfField !== null}
              onChange={(e) => {
                if (e.target.checked) {
                  updateDepthOfField({
                    mode: 'gaussian',
                    focalDistance: 10.0,
                    apertureFStops: 5.6,
                    sensorHeight: 0.024,
                    maxCircleOfConfusionDiameter: 0.1,
                    maxDepth: 100.0,
                  });
                } else {
                  updateDepthOfField(null);
                }
              }}
              className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
                focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
            />
          </div>

          {/* DOF controls (only when enabled) */}
          {postProcessing.depthOfField && (
            <>
              {/* Mode */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Mode<InfoTooltip term="dofMode" /></label>
                <select
                  value={postProcessing.depthOfField.mode}
                  onChange={(e) => updateDepthOfField({ ...postProcessing.depthOfField!, mode: e.target.value as 'gaussian' | 'bokeh' })}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300
                    focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="gaussian">Gaussian</option>
                  <option value="bokeh">Bokeh</option>
                </select>
              </div>

              {/* Focal Distance */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Focal Dist<InfoTooltip term="dofFocalDist" /></label>
                <input
                  type="range"
                  min={0.1}
                  max={100}
                  step={0.1}
                  value={postProcessing.depthOfField.focalDistance}
                  onChange={(e) => updateDepthOfField({ ...postProcessing.depthOfField!, focalDistance: parseFloat(e.target.value) })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.depthOfField.focalDistance.toFixed(1)}
                </span>
              </div>

              {/* Aperture f-stops */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Aperture f<InfoTooltip term="dofAperture" /></label>
                <input
                  type="range"
                  min={1}
                  max={32}
                  step={0.1}
                  value={postProcessing.depthOfField.apertureFStops}
                  onChange={(e) => updateDepthOfField({ ...postProcessing.depthOfField!, apertureFStops: parseFloat(e.target.value) })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.depthOfField.apertureFStops.toFixed(1)}
                </span>
              </div>

              {/* Max blur diameter */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Max Blur<InfoTooltip term="dofMaxBlur" /></label>
                <input
                  type="range"
                  min={0.01}
                  max={1.0}
                  step={0.01}
                  value={postProcessing.depthOfField.maxCircleOfConfusionDiameter}
                  onChange={(e) => updateDepthOfField({ ...postProcessing.depthOfField!, maxCircleOfConfusionDiameter: parseFloat(e.target.value) })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.depthOfField.maxCircleOfConfusionDiameter.toFixed(2)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Motion Blur */}
      <div className="border-t border-zinc-800 pt-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Motion Blur<InfoTooltip term="motionBlur" />
        </h3>

        <div className="space-y-3">
          {/* Enabled toggle */}
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Enabled</label>
            <input
              type="checkbox"
              checked={postProcessing.motionBlur !== null}
              onChange={(e) => {
                if (e.target.checked) {
                  updateMotionBlur({ shutterAngle: 0.5, samples: 4 });
                } else {
                  updateMotionBlur(null);
                }
              }}
              className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
                focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
            />
          </div>

          {/* Motion blur controls (only when enabled) */}
          {postProcessing.motionBlur && (
            <>
              {/* Shutter Angle */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Shutter<InfoTooltip term="motionBlurShutter" /></label>
                <input
                  type="range"
                  min={0}
                  max={1.0}
                  step={0.01}
                  value={postProcessing.motionBlur.shutterAngle}
                  onChange={(e) => updateMotionBlur({ ...postProcessing.motionBlur!, shutterAngle: parseFloat(e.target.value) })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.motionBlur.shutterAngle.toFixed(2)}
                </span>
              </div>

              {/* Samples */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Samples<InfoTooltip term="motionBlurSamples" /></label>
                <input
                  type="range"
                  min={1}
                  max={8}
                  step={1}
                  value={postProcessing.motionBlur.samples}
                  onChange={(e) => updateMotionBlur({ ...postProcessing.motionBlur!, samples: parseInt(e.target.value) })}
                  className={sliderClass}
                />
                <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                  {postProcessing.motionBlur.samples}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Multiplayer */}
      <div className="border-t border-zinc-800 pt-4">
        <h3 className="mb-3 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          <Wifi size={12} />
          Multiplayer
        </h3>
        <MultiplayerSection />
      </div>

      {/* Mobile Controls */}
      <div className="border-t border-zinc-800 pt-4">
        <h3 className="mb-3 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          <Smartphone size={12} />
          Mobile Controls
        </h3>

        <div className="space-y-3">
          {/* Enable toggle */}
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Enabled</label>
            <input type="checkbox" checked={mobileTouchConfig.enabled}
              onChange={(e) => updateMobileTouchConfig({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-1 focus:ring-blue-500 focus:ring-offset-0" />
          </div>

          {mobileTouchConfig.enabled && (
            <>
              {/* Preset dropdown */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Preset</label>
                <select value={mobileTouchConfig.preset}
                  onChange={(e) => {
                    const preset = e.target.value;
                    // Import getDefaultTouchPreset dynamically to avoid circular deps
                    import('@/lib/export/touchControls').then(({ getDefaultTouchPreset }) => {
                      const config = getDefaultTouchPreset(preset);
                      setMobileTouchConfig(config);
                    }).catch(() => {
                      // If module doesn't exist yet, just update preset
                      updateMobileTouchConfig({ preset });
                    });
                  }}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
                  <option value="platformer">Platformer</option>
                  <option value="fps">FPS</option>
                  <option value="topdown">Top Down</option>
                  <option value="racing">Racing</option>
                  <option value="puzzle">Puzzle</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              {/* Joystick section */}
              {mobileTouchConfig.joystick && (
                <>
                  <div className="mt-2 text-xs font-semibold text-zinc-400">Joystick</div>
                  <div className="flex items-center gap-2">
                    <label className="w-20 shrink-0 text-xs text-zinc-400">Position</label>
                    <select value={mobileTouchConfig.joystick.position}
                      onChange={(e) => updateMobileTouchConfig({
                        joystick: { ...mobileTouchConfig.joystick!, position: e.target.value as 'bottom-left' | 'bottom-right' },
                      })}
                      className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-blue-500 focus:outline-none">
                      <option value="bottom-left">Bottom Left</option>
                      <option value="bottom-right">Bottom Right</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="w-20 shrink-0 text-xs text-zinc-400">Size</label>
                    <input type="range" min={60} max={200} step={10}
                      value={mobileTouchConfig.joystick.size}
                      onChange={(e) => updateMobileTouchConfig({
                        joystick: { ...mobileTouchConfig.joystick!, size: parseInt(e.target.value) },
                      })}
                      className={sliderClass} />
                    <span className="w-12 text-right text-xs tabular-nums text-zinc-500">{mobileTouchConfig.joystick.size}px</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="w-20 shrink-0 text-xs text-zinc-400">Opacity</label>
                    <input type="range" min={0.1} max={1} step={0.05}
                      value={mobileTouchConfig.joystick.opacity}
                      onChange={(e) => updateMobileTouchConfig({
                        joystick: { ...mobileTouchConfig.joystick!, opacity: parseFloat(e.target.value) },
                      })}
                      className={sliderClass} />
                    <span className="w-12 text-right text-xs tabular-nums text-zinc-500">{(mobileTouchConfig.joystick.opacity * 100).toFixed(0)}%</span>
                  </div>
                </>
              )}

              {/* Buttons list */}
              <div className="mt-2 text-xs font-semibold text-zinc-400">
                Buttons ({mobileTouchConfig.buttons.length})
              </div>
              {mobileTouchConfig.buttons.map((btn) => (
                <div key={btn.id} className="flex items-center gap-2 rounded bg-zinc-800/50 px-2 py-1">
                  <span className="w-6 text-center text-sm">{btn.icon}</span>
                  <span className="flex-1 text-xs text-zinc-300">{btn.action}</span>
                  <span className="text-[10px] text-zinc-500">{btn.size}px</span>
                </div>
              ))}

              {/* Auto quality reduction */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Auto Low</label>
                <input type="checkbox" checked={mobileTouchConfig.autoReduceQuality}
                  onChange={(e) => updateMobileTouchConfig({ autoReduceQuality: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-1 focus:ring-blue-500 focus:ring-offset-0" />
                <span className="text-[10px] text-zinc-500">Reduce quality on mobile</span>
              </div>

              {/* Orientation */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Orientation</label>
                <select value={mobileTouchConfig.preferredOrientation}
                  onChange={(e) => updateMobileTouchConfig({
                    preferredOrientation: e.target.value as 'any' | 'landscape' | 'portrait',
                  })}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-blue-500 focus:outline-none">
                  <option value="any">Any</option>
                  <option value="landscape">Landscape</option>
                  <option value="portrait">Portrait</option>
                </select>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Generation dialog */}
      <GenerateSkyboxDialog
        isOpen={generateSkyboxOpen}
        onClose={() => setGenerateSkyboxOpen(false)}
      />
    </div>
  );
}

/** Multiplayer configuration section */
function MultiplayerSection() {
  const { networkConfig, setNetworkConfig } = useMultiplayerStore();

  return (
    <div className="space-y-3">
      {/* Enable toggle */}
      <div className="flex items-center gap-2">
        <label className="w-20 shrink-0 text-xs text-zinc-400">Enabled</label>
        <input
          type="checkbox"
          checked={networkConfig.enabled}
          onChange={(e) => setNetworkConfig({ enabled: e.target.checked })}
          className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
        />
      </div>

      {networkConfig.enabled && (
        <>
          {/* Server URL */}
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Server</label>
            <input
              type="text"
              value={networkConfig.serverUrl}
              onChange={(e) => setNetworkConfig({ serverUrl: e.target.value })}
              placeholder="ws://localhost:2567"
              className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Max Players */}
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Max Players</label>
            <input
              type="range"
              min="2"
              max="16"
              value={networkConfig.maxPlayers}
              onChange={(e) => setNetworkConfig({ maxPlayers: parseInt(e.target.value) })}
              className={sliderClass}
            />
            <span className="w-12 text-right text-xs tabular-nums text-zinc-500">{networkConfig.maxPlayers}</span>
          </div>

          {/* Room Type */}
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Room Type</label>
            <select
              value={networkConfig.roomType}
              onChange={(e) => setNetworkConfig({ roomType: e.target.value })}
              className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-blue-500 focus:outline-none"
            >
              <option value="custom">Custom</option>
              <option value="platformer">Platformer</option>
              <option value="arena">Arena</option>
              <option value="lobby">Lobby</option>
            </select>
          </div>

          {/* Info note */}
          <p className="text-[10px] text-zinc-500 italic">
            See Inspector panel for spawn points and synced properties.
          </p>
        </>
      )}
    </div>
  );
}
