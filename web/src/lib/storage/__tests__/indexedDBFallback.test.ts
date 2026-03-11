import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  saveToIndexedDB,
  loadFromIndexedDB,
  deleteFromIndexedDB,
} from '../indexedDBFallback';

// ---------------------------------------------------------------------------
// Minimal in-process IDBDatabase / IDBObjectStore mock
// ---------------------------------------------------------------------------

type IDBKey = string | number;

interface MockStore {
  data: Record<IDBKey, unknown>;
}

function createIDBMock(shouldFail = false) {
  const stores: Record<string, MockStore> = {};

  function getOrCreateStore(name: string): MockStore {
    if (!stores[name]) stores[name] = { data: {} };
    return stores[name];
  }

  /** Minimal IDBRequest mock. */
  function makeRequest<T>(resolve: () => T): IDBRequest {
    const req = {
      result: undefined as unknown,
      error: null as DOMException | null,
      onsuccess: null as ((ev: Event) => void) | null,
      onerror: null as ((ev: Event) => void) | null,
    };

    queueMicrotask(() => {
      if (shouldFail) {
        req.error = new DOMException('Mock IDB failure', 'UnknownError');
        req.onerror?.({} as Event);
      } else {
        req.result = resolve() as unknown;
        req.onsuccess?.({} as Event);
      }
    });

    return req as unknown as IDBRequest;
  }

  function makeStore(storeName: string): IDBObjectStore {
    const s = getOrCreateStore(storeName);
    return {
      put(value: unknown, key?: IDBValidKey): IDBRequest {
        return makeRequest(() => {
          if (key !== undefined) s.data[key as IDBKey] = value;
          return key;
        });
      },
      get(key: IDBValidKey): IDBRequest {
        return makeRequest(() => s.data[key as IDBKey]);
      },
      delete(key: IDBValidKey): IDBRequest {
        return makeRequest(() => {
          delete s.data[key as IDBKey];
          return undefined;
        });
      },
    } as unknown as IDBObjectStore;
  }

  function makeTransaction(storeName: string): IDBTransaction {
    // Pre-create the store so it exists when objectStore() is called
    getOrCreateStore(storeName);
    const tx = {
      // Route to the store name the caller requested — this validates that
      // production code passes STORE_NAME ('crash-backups') and not the DB name.
      objectStore: (name: string) => makeStore(name),
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    queueMicrotask(() => tx.oncomplete?.());
    return tx as unknown as IDBTransaction;
  }

  function makeDB(_dbName: string): IDBDatabase {
    return {
      objectStoreNames: {
        contains: () => true,
      },
      // Pass the requested store name through so makeTransaction pre-creates it
      transaction: (name: string, _mode: string) => makeTransaction(name),
      close: vi.fn(),
      createObjectStore: (name: string) => makeStore(name),
    } as unknown as IDBDatabase;
  }

  /** Simulated `indexedDB.open()` */
  function open(_name: string, _version?: number): IDBOpenDBRequest {
    const req = {
      result: undefined as unknown,
      error: null as DOMException | null,
      onsuccess: null as ((ev: Event) => void) | null,
      onerror: null as ((ev: Event) => void) | null,
      onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
    };

    queueMicrotask(() => {
      if (shouldFail) {
        req.error = new DOMException('Open failed', 'UnknownError');
        req.onerror?.({} as Event);
      } else {
        req.result = makeDB(_name) as unknown;
        req.onupgradeneeded?.({
          target: req,
        } as unknown as IDBVersionChangeEvent);
        req.onsuccess?.({} as Event);
      }
    });

    return req as unknown as IDBOpenDBRequest;
  }

  return { open, stores };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('indexedDBFallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Re-enable indexedDB if a test disabled it
    Object.defineProperty(global, 'indexedDB', {
      value: global.indexedDB,
      writable: true,
      configurable: true,
    });
  });

  function installMock(shouldFail = false) {
    const idb = createIDBMock(shouldFail);
    Object.defineProperty(global, 'indexedDB', {
      value: { open: idb.open },
      writable: true,
      configurable: true,
    });
    return idb;
  }

  // -------------------------------------------------------------------------
  // saveToIndexedDB
  // -------------------------------------------------------------------------

  describe('saveToIndexedDB', () => {
    it('returns true on successful write', async () => {
      installMock(false);
      const result = await saveToIndexedDB('my-key', 'my-data');
      expect(result).toBe(true);
    });

    it('returns false when IndexedDB open fails', async () => {
      installMock(true);
      const result = await saveToIndexedDB('my-key', 'my-data');
      expect(result).toBe(false);
    });

    it('returns false when IndexedDB is unavailable', async () => {
      Object.defineProperty(global, 'indexedDB', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      const result = await saveToIndexedDB('k', 'v');
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // loadFromIndexedDB
  // -------------------------------------------------------------------------

  describe('loadFromIndexedDB', () => {
    it('returns null when key does not exist', async () => {
      installMock(false);
      const result = await loadFromIndexedDB('nonexistent-key');
      // The mock returns undefined for missing keys; fallback returns null
      expect(result).toBeNull();
    });

    it('returns null when IndexedDB open fails', async () => {
      installMock(true);
      const result = await loadFromIndexedDB('k');
      expect(result).toBeNull();
    });

    it('returns null when IndexedDB is unavailable', async () => {
      Object.defineProperty(global, 'indexedDB', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      const result = await loadFromIndexedDB('k');
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // deleteFromIndexedDB
  // -------------------------------------------------------------------------

  describe('deleteFromIndexedDB', () => {
    it('resolves without throwing', async () => {
      installMock(false);
      await expect(deleteFromIndexedDB('any-key')).resolves.toBeUndefined();
    });

    it('resolves silently when IndexedDB fails', async () => {
      installMock(true);
      await expect(deleteFromIndexedDB('any-key')).resolves.toBeUndefined();
    });

    it('resolves silently when IndexedDB is unavailable', async () => {
      Object.defineProperty(global, 'indexedDB', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      await expect(deleteFromIndexedDB('k')).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Store name validation — ensures production code uses STORE_NAME not DB_NAME
  // -------------------------------------------------------------------------

  describe('store name validation', () => {
    it('passes the correct store name (crash-backups) to objectStore(), not the DB name (forge-backup)', async () => {
      const observedStoreNames: string[] = [];

      // Build a mock that records every store name passed to objectStore()
      function createCapturingIDBMock() {
        const stores: Record<string, Record<string | number, unknown>> = {};

        function makeRequest<T>(resolve: () => T): IDBRequest {
          const req = {
            result: undefined as unknown,
            error: null as DOMException | null,
            onsuccess: null as ((ev: Event) => void) | null,
            onerror: null as ((ev: Event) => void) | null,
          };
          queueMicrotask(() => {
            req.result = resolve() as unknown;
            req.onsuccess?.({} as Event);
          });
          return req as unknown as IDBRequest;
        }

        function makeStore(storeName: string): IDBObjectStore {
          if (!stores[storeName]) stores[storeName] = {};
          const s = stores[storeName];
          return {
            put(value: unknown, key?: IDBValidKey): IDBRequest {
              return makeRequest(() => {
                if (key !== undefined) s[key as string | number] = value;
                return key;
              });
            },
            get(key: IDBValidKey): IDBRequest {
              return makeRequest(() => s[key as string | number]);
            },
            delete(key: IDBValidKey): IDBRequest {
              return makeRequest(() => { delete s[key as string | number]; return undefined; });
            },
          } as unknown as IDBObjectStore;
        }

        function makeTransaction(storeName: string): IDBTransaction {
          observedStoreNames.push(storeName);
          if (!stores[storeName]) stores[storeName] = {};
          const tx = {
            objectStore: (name: string) => makeStore(name),
            oncomplete: null as (() => void) | null,
            onerror: null as (() => void) | null,
            onabort: null as (() => void) | null,
          };
          queueMicrotask(() => tx.oncomplete?.());
          return tx as unknown as IDBTransaction;
        }

        function makeDB(): IDBDatabase {
          return {
            objectStoreNames: { contains: () => true },
            transaction: (name: string, _mode: string) => makeTransaction(name),
            close: vi.fn(),
            createObjectStore: (name: string) => makeStore(name),
          } as unknown as IDBDatabase;
        }

        function open(): IDBOpenDBRequest {
          const req = {
            result: undefined as unknown,
            error: null as DOMException | null,
            onsuccess: null as ((ev: Event) => void) | null,
            onerror: null as ((ev: Event) => void) | null,
            onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
          };
          queueMicrotask(() => {
            req.result = makeDB() as unknown;
            req.onupgradeneeded?.({ target: req } as unknown as IDBVersionChangeEvent);
            req.onsuccess?.({} as Event);
          });
          return req as unknown as IDBOpenDBRequest;
        }

        return { open };
      }

      const capturingMock = createCapturingIDBMock();
      Object.defineProperty(global, 'indexedDB', {
        value: { open: capturingMock.open },
        writable: true,
        configurable: true,
      });

      await saveToIndexedDB('test-key', 'test-value');

      // The transaction must use STORE_NAME ('crash-backups'), NOT the DB name ('forge-backup')
      expect(observedStoreNames).toContain('crash-backups');
      expect(observedStoreNames).not.toContain('forge-backup');
    });

    it('uses the same store name for load operations', async () => {
      const observedStoreNames: string[] = [];

      function createCapturingIDBMock() {
        const stores: Record<string, Record<string | number, unknown>> = {};

        function makeRequest<T>(fn: () => T): IDBRequest {
          const req = {
            result: undefined as unknown,
            error: null as DOMException | null,
            onsuccess: null as ((ev: Event) => void) | null,
            onerror: null as ((ev: Event) => void) | null,
          };
          queueMicrotask(() => { req.result = fn() as unknown; req.onsuccess?.({} as Event); });
          return req as unknown as IDBRequest;
        }

        function makeStore(storeName: string): IDBObjectStore {
          if (!stores[storeName]) stores[storeName] = {};
          const s = stores[storeName];
          return {
            put(value: unknown, key?: IDBValidKey): IDBRequest {
              return makeRequest(() => { if (key !== undefined) s[key as string] = value; return key; });
            },
            get(key: IDBValidKey): IDBRequest {
              return makeRequest(() => s[key as string]);
            },
            delete(key: IDBValidKey): IDBRequest {
              return makeRequest(() => { delete s[key as string]; return undefined; });
            },
          } as unknown as IDBObjectStore;
        }

        function makeTransaction(storeName: string): IDBTransaction {
          observedStoreNames.push(storeName);
          if (!stores[storeName]) stores[storeName] = {};
          const tx = {
            objectStore: (name: string) => makeStore(name),
            oncomplete: null as (() => void) | null,
            onerror: null as (() => void) | null,
            onabort: null as (() => void) | null,
          };
          queueMicrotask(() => tx.oncomplete?.());
          return tx as unknown as IDBTransaction;
        }

        function makeDB(): IDBDatabase {
          return {
            objectStoreNames: { contains: () => true },
            transaction: (name: string, _mode: string) => makeTransaction(name),
            close: vi.fn(),
            createObjectStore: (name: string) => makeStore(name),
          } as unknown as IDBDatabase;
        }

        function open(): IDBOpenDBRequest {
          const req = {
            result: undefined as unknown,
            error: null as DOMException | null,
            onsuccess: null as ((ev: Event) => void) | null,
            onerror: null as ((ev: Event) => void) | null,
            onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
          };
          queueMicrotask(() => {
            req.result = makeDB() as unknown;
            req.onupgradeneeded?.({ target: req } as unknown as IDBVersionChangeEvent);
            req.onsuccess?.({} as Event);
          });
          return req as unknown as IDBOpenDBRequest;
        }

        return { open };
      }

      const capturingMock = createCapturingIDBMock();
      Object.defineProperty(global, 'indexedDB', {
        value: { open: capturingMock.open },
        writable: true,
        configurable: true,
      });

      await loadFromIndexedDB('any-key');

      expect(observedStoreNames).toContain('crash-backups');
      expect(observedStoreNames).not.toContain('forge-backup');
    });
  });

  // -------------------------------------------------------------------------
  // Save → Load → Delete lifecycle
  // -------------------------------------------------------------------------

  describe('lifecycle (save → load → delete)', () => {
    it('load after save returns the stored string', async () => {
      // Use a shared in-memory mock so save and load see the same data store
      const idb = createIDBMock(false);
      Object.defineProperty(global, 'indexedDB', {
        value: { open: idb.open },
        writable: true,
        configurable: true,
      });

      await saveToIndexedDB('backup', '{"scene":"data"}');
      const loaded = await loadFromIndexedDB('backup');
      expect(loaded).toBe('{"scene":"data"}');
    });

    it('load after delete returns null', async () => {
      const idb = createIDBMock(false);
      Object.defineProperty(global, 'indexedDB', {
        value: { open: idb.open },
        writable: true,
        configurable: true,
      });

      await saveToIndexedDB('backup', 'data');
      await deleteFromIndexedDB('backup');
      // After deletion the store no longer has the key → load returns null
      const loaded = await loadFromIndexedDB('backup');
      // The mock's get returns undefined → loadFromIndexedDB returns null
      expect(loaded).toBeNull();
    });
  });
});
