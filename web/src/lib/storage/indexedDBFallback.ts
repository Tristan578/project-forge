/**
 * Minimal IndexedDB wrapper for crash-backup storage.
 *
 * Database : forge-backup
 * Store    : crash-backups
 *
 * All operations return gracefully (boolean/null) rather than throwing,
 * so callers can treat IndexedDB as a best-effort fallback.
 */

const DB_NAME = 'forge-backup';
const STORE_NAME = 'crash-backups';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save `data` string under `key` in IndexedDB.
 * Returns `true` on success, `false` on any failure.
 */
export async function saveToIndexedDB(key: string, data: string): Promise<boolean> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(data, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return false;
  }
}

/**
 * Load the value stored under `key`.
 * Returns the string on success, `null` if not found or on error.
 */
export async function loadFromIndexedDB(key: string): Promise<string | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        db.close();
        const result = req.result as unknown;
        resolve(typeof result === 'string' ? result : null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

/**
 * Delete the entry stored under `key`.
 * Resolves silently on error.
 */
export async function deleteFromIndexedDB(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      tx.oncomplete = () => db.close();
    });
  } catch {
    // Ignore — best-effort
  }
}
