/**
 * PromptCache — in-memory LRU cache for system prompts and scene context.
 *
 * Design:
 *   - Doubly-linked list + Map for O(1) get/set/evict
 *   - TTL per entry (default 5 minutes)
 *   - Hard size cap (default 50 entries) — oldest entry evicted on overflow
 *   - Hit/miss counters for monitoring
 */

interface CacheEntry {
  key: string;
  content: string;
  expiresAt: number;
  prev: CacheEntry | null;
  next: CacheEntry | null;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

export interface PromptCacheOptions {
  /** Maximum number of entries before LRU eviction. Default: 50 */
  maxSize?: number;
  /** Default TTL in milliseconds. Default: 5 minutes (300_000 ms) */
  defaultTtlMs?: number;
}

export class PromptCache {
  private readonly maxSize: number;
  private readonly defaultTtlMs: number;
  private readonly map: Map<string, CacheEntry> = new Map();

  // LRU linked-list sentinels (head = MRU, tail = LRU)
  private readonly head: CacheEntry;
  private readonly tail: CacheEntry;

  private hitCount = 0;
  private missCount = 0;

  constructor(options: PromptCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 50;
    this.defaultTtlMs = options.defaultTtlMs ?? 5 * 60 * 1000;

    // Sentinel nodes — never stored in the map
    this.head = { key: '', content: '', expiresAt: 0, prev: null, next: null };
    this.tail = { key: '', content: '', expiresAt: 0, prev: null, next: null };
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  /**
   * Retrieve a cached prompt.
   * Returns undefined on miss or TTL expiry (expired entries are pruned lazily).
   */
  getCachedPrompt(key: string): string | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      this.missCount++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.evict(entry);
      this.missCount++;
      return undefined;
    }

    // Move to head (MRU position)
    this.moveToHead(entry);
    this.hitCount++;
    return entry.content;
  }

  /**
   * Store a prompt with an optional TTL.
   * Evicts the LRU entry when the cache is full.
   */
  setCachedPrompt(key: string, content: string, ttlMs?: number): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.content = content;
      existing.expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
      this.moveToHead(existing);
      return;
    }

    const entry: CacheEntry = {
      key,
      content,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
      prev: null,
      next: null,
    };
    this.map.set(key, entry);
    this.addToHead(entry);

    if (this.map.size > this.maxSize) {
      const lru = this.tail.prev;
      if (lru && lru !== this.head) {
        this.evict(lru);
      }
    }
  }

  /** Remove a specific entry from the cache */
  invalidate(key: string): void {
    const entry = this.map.get(key);
    if (entry) this.evict(entry);
  }

  /** Remove all entries whose keys start with the given prefix */
  invalidatePrefix(prefix: string): void {
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) {
        this.invalidate(key);
      }
    }
  }

  /** Purge all expired entries from the cache */
  pruneExpired(): void {
    const now = Date.now();
    for (const entry of this.map.values()) {
      if (now > entry.expiresAt) {
        this.evict(entry);
      }
    }
  }

  /** Clear the entire cache and reset stats */
  clear(): void {
    this.map.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
    this.hitCount = 0;
    this.missCount = 0;
  }

  /** Cache diagnostics */
  get stats(): CacheStats {
    const total = this.hitCount + this.missCount;
    return {
      hits: this.hitCount,
      misses: this.missCount,
      size: this.map.size,
      hitRate: total === 0 ? 0 : this.hitCount / total,
    };
  }

  // ----- Private linked-list helpers -----

  private addToHead(entry: CacheEntry): void {
    entry.prev = this.head;
    entry.next = this.head.next;
    this.head.next!.prev = entry;
    this.head.next = entry;
  }

  private removeNode(entry: CacheEntry): void {
    const p = entry.prev;
    const n = entry.next;
    if (p) p.next = n;
    if (n) n.prev = p;
    entry.prev = null;
    entry.next = null;
  }

  private moveToHead(entry: CacheEntry): void {
    this.removeNode(entry);
    this.addToHead(entry);
  }

  private evict(entry: CacheEntry): void {
    this.removeNode(entry);
    this.map.delete(entry.key);
  }
}

/** Module-level default cache instance (shared across the app) */
export const promptCache = new PromptCache();
