/**
 * Redis client factory. Redis backs the live-feed pub/sub, the sign-in
 * challenge store, and rate limiting; challenge nonce consumption is enforced
 * in Postgres (the atomic status transition in `transitionChallengeStatus`).
 */
import { Redis } from 'ioredis';

/** Create a Redis client from a connection string. */
export function createRedis(url: string): Redis {
  return new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
}
