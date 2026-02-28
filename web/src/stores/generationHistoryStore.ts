'use client';

/**
 * Generation history store — localStorage-persisted library of past AI generations.
 *
 * Automatically captures completed generation jobs and stores them for
 * later browsing, search, re-import, and regeneration.
 */

import { create } from 'zustand';
import type { GenerationType } from './generationStore';

export interface HistoryEntry {
  id: string;
  type: GenerationType;
  prompt: string;
  provider: string;
  resultUrl: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

const STORAGE_KEY = 'forge-generation-history';
const MAX_ENTRIES = 200;

function loadHistory(): HistoryEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage full — silently ignore
  }
}

interface GenerationHistoryState {
  entries: HistoryEntry[];
  searchQuery: string;
  filterType: GenerationType | 'all';

  // Actions
  addEntry: (entry: HistoryEntry) => void;
  removeEntry: (id: string) => void;
  clearAll: () => void;
  setSearchQuery: (query: string) => void;
  setFilterType: (type: GenerationType | 'all') => void;

  // Computed
  filteredEntries: () => HistoryEntry[];
}

export const useGenerationHistoryStore = create<GenerationHistoryState>((set, get) => ({
  entries: loadHistory(),
  searchQuery: '',
  filterType: 'all',

  addEntry: (entry) =>
    set((state) => {
      // Deduplicate by id
      if (state.entries.some((e) => e.id === entry.id)) return state;
      const newEntries = [entry, ...state.entries].slice(0, MAX_ENTRIES);
      saveHistory(newEntries);
      return { entries: newEntries };
    }),

  removeEntry: (id) =>
    set((state) => {
      const newEntries = state.entries.filter((e) => e.id !== id);
      saveHistory(newEntries);
      return { entries: newEntries };
    }),

  clearAll: () => {
    saveHistory([]);
    set({ entries: [] });
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilterType: (type) => set({ filterType: type }),

  filteredEntries: () => {
    const { entries, searchQuery, filterType } = get();
    let filtered = entries;

    if (filterType !== 'all') {
      filtered = filtered.filter((e) => e.type === filterType);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((e) => e.prompt.toLowerCase().includes(q));
    }

    return filtered;
  },
}));
