/**
 * Sign-in-with-XRPL routes. A dashboard user proves wallet ownership by signing
 * a challenge; on success they receive a bearer token used for the protected
 * seller and bot routes.
 */
import type { FastifyInstance } from 'fastify';
import {
  AuthChallengeRequestSchema,
  AuthVerifyRequestSchema,
  AuthVerifyTxRequestSchema,
} from '@app/shared';
import {
  issueAuthChallenge,
  verifyAuthSignature,
  verifyAuthTransaction,
} from '../services/auth.service.js';
import { AUTH_RATE_LIMIT } from '../constants.js';
import { rateLimitByIp } from '../util/rate-limit.js';
import type { GatewayDeps } from '../deps.js';

export function registerAuthRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const limited = { preHandler: rateLimitByIp(deps.redis, AUTH_RATE_LIMIT) };
  app.post('/auth/challenge', limited, async (request, reply) => {
    const parsed = AuthChallengeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request', issues: parsed.error.issues });
    }
    const challenge = await issueAuthChallenge(deps.redis, parsed.data.address);
    return reply.send(challenge);
  });

  app.post('/auth/verify', limited, async (request, reply) => {
    const parsed = AuthVerifyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request', issues: parsed.error.issues });
    }
    const outcome = await verifyAuthSignature(deps.redis, deps.env.authSecret, parsed.data);
    if (!outcome.ok) return reply.code(401).send({ error: outcome.reason });
    return reply.send(outcome.response);
  });

  app.post('/auth/verify-tx', limited, async (request, reply) => {
    const parsed = AuthVerifyTxRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request', issues: parsed.error.issues });
    }
    const outcome = await verifyAuthTransaction(deps.redis, deps.env.authSecret, parsed.data);
    if (!outcome.ok) return reply.code(401).send({ error: outcome.reason });
    return reply.send(outcome.response);
  });
}
