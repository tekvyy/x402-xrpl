/**
 * Fixed-window rate limiting backed by Redis (`INCR` + `PEXPIRE`). Applied to
 * the unauthenticated write endpoints (challenge issuance, sign-in, channel
 * registration) so an anonymous caller cannot grow Postgres/Redis without
 * bound or stomp other users' state.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';

export interface RateLimitPolicy {
  /** Short scope name; part of the Redis key so policies never collide. */
  name: string;
  /** Max allowed calls per window. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
}

/**
 * Count one hit against `(policy, subject)` and report whether it is within
 * the limit. Fixed-window: the counter key expires `windowMs` after the
 * window's first hit.
 */
export async function consumeRateLimit(
  redis: Redis,
  policy: RateLimitPolicy,
  subject: string,
): Promise<boolean> {
  const key = `ratelimit:${policy.name}:${subject}`;
  const count = await redis.incr(key);
  // NX on every hit (Redis ≥ 7): sets the TTL when missing, so a key orphaned
  // by a crash between INCR and PEXPIRE self-heals instead of counting forever.
  await redis.pexpire(key, policy.windowMs, 'NX');
  return count <= policy.limit;
}

/**
 * Fastify preHandler enforcing `policy` per client IP. Sends a 429 (which
 * short-circuits the route) when the caller is over the limit.
 */
export function rateLimitByIp(redis: Redis, policy: RateLimitPolicy) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const allowed = await consumeRateLimit(redis, policy, request.ip);
    if (!allowed) {
      await reply.code(429).send({ error: 'too many requests; slow down' });
    }
  };
}
