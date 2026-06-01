/**
 * AI generation response cache with prompt deduplication.
 *
 * Caches generation results (SFX, textures, 3D models, sprites) by hashing
 * the operation + normalized params. Uses Upstash Redis when available,
 * falls back to in-memory LRU.
 *
 * Cache hits skip token deduction entirely — users pay nothing for repeated
 * identical requests.
 */

import { captureException } from '@/lib/monitoring/sentry-server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheConfig {
  /** Operation name (e.g. 'sfx_generation') — used for TTL lookup and key prefix */
  operation: string;
  /** Override the default TTL for this operation (in seconds) */
  ttlSeconds?: number;
  /** Skip caching entirely for this request */
  skipCache?: boolean;
}

interface CacheEntry<T> {
  result: T;
  createdAt: number;
  ttlMs: number;
  operation: string;
}

interface InFlightEntry<T> {
  promise: Promise<T>;
}

// ---------------------------------------------------------------------------
// TTL defaults per operation type (seconds)
// ---------------------------------------------------------------------------

const DEFAULT_TTL: Record<string, number> = {
  sfx_generation: 86400,           // 24 hours
  voice_generation: 86400,         // 24 hours
  voice_batch_cost_per_item: 86400,
  music_generation: 86400,         // 24 hours
  '3d_generation_standard': 604800, // 7 days
  '3d_generation_high': 604800,
  image_to_3d: 604800,
  texture_generation: 604800,      // 7 days
  sprite_generation_dalle3: 86400, // 24 hours
  sprite_generation_replicate: 86400,
  sprite_sheet_cost_per_frame: 86400,
  pixel_art_replicate: 86400,
  pixel_art_openai: 86400,
  skybox_generation: 604800,       // 7 days
  tileset_generation: 604800,      // 7 days
  localize_scene: 86400,           // 24 hours
};

// Chat is never cached
const NEVER_CACHE_OPS = new Set(['chat']);

function getTtlSeconds(operation: string, override?: number): number {
  if (override !== undefined) return override;
  return DEFAULT_TTL[operation] ?? 3600; // Default 1 hour
}

// ---------------------------------------------------------------------------
// Cache key generation (SHA-256 of operation + params)
// ---------------------------------------------------------------------------

function sortedStringify(obj: unknown): string {
  if (obj === undefined) return 'null';
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(sortedStringify).join(',')}]`;
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  return `{${sorted.map(k => `${JSON.stringify(k)}:${sortedStringify((obj as Record<string, unknown>)[k])}`).join(',')}}`;
}

async function generateCacheKey(
  operation: string,
  params: Record<string, unknown>,
  userId?: string
): Promise<string> {
  const payload = sortedStringify({ operation, params, userId: userId ?? null });
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);

  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `gen-cache:${operation}:${hex}`;
  }

  // Fallback: djb2 hash
  let h = 5381;
  for (let i = 0; i < data.length; i++) {
    h = ((h << 5) + h + data[i]) | 0;
  }
  return `gen-cache:${operation}:${(h >>> 0).toString(36)}`;
}

// ---------------------------------------------------------------------------
// In-memory LRU cache (dev-only fallback when Upstash not configured)
//
// WARNING: Not suitable for production. Serverless functions are stateless —
// each instance has its own cache, cold starts reset it, and large generation
// results (base64 audio/images, 1-10MB each) cause memory pressure. Keep the
// cap low; this exists only for local development without Redis.
// ---------------------------------------------------------------------------

const MAX_MEMORY_ENTRIES = 30;
const memoryCache = new Map<string, CacheEntry<unknown>>();

function memoryGet<T>(key: string): T | undefined {
  const entry = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;

  if (Date.now() - entry.createdAt > entry.ttlMs) {
    memoryCache.delete(key);
    return undefined;
  }

  // Move to end (most recent)
  memoryCache.delete(key);
  memoryCache.set(key, entry);
  return entry.result;
}

function memorySet<T>(key: string, result: T, ttlMs: number, operation: string): void {
  // Evict oldest if at capacity
  if (memoryCache.size >= MAX_MEMORY_ENTRIES) {
    const firstKey = memoryCache.keys().next().value;
    if (firstKey !== undefined) memoryCache.delete(firstKey);
  }

  memoryCache.set(key, { result, createdAt: Date.now(), ttlMs, operation });
}

// ---------------------------------------------------------------------------
// Upstash Redis cache layer
// ---------------------------------------------------------------------------

function isUpstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

async function redisGet<T>(key: string): Promise<T | undefined> {
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;

  try {
    const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) return undefined;
    const body = await resp.json() as { result: string | null };
    if (!body.result) return undefined;

    return JSON.parse(body.result) as T;
  } catch (err) {
    captureException(err, { action: 'responseCache.redisGet', key });
    return undefined;
  }
}

async function redisSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;

  try {
    const serialized = JSON.stringify(value);

    // Enforce max entry size (10 MB, measured in bytes not code units)
    if (Buffer.byteLength(serialized, 'utf-8') > 10 * 1024 * 1024) return;

    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['SET', key, serialized, 'EX', ttlSeconds]),
    });
  } catch (err) {
    captureException(err, { action: 'responseCache.redisSet', key });
  }
}

// ---------------------------------------------------------------------------
// In-flight deduplication
// ---------------------------------------------------------------------------

const inFlight = new Map<string, InFlightEntry<unknown>>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a cached result exists for the given operation + params.
 * Returns the cached result if found, undefined otherwise.
 */
export async function getCachedResult<T>(
  operation: string,
  params: Record<string, unknown>,
  userId?: string
): Promise<{ hit: true; result: T } | { hit: false }> {
  if (NEVER_CACHE_OPS.has(operation)) return { hit: false };

  const key = await generateCacheKey(operation, params, userId);

  // Check Redis first, fall back to memory
  if (isUpstashConfigured()) {
    const cached = await redisGet<T>(key);
    if (cached !== undefined) return { hit: true, result: cached };
  }

  const memResult = memoryGet<T>(key);
  if (memResult !== undefined) return { hit: true, result: memResult };

  return { hit: false };
}

/**
 * Execute a generation function with cache-aware deduplication.
 *
 * - If a cached result exists, returns it immediately.
 * - If an identical request is already in-flight, piggybacks on it.
 * - Otherwise, executes the function and caches the result.
 *
 * Returns { result, cached } so callers can add X-Cache headers.
 */
export async function cachedGenerate<T>(
  operation: string,
  params: Record<string, unknown>,
  executeFn: () => Promise<T>,
  config?: { ttlSeconds?: number; skipCache?: boolean; userId?: string }
): Promise<{ result: T; cached: boolean }> {
  if (config?.skipCache || NEVER_CACHE_OPS.has(operation)) {
    const result = await executeFn();
    return { result, cached: false };
  }

  const key = await generateCacheKey(operation, params, config?.userId);

  // 1. Check cache
  if (isUpstashConfigured()) {
    const cached = await redisGet<T>(key);
    if (cached !== undefined) return { result: cached, cached: true };
  }
  const memResult = memoryGet<T>(key);
  if (memResult !== undefined) return { result: memResult, cached: true };

  // 2. Check in-flight dedup.
  //
  // The in-flight map shares ONE promise (and thus one result) across every
  // caller on a key. This is only safe because generateCacheKey incorporates
  // userId (see step 1 and the GUARD test in responseCache.test.ts): joiners
  // are therefore always the SAME user firing identical concurrent requests.
  // That invariant matters because executeFn (in createGenerationHandler)
  // performs the token deduction — joiners never run it, so they ride for free.
  // A shared promise across DIFFERENT users would both leak one user's result
  // to another AND let a joiner ride a generation it never paid for. Do not
  // drop userId from the key without revisiting this.
  const existing = inFlight.get(key);
  if (existing) {
    try {
      const result = await existing.promise as T;
      return { result, cached: true };
    } catch {
      // Per-joiner failure isolation: the shared in-flight promise rejected (a
      // transient provider blip, or — for a same-user request — the originator's
      // ApiKeyError). Rather than binding every joiner to that single failure,
      // re-check the cache (a concurrent attempt may have populated it, so a
      // surviving joiner does not redundantly regenerate or re-charge) and
      // otherwise fall through to run this caller's own independent attempt
      // below. The failed originator already released any tokens it deducted, so
      // a joiner only pays when its own attempt succeeds.
      if (isUpstashConfigured()) {
        const settled = await redisGet<T>(key);
        if (settled !== undefined) return { result: settled, cached: true };
      }
      const settledMem = memoryGet<T>(key);
      if (settledMem !== undefined) return { result: settledMem, cached: true };
      // Fall through to step 3 and execute this caller's own attempt.
    }
  }

  // 3. Execute and cache
  const ttlSeconds = getTtlSeconds(operation, config?.ttlSeconds);
  const ttlMs = ttlSeconds * 1000;

  const promise = executeFn();
  const entry: InFlightEntry<T> = { promise };
  inFlight.set(key, entry);

  try {
    const result = await promise;

    // Store in both caches
    memorySet(key, result, ttlMs, operation);
    if (isUpstashConfigured()) {
      // Fire-and-forget Redis write
      redisSet(key, result, ttlSeconds).catch((err) =>
        captureException(err, { action: 'responseCache.backgroundSet', key })
      );
    }

    return { result, cached: false };
  } finally {
    // Identity-guarded cleanup: only remove the entry THIS call registered. The
    // failure-isolation fall-through above lets multiple joiners run their own
    // attempts on the same key concurrently, so a later attempt may have already
    // overwritten inFlight[key]. A blind delete would evict that live sibling
    // entry and break dedup for requests arriving in the gap before it settles.
    if (inFlight.get(key) === entry) inFlight.delete(key);
  }
}

/**
 * Invalidate cached results for an operation (or all operations).
 */
export async function invalidateCache(operation?: string): Promise<void> {
  if (operation) {
    // Remove matching entries from memory cache
    for (const [key, entry] of memoryCache) {
      if ((entry as CacheEntry<unknown>).operation === operation) {
        memoryCache.delete(key);
      }
    }
  } else {
    memoryCache.clear();
  }

  // Redis invalidation requires SCAN which is not available via REST API.
  // For Redis, we rely on TTL expiration. Manual invalidation clears memory only.
}

/**
 * Get cache statistics for monitoring.
 */
export function getCacheStats(): {
  memoryEntries: number;
  memoryMaxEntries: number;
  inFlightRequests: number;
} {
  return {
    memoryEntries: memoryCache.size,
    memoryMaxEntries: MAX_MEMORY_ENTRIES,
    inFlightRequests: inFlight.size,
  };
}

// Exported for testing
export { generateCacheKey as _generateCacheKey, memoryCache as _memoryCache, inFlight as _inFlight };
