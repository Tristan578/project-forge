import { type ValidatedTheme } from './themeValidator';
/**
 * IndexedDB schema version for custom theme storage.
 * Increment when the on-disk format changes. loadCustomTheme re-validates on
 * every read to handle data written by older schema versions gracefully.
 *
 * Phase note: Plans B (primitives) and C (effects) are already merged to main,
 * so the IDB schema versioning infrastructure introduced here (Plan D) builds
 * on those shipped foundations. D3/D4 extensions are planned Phase 5 work.
 */
export declare const DB_VERSION = 1;
/**
 * Persist a validated custom theme to IndexedDB.
 * The stored object includes `schemaVersion` (from the ValidatedTheme itself)
 * so future readers can detect and handle version mismatches gracefully.
 */
export declare function saveCustomTheme(id: string, theme: ValidatedTheme): Promise<void>;
/**
 * Load and re-validate a custom theme from IndexedDB.
 * Re-validation ensures the branded type invariant holds even if stored data
 * was written by an older schema version or is corrupted.
 * Unknown/extra fields introduced by future schema versions are silently
 * dropped by validateCustomTheme, so reads remain forward-compatible.
 */
export declare function loadCustomTheme(id: string): Promise<ValidatedTheme | null>;
export declare function deleteCustomTheme(id: string): Promise<void>;
export declare function listCustomThemes(): Promise<string[]>;
