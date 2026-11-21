'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  generateQuestChain,
  validateGenerateOptions,
  exportQuestChainToScript,
  CHAIN_TEMPLATES,
  type QuestChain,
  type ChainTemplateId,
  type Quest,
} from '@/lib/ai/questGenerator';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ObjectiveList({ quest }: { quest: Quest }) {
  return (
    <ul className="ml-4 space-y-1">
      {quest.objectives.map((obj) => (
        <li key={obj.id} className="text-xs text-zinc-400">
          <span className={obj.optional ? 'italic text-zinc-400' : ''}>
            {obj.optional ? '(Optional) ' : ''}
            {obj.description}
          </span>
          <span className="ml-1 text-zinc-400">
            [{obj.current}/{obj.required}]
          </span>
        </li>
      ))}
    </ul>
  );
}

function RewardList({ quest }: { quest: Quest }) {
  return (
    <div className="ml-4 flex flex-wrap gap-2">
      {quest.rewards.map((reward, idx) => (
        <span
          key={idx}
          className="inline-block rounded bg-zinc-800 px-2 py-0.5 text-xs text-amber-400"
        >
          {reward.amount} {reward.name}
        </span>
      ))}
    </div>
  );
}

function QuestCard({ quest, isExpanded, onToggle }: {
  quest: Quest;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const statusColors: Record<string, string> = {
    locked: 'text-zinc-400',
    available: 'text-green-400',
    active: 'text-blue-400',
    completed: 'text-emerald-400',
    failed: 'text-red-400',
  };

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${statusColors[quest.status] ?? 'text-zinc-400'}`}>
            [{quest.status}]
          </span>
          <span className="text-sm font-medium text-zinc-200">{quest.title}</span>
        </div>
        <span className="text-xs text-zinc-400">Lv.{quest.level}</span>
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-zinc-400">{quest.description}</p>
          <p className="text-xs italic text-zinc-400">{quest.narrativeHook}</p>
          <div className="text-xs text-zinc-400">
            NPC: {quest.giverNpc} | Location: {quest.location}
          </div>

          <div>
            <div className="text-xs font-medium text-zinc-300">Objectives</div>
            <ObjectiveList quest={quest} />
          </div>

          <div>
            <div className="text-xs font-medium text-zinc-300">Rewards</div>
            <RewardList quest={quest} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

const TEMPLATE_IDS = Object.keys(CHAIN_TEMPLATES) as ChainTemplateId[];

export function QuestGeneratorPanel() {
  const [templateId, setTemplateId] = useState<ChainTemplateId>('hero_origin');
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState(3);
  const [questCount, setQuestCount] = useState<number | undefined>(undefined);
  const [chain, setChain] = useState<QuestChain | null>(null);
  const [expandedQuests, setExpandedQuests] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const selectedTemplate = CHAIN_TEMPLATES[templateId];

  const validationErrors = useMemo(() => {
    if (!description.trim()) return [];
    return validateGenerateOptions({
      templateId,
      playerDescription: description,
      difficulty,
      questCount,
    });
  }, [templateId, description, difficulty, questCount]);

  const handleGenerate = useCallback(() => {
    setError(null);
    try {
      const result = generateQuestChain({
        templateId,
        playerDescription: description,
        difficulty,
        questCount,
      });
      setChain(result);
      setExpandedQuests(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    }
  }, [templateId, description, difficulty, questCount]);

  const handleExport = useCallback(() => {
    if (!chain) return;
    const script = exportQuestChainToScript(chain);
    const blob = new Blob([script], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${chain.id}.js`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [chain]);

  const toggleQuest = useCallback((questId: string) => {
    setExpandedQuests((prev) => {
      const next = new Set(prev);
      if (next.has(questId)) {
        next.delete(questId);
      } else {
        next.add(questId);
      }
      return next;
    });
  }, []);

  const canGenerate = description.trim().length > 0 && validationErrors.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="border-b border-zinc-800 px-3 py-2">
        <h2 className="text-sm font-semibold">Quest Generator</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Template Picker */}
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">
            Chain Template
          </label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value as ChainTemplateId)}
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-blue-500 focus:outline-none"
          >
            {TEMPLATE_IDS.map((id) => (
              <option key={id} value={id}>
                {CHAIN_TEMPLATES[id].name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-400">{selectedTemplate.description}</p>
          <p className="mt-0.5 text-xs text-zinc-400">
            Arc: {selectedTemplate.arcDescription}
          </p>
        </div>

        {/* Description Input */}
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">
            Quest Description / Theme
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the quest theme, e.g. 'a brave knight seeking a lost artifact'"
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
            rows={3}
            maxLength={200}
          />
          <div className="mt-0.5 text-right text-xs text-zinc-400">
            {description.length}/200
          </div>
        </div>

        {/* Difficulty */}
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">
            Difficulty: {difficulty}
          </label>
          <input
            type="range"
            min={1}
            max={10}
            value={difficulty}
            onChange={(e) => setDifficulty(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-zinc-400">
            <span>Easy</span>
            <span>Hard</span>
          </div>
        </div>

        {/* Quest Count */}
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">
            Quest Count (default: {selectedTemplate.questCount})
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={questCount ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              setQuestCount(val === '' ? undefined : Number(val));
            }}
            placeholder={String(selectedTemplate.questCount)}
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
          />
        </div>

        {/* Validation Errors */}
        {validationErrors.length > 0 && (
          <div className="rounded border border-red-800 bg-red-950/50 p-2">
            {validationErrors.map((err, i) => (
              <p key={i} className="text-xs text-red-400">{err}</p>
            ))}
          </div>
        )}

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="w-full rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
        >
          Generate Quest Chain
        </button>

        {/* Error Display */}
        {error && (
          <div className="rounded border border-red-800 bg-red-950/50 p-2">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Generated Chain */}
        {chain && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200">{chain.name}</h3>
              <button
                onClick={handleExport}
                className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                Export Script
              </button>
            </div>
            <p className="text-xs text-zinc-400">{chain.description}</p>

            <div className="space-y-2">
              {chain.quests.map((quest) => (
                <QuestCard
                  key={quest.id}
                  quest={quest}
                  isExpanded={expandedQuests.has(quest.id)}
                  onToggle={() => toggleQuest(quest.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
