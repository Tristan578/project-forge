export interface DocEntry {
  path: string;
  title: string;
  content: string;
  category: string;
  sections: Array<{ heading: string; content: string }>;
}

export interface DocsData {
  docs: DocEntry[];
  meta: Record<string, unknown>;
}

import { DOCS_EMPTY_CACHE_TTL_MS } from '@/lib/config/timeouts';

let cachedDocs: DocsData | null = null;

/** Timestamp of the last empty response, used for TTL-based retry gating */
let emptyCacheTime: number | null = null;

/** Load docs index from the API (cached in memory; empty responses cached with 30s TTL) */
export async function loadDocsIndex(): Promise<DocsData> {
  if (cachedDocs && cachedDocs.docs.length > 0) return cachedDocs;

  // If we recently got an empty response, return it without re-fetching
  if (cachedDocs && emptyCacheTime !== null && Date.now() - emptyCacheTime < DOCS_EMPTY_CACHE_TTL_MS) {
    return cachedDocs;
  }

  const res = await fetch('/api/docs');
  if (!res.ok) throw new Error(`Failed to load docs: ${res.status}`);

  const data: DocsData = await res.json();

  cachedDocs = data;

  if (data.docs.length === 0) {
    // Cache empty result with TTL so we don't hammer the API
    emptyCacheTime = Date.now();
  } else {
    emptyCacheTime = null;
  }

  return data;
}

/** Clear cached docs (useful after hot reload) */
export function clearDocsCache(): void {
  cachedDocs = null;
  emptyCacheTime = null;
}

/** Get unique categories from loaded docs */
export function getCategories(docs: DocEntry[]): string[] {
  const cats = new Set(docs.map((d) => d.category));
  return Array.from(cats).sort();
}

/** Get docs by category */
export function getDocsByCategory(docs: DocEntry[], category: string): DocEntry[] {
  return docs.filter((d) => d.category === category);
}

/** Get a single doc by path */
export function getDocByPath(docs: DocEntry[], docPath: string): DocEntry | undefined {
  return docs.find((d) => d.path === docPath);
}
