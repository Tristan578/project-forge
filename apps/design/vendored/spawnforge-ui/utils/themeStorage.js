import { get, set, del, keys } from 'idb-keyval';
import { validateCustomTheme } from './themeValidator';
/**
 * IndexedDB schema version for custom theme storage.
 * Increment when the on-disk format changes. loadCustomTheme re-validates on
 * every read to handle data written by older schema versions gracefully.
 *
 * Phase note: Plans B (primitives) and C (effects) are already merged to main,
 * so the IDB schema versioning infrastructure introduced here (Plan D) builds
 * on those shipped foundations. D3/D4 extensions are planned Phase 5 work.
 */
export const DB_VERSION = 1;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * Persist a validated custom theme to IndexedDB.
 * The stored object includes `schemaVersion` (from the ValidatedTheme itself)
 * so future readers can detect and handle version mismatches gracefully.
 */
export async function saveCustomTheme(id, theme) {
    await set(`sf-theme-${id}`, theme);
}
/**
 * Load and re-validate a custom theme from IndexedDB.
 * Re-validation ensures the branded type invariant holds even if stored data
 * was written by an older schema version or is corrupted.
 * Unknown/extra fields introduced by future schema versions are silently
 * dropped by validateCustomTheme, so reads remain forward-compatible.
 */
export async function loadCustomTheme(id) {
    if (!UUID_REGEX.test(id))
        return null;
    const raw = await get(`sf-theme-${id}`);
    if (raw == null)
        return null;
    const result = validateCustomTheme(raw);
    return result.ok ? result.theme : null;
}
export async function deleteCustomTheme(id) {
    if (!UUID_REGEX.test(id))
        return;
    await del(`sf-theme-${id}`);
}
export async function listCustomThemes() {
    const allKeys = await keys();
    return allKeys
        .filter((k) => typeof k === 'string' && k.startsWith('sf-theme-'))
        .map((k) => k.replace('sf-theme-', ''));
}
