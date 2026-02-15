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

let cachedDocs: DocsData | null = null;

/** Load docs index from the API (cached in memory) */
export async function loadDocsIndex(): Promise<DocsData> {
  if (cachedDocs) return cachedDocs;

  const res = await fetch('/api/docs');
  if (!res.ok) throw new Error(`Failed to load docs: ${res.status}`);

  cachedDocs = await res.json();
  return cachedDocs!;
}

/** Clear cached docs (useful after hot reload) */
export function clearDocsCache(): void {
  cachedDocs = null;
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
