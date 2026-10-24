/**
 * A small cache in front of the expensive, frequently-repeated reads.
 *
 * Backed by Redis when REDIS_URL is set, and by an in-process map otherwise, so
 * the app behaves the same with or without it — locally you usually want the
 * in-process one anyway, since it has no network hop at all.
 *
 * Designed to sit inside a free tier:
 *
 *  - Every entry is written with a TTL. Nothing is stored forever, so the cache
 *    drains itself as traffic dies down and never grows without bound. The
 *    in-process fallback also sweeps expired keys and caps its own size.
 *  - TTLs are short (seconds). The point is to absorb bursts of identical reads
 *    — a chat list polled every few seconds, the same conversation opened
 *    repeatedly — not to hold data for long.
 *  - Writes invalidate explicitly, so a short TTL never means stale messages.
 *  - One round trip per cached read, so the command count tracks page views
 *    rather than multiplying them.
 *
 * Anything that fails here is logged and treated as a miss: a broken cache must
 * never take the request with it.
 */

import Redis from "ioredis";
import { logger } from "../utils/logger";

/** Key prefixes, so one glance at a key says what produced it. */
export const CacheKeys = {
  conversationList: (userId: string) => `conv:list:${userId}`,
  conversationMessages: (conversationId: string) => `conv:msgs:${conversationId}`,
  userAnalytics: (userId: string) => `user:analytics:${userId}`,
};

/** Seconds. Short on purpose — see the note above. */
export const CacheTTL = {
  conversationList: 30,
  conversationMessages: 20,
  userAnalytics: 120,
};

const MEMORY_MAX_ENTRIES = 500;

type Entry = { value: string; expiresAt: number };

const memory = new Map<string, Entry>();
let redis: Redis | null = null;
let redisHealthy = false;

export function isRedisConfigured(): boolean {
  return !!process.env.REDIS_URL;
}

export function getRedis(): Redis | null {
  if (!isRedisConfigured()) return null;
  if (redis) return redis;

  redis = new Redis(process.env.REDIS_URL as string, {
    // A cache must never hold up a request. If Redis is unreachable we want a
    // fast failure that falls through to the database, not a retry storm.
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    enableOfflineQueue: false,
    lazyConnect: false,
  });

  redis.on("ready", () => {
    redisHealthy = true;
    logger.info("✅ Cache: connected to Redis");
  });
  redis.on("error", (err) => {
    if (redisHealthy) logger.warn("Cache: Redis error, falling back to memory:", err.message);
    redisHealthy = false;
  });
  redis.on("end", () => {
    redisHealthy = false;
  });

  return redis;
}

function memoryGet(key: string): string | null {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return hit.value;
}

function memorySet(key: string, value: string, ttlSeconds: number): void {
  // Sweep expired keys before growing, then drop the oldest if still at cap.
  if (memory.size >= MEMORY_MAX_ENTRIES) {
    const now = Date.now();
    // Array.from keeps this compatible with the project's TS target.
    Array.from(memory.entries()).forEach(([k, v]) => {
      if (v.expiresAt <= now) memory.delete(k);
    });
    while (memory.size >= MEMORY_MAX_ENTRIES) {
      const oldest = Array.from(memory.keys())[0];
      if (oldest === undefined) break;
      memory.delete(oldest);
    }
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const client = getRedis();
    const raw = client && redisHealthy ? await client.get(key) : memoryGet(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (error) {
    logger.warn("Cache read failed, treating as a miss:", error);
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const raw = JSON.stringify(value);
    const client = getRedis();
    if (client && redisHealthy) {
      // Always with an expiry: this is what keeps the free tier from filling up.
      await client.set(key, raw, "EX", ttlSeconds);
    } else {
      memorySet(key, raw, ttlSeconds);
    }
  } catch (error) {
    logger.warn("Cache write failed, continuing without caching:", error);
  }
}

export async function cacheDelete(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    const client = getRedis();
    if (client && redisHealthy) {
      await client.del(...keys);
    } else {
      keys.forEach((k) => memory.delete(k));
    }
  } catch (error) {
    logger.warn("Cache invalidation failed:", error);
  }
}

/**
 * Return the cached value, or run `loader` and cache what it produces.
 *
 * A miss costs one extra round trip on top of the query it is wrapping, which
 * is why only genuinely expensive reads should go through here.
 */
export async function remember<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;

  const value = await loader();
  // Null/undefined is not cached: it is usually an error path, and caching it
  // would hide the recovery.
  if (value !== null && value !== undefined) {
    await cacheSet(key, value, ttlSeconds);
  }
  return value;
}

/** For the health endpoint and for tests. */
export async function cacheStatus(): Promise<{
  backend: "redis" | "memory";
  healthy: boolean;
  entries?: number;
}> {
  const client = getRedis();
  if (client && redisHealthy) {
    try {
      const size = await client.dbsize();
      return { backend: "redis", healthy: true, entries: size };
    } catch {
      return { backend: "redis", healthy: false };
    }
  }
  return { backend: "memory", healthy: true, entries: memory.size };
}
