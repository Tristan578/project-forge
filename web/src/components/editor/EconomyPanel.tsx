'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  Coins,
  ShoppingCart,
  Dices,
  TrendingUp,
  CheckCircle,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Copy,
  Download,
} from 'lucide-react';
import {
  ECONOMY_PRESETS,
  validateBalance,
  economyToScript,
  generateEconomy,
  type GameEconomy,
  type BalanceReport,
} from '@/lib/ai/economyDesigner';

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

function Section({
  title,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-800">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-200 transition-colors"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Balance score badge
// ---------------------------------------------------------------------------

function ScoreBadge({ report }: { report: BalanceReport }) {
  const color = report.score >= 80
    ? 'text-green-400'
    : report.score >= 50
      ? 'text-yellow-400'
      : 'text-red-400';

  return (
    <div className="flex items-center gap-2">
      <span className={`text-lg font-bold ${color}`}>{report.score}</span>
      <span className="text-[10px] text-zinc-500">/100</span>
      {report.passed ? (
        <CheckCircle size={14} className="text-green-400" />
      ) : (
        <XCircle size={14} className="text-red-400" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// XP Curve mini visualization (text-based bar chart)
// ---------------------------------------------------------------------------

function XpCurveChart({ xpPerLevel }: { xpPerLevel: number[] }) {
  const maxXp = Math.max(...xpPerLevel, 1);
  // Show at most 20 bars
  const step = Math.max(1, Math.floor(xpPerLevel.length / 20));
  const sampled = xpPerLevel.filter((_, i) => i % step === 0);

  return (
    <div className="flex items-end gap-px h-16">
      {sampled.map((xp, i) => {
        const height = Math.max(2, (xp / maxXp) * 100);
        return (
          <div
            key={i}
            className="flex-1 min-w-[3px] bg-blue-500 rounded-t-sm transition-all"
            style={{ height: `${height}%` }}
            title={`Level ${i * step + 1}: ${xp} XP`}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preset selector
// ---------------------------------------------------------------------------

const PRESET_LABELS: Record<string, string> = {
  casual_mobile: 'Casual / Mobile',
  rpg_classic: 'Classic RPG',
  roguelike: 'Roguelike',
  idle_incremental: 'Idle / Incremental',
  competitive_pvp: 'Competitive PvP',
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function EconomyPanel() {
  const [economy, setEconomy] = useState<GameEconomy | null>(null);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);

  const report = useMemo(
    () => (economy ? validateBalance(economy) : null),
    [economy],
  );

  const script = useMemo(
    () => (economy ? economyToScript(economy) : ''),
    [economy],
  );

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const result = await generateEconomy(
        description || 'A balanced game',
        selectedPreset || undefined,
      );
      setEconomy(result);
    } finally {
      setGenerating(false);
    }
  }, [description, selectedPreset]);

  const handleLoadPreset = useCallback((presetKey: string) => {
    setSelectedPreset(presetKey);
    if (ECONOMY_PRESETS[presetKey]) {
      setEconomy(structuredClone(ECONOMY_PRESETS[presetKey]));
    }
  }, []);

  const handleCopyScript = useCallback(() => {
    navigator.clipboard.writeText(script).then(() => {
      setScriptCopied(true);
      setTimeout(() => setScriptCopied(false), 2000);
    });
  }, [script]);

  const handleDownloadScript = useCallback(() => {
    const blob = new Blob([script], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'economy.js';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [script]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-900 text-zinc-300 text-xs">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Coins size={14} className="text-yellow-400" />
        <span className="text-sm font-semibold text-zinc-100">Economy Designer</span>
      </div>

      {/* Generation controls */}
      <div className="space-y-2 border-b border-zinc-800 p-3">
        <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          Preset
        </label>
        <select
          value={selectedPreset}
          onChange={(e) => handleLoadPreset(e.target.value)}
          className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 border border-zinc-700 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          aria-label="Economy preset"
        >
          <option value="">Select a preset...</option>
          {Object.entries(PRESET_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          Game Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe your game for AI-generated economy..."
          className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 border border-zinc-700 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
          rows={2}
          aria-label="Game description for economy generation"
        />

        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          aria-label="Generate economy"
        >
          <Sparkles size={12} />
          {generating ? 'Generating...' : 'Generate Economy'}
        </button>
      </div>

      {/* Empty state */}
      {!economy && (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <div className="space-y-2">
            <Coins size={32} className="mx-auto text-zinc-600" />
            <p className="text-zinc-500">
              Select a preset or describe your game to generate a balanced economy.
            </p>
          </div>
        </div>
      )}

      {/* Economy data */}
      {economy && report && (
        <>
          {/* Balance Score */}
          <Section title="Balance Score" icon={<CheckCircle size={12} />}>
            <div className="space-y-2">
              <ScoreBadge report={report} />
              {report.issues.length > 0 && (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {report.issues.map((issue, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[11px]">
                      {issue.severity === 'error' ? (
                        <XCircle size={11} className="mt-0.5 shrink-0 text-red-400" />
                      ) : issue.severity === 'warning' ? (
                        <AlertTriangle size={11} className="mt-0.5 shrink-0 text-yellow-400" />
                      ) : (
                        <CheckCircle size={11} className="mt-0.5 shrink-0 text-zinc-500" />
                      )}
                      <span className="text-zinc-400">{issue.message}</span>
                    </div>
                  ))}
                </div>
              )}
              {report.issues.length === 0 && (
                <p className="text-green-400 text-[11px]">No issues found. Economy is well-balanced.</p>
              )}
            </div>
          </Section>

          {/* Currencies */}
          <Section title={`Currencies (${economy.currencies.length})`} icon={<Coins size={12} />}>
            <div className="space-y-2">
              {economy.currencies.map((c) => (
                <div key={c.name} className="rounded bg-zinc-800 p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-zinc-200">{c.name}</span>
                    <span className="text-[10px] text-zinc-500">+{c.earnRate}/tick</span>
                  </div>
                  <div className="mt-1 text-[10px] text-zinc-500">
                    Sinks: {c.sinks.join(', ') || 'none'}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Shop */}
          <Section title={`Shop Items (${economy.shop.length})`} icon={<ShoppingCart size={12} />}>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-zinc-500">
                    <th className="pb-1 pr-2">Name</th>
                    <th className="pb-1 pr-2">Price</th>
                    <th className="pb-1 pr-2">Unlock</th>
                    <th className="pb-1">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {economy.shop.map((item) => (
                    <tr key={item.name} className="border-t border-zinc-800">
                      <td className="py-1 pr-2 text-zinc-200">{item.name}</td>
                      <td className="py-1 pr-2">
                        {item.price} {item.currency}
                      </td>
                      <td className="py-1 pr-2">Lv.{item.unlockLevel}</td>
                      <td className="py-1 text-zinc-500">{item.category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Loot Tables */}
          <Section title={`Loot Tables (${economy.lootTables.length})`} icon={<Dices size={12} />}>
            <div className="space-y-2">
              {economy.lootTables.map((table) => {
                const totalWeight = table.entries.reduce((s, e) => s + e.weight, 0);
                return (
                  <div key={table.name} className="rounded bg-zinc-800 p-2">
                    <div className="font-medium text-zinc-200 mb-1">{table.name}</div>
                    {table.guaranteedDrops && table.guaranteedDrops.length > 0 && (
                      <div className="text-[10px] text-green-400 mb-1">
                        Guaranteed: {table.guaranteedDrops.join(', ')}
                      </div>
                    )}
                    <div className="space-y-0.5">
                      {table.entries.map((entry, i) => {
                        const pct = totalWeight > 0 ? ((entry.weight / totalWeight) * 100).toFixed(1) : '0';
                        return (
                          <div key={i} className="flex items-center gap-2 text-[11px]">
                            <div
                              className="h-1.5 rounded bg-blue-500"
                              style={{ width: `${Math.max(4, Number(pct))}%`, minWidth: '4px' }}
                            />
                            <span className="text-zinc-300">{entry.item}</span>
                            <span className="text-zinc-500 ml-auto">{pct}%</span>
                            <span className="text-zinc-600">
                              ({entry.minQuantity}-{entry.maxQuantity})
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* Progression */}
          <Section title="Progression" icon={<TrendingUp size={12} />}>
            <div className="space-y-2">
              <div className="flex justify-between text-[11px]">
                <span className="text-zinc-500">Levels: {economy.progression.levels}</span>
                <span className="text-zinc-500">
                  XP range: {economy.progression.xpPerLevel[0]} - {economy.progression.xpPerLevel[economy.progression.xpPerLevel.length - 1]}
                </span>
              </div>
              <div className="rounded bg-zinc-800 p-2">
                <div className="text-[10px] text-zinc-500 mb-1">XP Curve</div>
                <XpCurveChart xpPerLevel={economy.progression.xpPerLevel} />
              </div>
            </div>
          </Section>

          {/* Script output */}
          <Section title="Generated Script" icon={<Copy size={12} />} defaultOpen={false}>
            <div className="space-y-2">
              <div className="flex gap-1">
                <button
                  onClick={handleCopyScript}
                  className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                  aria-label="Copy script to clipboard"
                >
                  <Copy size={10} />
                  {scriptCopied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={handleDownloadScript}
                  className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                  aria-label="Download script"
                >
                  <Download size={10} />
                  Download
                </button>
              </div>
              <pre className="max-h-60 overflow-auto rounded bg-zinc-950 p-2 text-[10px] text-zinc-400 font-mono">
                {script}
              </pre>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
