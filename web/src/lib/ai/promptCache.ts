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

// ---------------------------------------------------------------------------
// AIResponseCache — SHA-256-keyed response cache with in-flight deduplication
// ---------------------------------------------------------------------------

export interface AIResponseCacheOptions {
  /** Maximum number of cached responses before LRU eviction. Default: 100 */
  maxSize?: number;
  /** TTL for each cached response in milliseconds. Default: 5 minutes */
  ttlMs?: number;
}

interface ResponseEntry {
  key: string;
  content: string;
  expiresAt: number;
  prev: ResponseEntry | null;
  next: ResponseEntry | null;
}

/**
 * SHA-256-keyed LRU cache for AI responses with in-flight deduplication.
 *
 * Design:
 *   - Cache key is SHA-256(model + systemPrompt + userMessage)
 *   - TTL: 5 minutes (configurable)
 *   - LRU eviction at 100 entries (configurable)
 *   - In-flight dedup: if the same key is already being fetched,
 *     the second caller receives the same promise — no duplicate network request
 *
 * The `sha256` helper uses the Web Crypto API when available (browser/Node 19+)
 * and falls back to a deterministic djb2-based hex string in environments that
 * lack `crypto.subtle` (e.g. Node 18 test environments without the flag).
 */
export class AIResponseCache {
  private readonly maxSize: number;
  private readonly ttlMs: number;

  // LRU linked-list (head = MRU, tail sentinel)
  private readonly head: ResponseEntry;
  private readonly tail: ResponseEntry;
  private readonly map: Map<string, ResponseEntry> = new Map();

  // In-flight requests: key → shared Promise<string>
  private readonly inflight: Map<string, Promise<string>> = new Map();

  constructor(options: AIResponseCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 100;
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;

    this.head = { key: '', content: '', expiresAt: 0, prev: null, next: null };
    this.tail = { key: '', content: '', expiresAt: 0, prev: null, next: null };
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  /**
   * Compute a stable cache key from model + system prompt + user message.
   * Uses Web Crypto SHA-256 when available, falls back to djb2 hex otherwise.
   */
  async computeKey(model: string, systemPrompt: string, userMessage: string): Promise<string> {
    const raw = `${model}\x00${systemPrompt}\x00${userMessage}`;
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoded = new TextEncoder().encode(raw);
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback: djb2 variant producing a 16-char hex string
    let h = 5381;
    for (let i = 0; i < raw.length; i++) {
      h = ((h << 5) + h) ^ raw.charCodeAt(i);
      h = h >>> 0; // keep unsigned 32-bit
    }
    return h.toString(16).padStart(8, '0').repeat(2);
  }

  /**
   * Get a cached response by key.
   * Returns undefined on miss or TTL expiry.
   */
  get(key: string): string | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.evict(entry);
      return undefined;
    }

    this.moveToHead(entry);
    return entry.content;
  }

  /**
   * Store a response in the cache.
   */
  set(key: string, content: string): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.content = content;
      existing.expiresAt = Date.now() + this.ttlMs;
      this.moveToHead(existing);
      return;
    }

    const entry: ResponseEntry = {
      key,
      content,
      expiresAt: Date.now() + this.ttlMs,
      prev: null,
      next: null,
    };
    this.map.set(key, entry);
    this.addToHead(entry);

    if (this.map.size > this.maxSize) {
      const lru = this.tail.prev;
      if (lru && lru !== this.head) this.evict(lru);
    }
  }

  /**
   * Execute `fn` with deduplication: if a request for `key` is already in-flight,
   * return the existing promise rather than starting a new network call.
   *
   * On success, the result is cached. On failure, the in-flight entry is
   * removed so subsequent callers can retry.
   */
  async dedup(key: string, fn: () => Promise<string>): Promise<string> {
    // Cache hit
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    // In-flight dedup
    const existing = this.inflight.get(key);
    if (existing) return existing;

    // Start new request
    const promise = fn()
      .then((result) => {
        this.set(key, result);
        return result;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  /** Whether a key is currently being fetched (in-flight). */
  isInflight(key: string): boolean {
    return this.inflight.has(key);
  }

  /** Number of completed responses currently in cache. */
  get size(): number {
    return this.map.size;
  }

  /** Number of in-flight requests being tracked. */
  get inflightCount(): number {
    return this.inflight.size;
  }

  /** Invalidate a single cache entry (does not affect in-flight). */
  invalidate(key: string): void {
    const entry = this.map.get(key);
    if (entry) this.evict(entry);
  }

  /** Clear all cached entries and reset. Does not cancel in-flight requests. */
  clear(): void {
    this.map.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  // ----- Private helpers -----

  private addToHead(entry: ResponseEntry): void {
    entry.prev = this.head;
    entry.next = this.head.next;
    this.head.next!.prev = entry;
    this.head.next = entry;
  }

  private removeNode(entry: ResponseEntry): void {
    const p = entry.prev;
    const n = entry.next;
    if (p) p.next = n;
    if (n) n.prev = p;
    entry.prev = null;
    entry.next = null;
  }

  private moveToHead(entry: ResponseEntry): void {
    this.removeNode(entry);
    this.addToHead(entry);
  }

  private evict(entry: ResponseEntry): void {
    this.removeNode(entry);
    this.map.delete(entry.key);
  }
}

/** Module-level AI response cache instance */
export const aiResponseCache = new AIResponseCache();
