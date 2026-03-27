import { get, set, del, keys } from 'idb-keyval';
import { validateCustomTheme, type ValidatedTheme } from './themeValidator';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function saveCustomTheme(id: string, theme: ValidatedTheme): Promise<void> {
  await set(`sf-theme-${id}`, theme);
}

/**
 * Load and re-validate a custom theme from IndexedDB.
 * Re-validation ensures the branded type invariant holds even if stored data
 * was written by an older schema version or is corrupted.
 */
export async function loadCustomTheme(id: string): Promise<ValidatedTheme | null> {
  if (!UUID_REGEX.test(id)) return null;
  const raw = await get(`sf-theme-${id}`);
  if (raw == null) return null;
  const result = validateCustomTheme(raw);
  return result.ok ? result.theme : null;
}

export async function deleteCustomTheme(id: string): Promise<void> {
  await del(`sf-theme-${id}`);
}

export async function listCustomThemes(): Promise<string[]> {
  const allKeys = await keys();
  return allKeys
    .filter((k): k is string => typeof k === 'string' && k.startsWith('sf-theme-'))
    .map((k) => k.replace('sf-theme-', ''));
}
