// Unified Redis client with graceful in-memory fallback
// When REDIS_URL is not set (local dev), all operations are no-ops / return null.
// When Redis is set but unavailable, operations fail silently (no throw).

import Redis from 'ioredis'

const KEY_PREFIX = 'kn:'

// Use globalThis to ensure a single Redis instance across all Next.js server
// chunks (webpack can duplicate module-level variables across chunks).
const globalForRedis = globalThis as unknown as { __kardashevRedis?: Redis | null }

function getRedisInstance(): Redis | null {
  if (globalForRedis.__kardashevRedis) return globalForRedis.__kardashevRedis

  const url = process.env.REDIS_URL
  if (!url) return null

  const client = new Redis(url, {
    enableOfflineQueue: true,
    maxRetriesPerRequest: 2,
    retryStrategy(times) {
      if (times > 3) return null // stop retrying after 3 attempts
      return Math.min(times * 500, 2000)
    },
    lazyConnect: true,
  })

  client.on('error', (err) => {
    console.warn('[redis] connection error:', err.message)
  })

  client.on('connect', () => {
    console.log('[redis] connected')
  })

  // Initiate connection (non-blocking)
  client.connect().catch(() => {
    // Silently handle — reconnect logic in ioredis will retry
  })

  globalForRedis.__kardashevRedis = client
  return client
}

/**
 * Get a value from Redis (JSON-parsed).
 * Returns null if Redis is unavailable or key doesn't exist.
 */
export async function rget<T>(key: string): Promise<T | null> {
  const client = getRedisInstance()
  if (!client) return null

  try {
    const raw = await client.get(KEY_PREFIX + key)
    if (raw === null) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/**
 * Set a value in Redis (JSON-serialized) with TTL in seconds.
 * No-op if Redis is unavailable.
 */
export async function rset(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const client = getRedisInstance()
  if (!client) return

  try {
    await client.set(KEY_PREFIX + key, JSON.stringify(value), 'EX', ttlSeconds)
  } catch {
    // Silently fail — L1 cache is still valid
  }
}

/**
 * Set a value only if key does not already exist (NX) with TTL in seconds.
 * Returns true when set, false when key already exists or Redis unavailable.
 */
export async function rsetnx(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  const client = getRedisInstance()
  if (!client) return false

  try {
    const result = await client.set(KEY_PREFIX + key, JSON.stringify(value), 'EX', ttlSeconds, 'NX')
    return result === 'OK'
  } catch {
    return false
  }
}

/**
 * Delete a key from Redis.
 * No-op if Redis is unavailable.
 */
export async function rdel(key: string): Promise<void> {
  const client = getRedisInstance()
  if (!client) return

  try {
    await client.del(KEY_PREFIX + key)
  } catch {
    // Silently fail
  }
}

/**
 * Ping Redis to check connectivity.
 * Returns false if Redis is unavailable.
 */
export async function rping(): Promise<boolean> {
  const client = getRedisInstance()
  if (!client) return false

  try {
    const result = await client.ping()
    return result === 'PONG'
  } catch {
    return false
  }
}

/**
 * Atomically increment a key and set expiry (for rate limiting).
 * Returns the new count, or null if Redis is unavailable.
 */
export async function rincr(key: string, ttlSeconds: number): Promise<number | null> {
  const client = getRedisInstance()
  if (!client) return null

  try {
    const count = await client.incr(KEY_PREFIX + key)
    if (count === 1) {
      // First increment — set the expiry
      await client.expire(KEY_PREFIX + key, ttlSeconds)
    }
    return count
  } catch {
    return null
  }
}
