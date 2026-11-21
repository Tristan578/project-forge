/**
 * Script library store — localStorage CRUD for standalone (entity-independent) scripts.
 * Follows the prefabStore pattern: plain functions, no Zustand.
 */

export interface LibraryScript {
  id: string;
  name: string;
  source: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'forge-script-library';

/** Load all library scripts from localStorage */
export function loadScripts(): LibraryScript[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveToStorage(scripts: LibraryScript[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
}

/** Save a new script to the library */
export function saveScript(
  name: string,
  source: string,
  description: string = '',
  tags: string[] = []
): LibraryScript {
  const scripts = loadScripts();
  const now = new Date().toISOString();
  const script: LibraryScript = {
    id: `script_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    source,
    description,
    tags,
    createdAt: now,
    updatedAt: now,
  };
  scripts.push(script);
  saveToStorage(scripts);
  return script;
}

/** Update an existing script */
export function updateScript(
  id: string,
  updates: Partial<Pick<LibraryScript, 'name' | 'source' | 'description' | 'tags'>>
): boolean {
  const scripts = loadScripts();
  const idx = scripts.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  Object.assign(scripts[idx], updates, { updatedAt: new Date().toISOString() });
  saveToStorage(scripts);
  return true;
}

/** Delete a script from the library */
export function deleteScript(id: string): boolean {
  const scripts = loadScripts();
  const filtered = scripts.filter((s) => s.id !== id);
  if (filtered.length === scripts.length) return false;
  saveToStorage(filtered);
  return true;
}

/** Duplicate a script */
export function duplicateScript(id: string): LibraryScript | null {
  const scripts = loadScripts();
  const original = scripts.find((s) => s.id === id);
  if (!original) return null;
  return saveScript(`${original.name} (copy)`, original.source, original.description, [...original.tags]);
}

/** Search scripts by name, description, or tags */
export function searchScripts(query: string): LibraryScript[] {
  const q = query.toLowerCase().trim();
  if (!q) return loadScripts();
  return loadScripts().filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q))
  );
}

/** Get a script by ID or name */
export function getScript(idOrName: string): LibraryScript | undefined {
  return loadScripts().find((s) => s.id === idOrName || s.name === idOrName);
}

/** Export a script as JSON string */
export function exportScript(id: string): string | null {
  const script = getScript(id);
  return script ? JSON.stringify(script, null, 2) : null;
}

/** Import a script from JSON string */
export function importScript(json: string): LibraryScript | null {
  try {
    const data = JSON.parse(json);
    if (!data.name || !data.source) return null;
    return saveScript(data.name, data.source, data.description || '', data.tags || []);
  } catch {
    return null;
  }
}
