/**
 * Recent projects tracking via localStorage.
 *
 * Stores the last 10 opened projects for quick access
 * from the welcome screen and dashboard.
 */

const STORAGE_KEY = 'forge-recent-projects';
const MAX_RECENT = 10;

export interface RecentProject {
  id: string;
  name: string;
  openedAt: number; // Date.now()
}

/** Read recent projects from localStorage (newest first). */
export function getRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentProject[];
  } catch {
    return [];
  }
}

/** Track a project open. Deduplicates by ID, caps at MAX_RECENT. */
export function trackProjectOpen(id: string, name: string): void {
  try {
    const existing = getRecentProjects().filter((p) => p.id !== id);
    const updated: RecentProject[] = [
      { id, name, openedAt: Date.now() },
      ...existing,
    ].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // localStorage quota exceeded or unavailable — ignore
  }
}

/** Remove a project from recent list (e.g. after deletion). */
export function removeRecentProject(id: string): void {
  try {
    const updated = getRecentProjects().filter((p) => p.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}
