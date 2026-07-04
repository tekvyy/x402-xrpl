/**
 * Redis client factory plus the single-use nonce cache. The cache mirrors the
 * TTL of a 402 challenge so an expired nonce disappears without a DB round-trip;
 * Postgres remains the source of truth for consumption.
 */
import { Redis } from 'ioredis';

/** Create a Redis client from a connection string. */
export function createRedis(url: string): Redis {
  return new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
}

function nonceKey(nonce: string): string {
  return `challenge:nonce:${nonce}`;
}

/** Record a freshly issued nonce, expiring it in `ttlMs`. */
export async function cacheNonce(redis: Redis, nonce: string, ttlMs: number): Promise<void> {
  await redis.set(nonceKey(nonce), '1', 'PX', ttlMs);
}

/** Whether a nonce is still within its live TTL window. */
export async function nonceIsLive(redis: Redis, nonce: string): Promise<boolean> {
  return (await redis.exists(nonceKey(nonce))) === 1;
}
