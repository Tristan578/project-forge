/**
 * AI Memory — persists project preferences and learned patterns across sessions.
 * Stored in localStorage per-project, included in AI context to maintain continuity.
 */

const AI_MEMORY_KEY = 'forge-ai-memory-';
const MAX_ENTRIES = 50;
const MAX_ENTRY_LENGTH = 500;

export interface AIMemoryEntry {
  id: string;
  /** When this memory was created */
  createdAt: number;
  /** When this memory was last used/referenced */
  lastUsedAt: number;
  /** Category for organization */
  category: AIMemoryCategory;
  /** The memory content */
  content: string;
  /** Relevance score (higher = more important) */
  importance: number;
}

export type AIMemoryCategory =
  | 'style-preference'    // User's aesthetic preferences
  | 'naming-convention'   // How user names entities
  | 'workflow-pattern'    // Repeated workflow steps
  | 'project-context'    // Project-specific facts
  | 'correction'         // User corrections to AI behavior
  | 'custom';            // User-defined memories

export const AI_MEMORY_CATEGORIES: Record<AIMemoryCategory, string> = {
  'style-preference': 'Style Preferences',
  'naming-convention': 'Naming Conventions',
  'workflow-pattern': 'Workflow Patterns',
  'project-context': 'Project Context',
  'correction': 'Corrections',
  'custom': 'Custom',
};

let memoryCounter = 0;

function nextMemoryId(): string {
  return `mem_${Date.now()}_${++memoryCounter}`;
}

/**
 * Load AI memories for a project.
 */
export function loadMemories(projectId: string): AIMemoryEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const stored = localStorage.getItem(AI_MEMORY_KEY + projectId);
    if (stored) {
      return JSON.parse(stored) as AIMemoryEntry[];
    }
  } catch {
    // Corrupt data
  }
  return [];
}

/**
 * Save AI memories for a project.
 */
export function saveMemories(projectId: string, memories: AIMemoryEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    // Enforce max entries by importance then recency
    const sorted = [...memories].sort((a, b) => {
      if (b.importance !== a.importance) return b.importance - a.importance;
      return b.lastUsedAt - a.lastUsedAt;
    });
    const trimmed = sorted.slice(0, MAX_ENTRIES);
    localStorage.setItem(AI_MEMORY_KEY + projectId, JSON.stringify(trimmed));
  } catch {
    // localStorage full
  }
}

/**
 * Add a new memory entry.
 */
export function addMemory(
  projectId: string,
  category: AIMemoryCategory,
  content: string,
  importance: number = 5,
): AIMemoryEntry {
  const memories = loadMemories(projectId);
  const truncated = content.slice(0, MAX_ENTRY_LENGTH);
  const now = Date.now();

  const entry: AIMemoryEntry = {
    id: nextMemoryId(),
    createdAt: now,
    lastUsedAt: now,
    category,
    content: truncated,
    importance: Math.max(1, Math.min(10, importance)),
  };

  memories.push(entry);
  saveMemories(projectId, memories);
  return entry;
}

/**
 * Remove a memory by ID.
 */
export function removeMemory(projectId: string, memoryId: string): boolean {
  const memories = loadMemories(projectId);
  const filtered = memories.filter((m) => m.id !== memoryId);
  if (filtered.length === memories.length) return false;
  saveMemories(projectId, filtered);
  return true;
}

/**
 * Update a memory entry.
 */
export function updateMemory(
  projectId: string,
  memoryId: string,
  updates: Partial<Pick<AIMemoryEntry, 'content' | 'category' | 'importance'>>,
): AIMemoryEntry | null {
  const memories = loadMemories(projectId);
  const index = memories.findIndex((m) => m.id === memoryId);
  if (index === -1) return null;

  const updated = { ...memories[index] };
  if (updates.content !== undefined) updated.content = updates.content.slice(0, MAX_ENTRY_LENGTH);
  if (updates.category !== undefined) updated.category = updates.category;
  if (updates.importance !== undefined) updated.importance = Math.max(1, Math.min(10, updates.importance));
  updated.lastUsedAt = Date.now();

  memories[index] = updated;
  saveMemories(projectId, memories);
  return updated;
}

/**
 * Touch a memory (update lastUsedAt).
 */
export function touchMemory(projectId: string, memoryId: string): void {
  const memories = loadMemories(projectId);
  const entry = memories.find((m) => m.id === memoryId);
  if (entry) {
    entry.lastUsedAt = Date.now();
    saveMemories(projectId, memories);
  }
}

/**
 * Clear all memories for a project.
 */
export function clearMemories(projectId: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(AI_MEMORY_KEY + projectId);
}

/**
 * Search memories by content.
 */
export function searchMemories(
  projectId: string,
  query: string,
): AIMemoryEntry[] {
  if (!query.trim()) return loadMemories(projectId);
  const lower = query.toLowerCase();
  return loadMemories(projectId).filter((m) =>
    m.content.toLowerCase().includes(lower),
  );
}

/**
 * Build a context string from memories for inclusion in AI prompts.
 * Returns only the most relevant memories.
 */
export function buildMemoryContext(
  projectId: string,
  maxTokenBudget: number = 500,
): string {
  const memories = loadMemories(projectId);
  if (memories.length === 0) return '';

  // Sort by importance then recency
  const sorted = [...memories].sort((a, b) => {
    if (b.importance !== a.importance) return b.importance - a.importance;
    return b.lastUsedAt - a.lastUsedAt;
  });

  const lines: string[] = ['## AI Memory (Project Preferences)'];
  let charCount = lines[0].length;

  for (const mem of sorted) {
    const line = `- [${AI_MEMORY_CATEGORIES[mem.category]}] ${mem.content}`;
    // Rough token estimate: ~4 chars per token
    if (charCount + line.length > maxTokenBudget * 4) break;
    lines.push(line);
    charCount += line.length;
  }

  if (lines.length === 1) return ''; // Only header, no memories fit
  return lines.join('\n');
}

/**
 * Extract potential memories from user feedback.
 * Detects correction patterns and preference statements.
 */
export function detectMemoryHints(message: string): Array<{
  category: AIMemoryCategory;
  content: string;
  confidence: number;
}> {
  const hints: Array<{ category: AIMemoryCategory; content: string; confidence: number }> = [];
  const lower = message.toLowerCase();

  // Correction patterns
  const correctionPatterns = [
    /(?:don'?t|do not|never|stop)\s+(.+)/i,
    /(?:always|prefer|i want|i like)\s+(.+)/i,
    /(?:instead of|rather than)\s+\w+[,.]?\s*(?:use|do|make)\s+(.+)/i,
  ];

  for (const pattern of correctionPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const content = match[1].slice(0, MAX_ENTRY_LENGTH);
      const isCorrection = lower.includes("don't") || lower.includes('do not') || lower.includes('never') || lower.includes('stop');
      hints.push({
        category: isCorrection ? 'correction' : 'style-preference',
        content,
        confidence: 0.6,
      });
    }
  }

  // Naming convention patterns
  const namingPatterns = [
    /(?:name|call|label)\s+(?:it|them|entities|objects)\s+(?:like|as|with)\s+(.+)/i,
    /(?:naming convention|naming pattern|prefix)\s+(?:is|should be|:)\s*(.+)/i,
  ];

  for (const pattern of namingPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      hints.push({
        category: 'naming-convention',
        content: match[1].slice(0, MAX_ENTRY_LENGTH),
        confidence: 0.7,
      });
    }
  }

  return hints;
}
