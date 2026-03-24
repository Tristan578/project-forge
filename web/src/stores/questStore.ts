import { create } from 'zustand';
import type { Quest, QuestChain, ChainTemplateId, Objective, Reward } from '@/lib/ai/questGenerator';

// Re-export for convenience
export type { Quest, QuestChain, ChainTemplateId, Objective, Reward };

// ============================================================================
// Types
// ============================================================================

export interface QuestStore {
  /** All quest chains indexed by chain id */
  chains: Record<string, QuestChain>;

  // --- Actions ---
  /** Add or replace a quest chain */
  addChain: (chain: QuestChain) => void;
  /** Remove a quest chain by id */
  removeChain: (chainId: string) => void;
  /** Update a single objective on a quest */
  updateObjective: (
    chainId: string,
    questId: string,
    objectiveId: string,
    patch: Partial<Quest['objectives'][number]>,
  ) => void;
  /** Update top-level fields of a quest */
  updateQuest: (chainId: string, questId: string, patch: Partial<Quest>) => void;
  /** Clear all quest chains */
  clearAll: () => void;

  // --- Selectors (computed helpers, not stored) ---
  getChain: (chainId: string) => QuestChain | undefined;
  getQuest: (chainId: string, questId: string) => Quest | undefined;
  listChains: () => QuestChain[];
}

// ============================================================================
// Store
// ============================================================================

export const useQuestStore = create<QuestStore>((set, get) => ({
  chains: {},

  addChain: (chain) =>
    set((state) => ({
      chains: { ...state.chains, [chain.id]: chain },
    })),

  removeChain: (chainId) =>
    set((state) => {
      const next = { ...state.chains };
      delete next[chainId];
      return { chains: next };
    }),

  updateObjective: (chainId, questId, objectiveId, patch) =>
    set((state) => {
      const chain = state.chains[chainId];
      if (!chain) return state;
      const quests = chain.quests.map((q) => {
        if (q.id !== questId) return q;
        const objectives = q.objectives.map((o) =>
          o.id === objectiveId ? { ...o, ...patch } : o,
        );
        return { ...q, objectives };
      });
      return { chains: { ...state.chains, [chainId]: { ...chain, quests } } };
    }),

  updateQuest: (chainId, questId, patch) =>
    set((state) => {
      const chain = state.chains[chainId];
      if (!chain) return state;
      const quests = chain.quests.map((q) =>
        q.id === questId ? { ...q, ...patch } : q,
      );
      return { chains: { ...state.chains, [chainId]: { ...chain, quests } } };
    }),

  clearAll: () => set({ chains: {} }),

  getChain: (chainId) => get().chains[chainId],

  getQuest: (chainId, questId) =>
    get().chains[chainId]?.quests.find((q) => q.id === questId),

  listChains: () => Object.values(get().chains),
}));
