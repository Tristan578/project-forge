'use client';

import { useState, useCallback, useMemo } from 'react';
import { Activity, Zap, Copy, Check } from 'lucide-react';
import {
  DDA_PRESETS,
  createDefaultProfile,
  calculateDifficultyAdjustment,
  generateDDAScript,
  type DDAConfig,
  type DifficultyProfile,
} from '@/lib/ai/difficultyAdjustment';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRESET_LABELS: Record<string, string> = {
  gentle: 'Gentle',
  standard: 'Standard',
  hardcore: 'Hardcore',
  adaptive_story: 'Adaptive Story',
  competitive: 'Competitive',
};

const PRESET_DESCRIPTIONS: Record<string, string> = {
  gentle: 'Slow adjustment, wide range, lots of forgiveness',
  standard: 'Moderate adjustment, normal range',
  hardcore: 'Fast adjustment, narrow range, always challenging',
  adaptive_story: 'Adjusts toward easy on repeated deaths, story-focused',
  competitive: 'Only adjusts upward, never easier',
};

// ---------------------------------------------------------------------------
// Difficulty curve SVG
// ---------------------------------------------------------------------------

interface CurvePreviewProps {
  config: DDAConfig;
  currentLevel: number;
}

function CurvePreview({ config, currentLevel }: CurvePreviewProps) {
  const points = useMemo(() => {
    const pts: string[] = [];
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Simulate how the difficulty curve looks across the min-max range
      const x = (t * 200) + 10;
      const y = 60 - ((config.minDifficulty + t * (config.maxDifficulty - config.minDifficulty)) * 50);
      pts.push(`${x},${y}`);
    }
    return pts.join(' ');
  }, [config.minDifficulty, config.maxDifficulty]);

  const indicatorX = 10 + (currentLevel / 1.0) * 200;
  const indicatorY = 60 - currentLevel * 50;

  return (
    <svg
      viewBox="0 0 220 70"
      className="w-full h-16 rounded border border-zinc-700 bg-zinc-950"
      role="img"
      aria-label={`Difficulty curve from ${config.minDifficulty} to ${config.maxDifficulty}, current level ${Math.round(currentLevel * 100)}%`}
    >
      {/* Grid lines */}
      <line x1="10" y1="10" x2="10" y2="60" stroke="#3f3f46" strokeWidth="0.5" />
      <line x1="10" y1="60" x2="210" y2="60" stroke="#3f3f46" strokeWidth="0.5" />
      <line x1="10" y1="35" x2="210" y2="35" stroke="#3f3f46" strokeWidth="0.5" strokeDasharray="2" />

      {/* Min/max range fill */}
      <rect
        x="10"
        y={60 - config.maxDifficulty * 50}
        width="200"
        height={(config.maxDifficulty - config.minDifficulty) * 50}
        fill="#3b82f6"
        opacity="0.1"
      />

      {/* Curve */}
      <polyline
        points={points}
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.5"
      />

      {/* Current level indicator */}
      <circle
        cx={indicatorX}
        cy={indicatorY}
        r="4"
        fill="#22c55e"
        stroke="#15803d"
        strokeWidth="1"
      />

      {/* Labels */}
      <text x="2" y="8" fontSize="6" fill="#71717a">max</text>
      <text x="2" y="68" fontSize="6" fill="#71717a">min</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Slider component
// ---------------------------------------------------------------------------

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}

function SliderField({ label, value, min, max, step, onChange, format }: SliderFieldProps) {
  const display = format ? format(value) : value.toFixed(2);
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-300">
      <span className="w-28 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-blue-500 h-1"
      />
      <span className="w-12 text-right font-mono text-zinc-500">{display}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Profile display
// ---------------------------------------------------------------------------

interface ProfileDisplayProps {
  profile: DifficultyProfile;
}

function ProfileDisplay({ profile }: ProfileDisplayProps) {
  const rows = useMemo(() => [
    { label: 'Enemy Health', value: profile.enemyHealthMultiplier },
    { label: 'Enemy Damage', value: profile.enemyDamageMultiplier },
    { label: 'Enemy Speed', value: profile.enemySpeedMultiplier },
    { label: 'Resource Drop', value: profile.resourceDropRate },
    { label: 'Checkpoints', value: profile.checkpointFrequency },
    { label: 'Hint Delay', value: profile.hintDelay, suffix: 's' },
  ], [profile]);

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between text-zinc-400">
          <span>{r.label}</span>
          <span className="font-mono text-zinc-300">
            {r.value.toFixed(2)}{r.suffix ?? 'x'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function DifficultyPanel() {
  const [presetKey, setPresetKey] = useState('standard');
  const [config, setConfig] = useState<DDAConfig>({ ...DDA_PRESETS.standard });
  const [profile, setProfile] = useState<DifficultyProfile>(createDefaultProfile());
  const [copied, setCopied] = useState(false);

  // Simulated performance for preview
  const [simDeaths, setSimDeaths] = useState(0.5);
  const [simTime, setSimTime] = useState(180);

  const handlePresetChange = useCallback((key: string) => {
    setPresetKey(key);
    const preset = DDA_PRESETS[key];
    if (preset) {
      setConfig({ ...preset });
    }
  }, []);

  const handleConfigChange = useCallback((field: keyof DDAConfig, value: number | boolean) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    setPresetKey('custom');
  }, []);

  const simulatedProfile = useMemo(() => {
    return calculateDifficultyAdjustment(
      {
        deathsPerMinute: simDeaths,
        averageHealthOnDeath: 30,
        timePerLevel: simTime,
        itemUsageRate: 0.3,
        skillRating: 50,
      },
      profile,
      config,
    );
  }, [simDeaths, simTime, profile, config]);

  const handleSimulate = useCallback(() => {
    setProfile(simulatedProfile);
  }, [simulatedProfile]);

  const handleGenerateScript = useCallback(async () => {
    const script = generateDDAScript(config);
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    } catch {
      // Clipboard API may not be available
    }
  }, [config]);

  const handleReset = useCallback(() => {
    setProfile(createDefaultProfile());
    setPresetKey('standard');
    setConfig({ ...DDA_PRESETS.standard });
  }, []);

  const levelPercent = Math.round(profile.level * 100);

  return (
    <div className="flex flex-col gap-3 p-3 text-xs overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Activity size={14} className="text-blue-400" />
        <h3 className="text-xs font-semibold uppercase text-zinc-400">
          Dynamic Difficulty
        </h3>
      </div>

      {/* Enable toggle */}
      <label className="flex items-center gap-2 text-zinc-300">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => handleConfigChange('enabled', e.target.checked)}
          className="accent-blue-500"
        />
        <span>Enable DDA</span>
      </label>

      {/* Preset selector */}
      <div className="space-y-1">
        <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Preset</span>
        <div className="grid grid-cols-2 gap-1">
          {Object.keys(DDA_PRESETS).map((key) => (
            <button
              key={key}
              onClick={() => handlePresetChange(key)}
              className={`rounded px-2 py-1 text-left transition-colors ${
                presetKey === key
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
              title={PRESET_DESCRIPTIONS[key]}
              aria-pressed={presetKey === key}
            >
              {PRESET_LABELS[key]}
            </button>
          ))}
        </div>
        {presetKey !== 'custom' && PRESET_DESCRIPTIONS[presetKey] && (
          <p className="text-[10px] text-zinc-500 mt-1">{PRESET_DESCRIPTIONS[presetKey]}</p>
        )}
      </div>

      {/* Config sliders */}
      <div className="space-y-2">
        <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Settings</span>
        <SliderField
          label="Sensitivity"
          value={config.sensitivity}
          min={0.1}
          max={1.0}
          step={0.05}
          onChange={(v) => handleConfigChange('sensitivity', v)}
        />
        <SliderField
          label="Min Difficulty"
          value={config.minDifficulty}
          min={0}
          max={0.9}
          step={0.05}
          onChange={(v) => handleConfigChange('minDifficulty', v)}
        />
        <SliderField
          label="Max Difficulty"
          value={config.maxDifficulty}
          min={0.1}
          max={1.0}
          step={0.05}
          onChange={(v) => handleConfigChange('maxDifficulty', v)}
        />
        <SliderField
          label="Adjust Speed"
          value={config.adjustmentSpeed}
          min={0.01}
          max={0.3}
          step={0.01}
          onChange={(v) => handleConfigChange('adjustmentSpeed', v)}
        />
        <SliderField
          label="Cooldown"
          value={config.cooldownSeconds}
          min={1}
          max={60}
          step={1}
          onChange={(v) => handleConfigChange('cooldownSeconds', v)}
          format={(v) => `${v}s`}
        />
      </div>

      {/* Difficulty curve preview */}
      <div className="space-y-1">
        <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Difficulty Curve</span>
        <CurvePreview config={config} currentLevel={profile.level} />
      </div>

      {/* Current level */}
      <div className="flex items-center gap-2 rounded bg-zinc-800 p-2">
        <Zap size={12} className="text-yellow-400" />
        <span className="text-zinc-300">Current Level</span>
        <span className="ml-auto font-mono text-lg font-bold text-white">{levelPercent}%</span>
      </div>

      {/* Profile breakdown */}
      <div className="space-y-1">
        <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Active Multipliers</span>
        <ProfileDisplay profile={profile} />
      </div>

      {/* Simulation controls */}
      <div className="space-y-2 rounded border border-zinc-700 p-2">
        <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Simulate Player</span>
        <SliderField
          label="Deaths/min"
          value={simDeaths}
          min={0}
          max={5}
          step={0.1}
          onChange={setSimDeaths}
        />
        <SliderField
          label="Time/level (s)"
          value={simTime}
          min={10}
          max={600}
          step={10}
          onChange={setSimTime}
          format={(v) => `${v}s`}
        />
        <button
          onClick={handleSimulate}
          className="w-full rounded bg-zinc-700 py-1.5 text-zinc-200 hover:bg-zinc-600 transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none"
        >
          Apply Simulated Adjustment
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleGenerateScript}
          className="flex flex-1 items-center justify-center gap-1 rounded bg-blue-600 py-1.5 text-white hover:bg-blue-500 transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none"
          aria-label="Copy generated DDA script to clipboard"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Generate Script'}
        </button>
        <button
          onClick={handleReset}
          className="rounded bg-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-600 transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none"
          aria-label="Reset difficulty to defaults"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
