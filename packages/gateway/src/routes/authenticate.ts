/**
 * Bearer-token authentication for protected routes. `requireAuth` returns a
 * Fastify preHandler that validates the session token and pins the caller's
 * XRPL address onto the request as `ownerAddress`.
 */
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { AUTHORIZATION_HEADER, BEARER_PREFIX } from '@app/shared';
import { verifyToken } from '../services/auth.service.js';
import type { GatewayDeps } from '../deps.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** XRPL address of the authenticated caller; set by {@link requireAuth}. */
    ownerAddress?: string;
  }
}

/** Build a preHandler that rejects unauthenticated requests with 401. */
export function requireAuth(deps: GatewayDeps): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers[AUTHORIZATION_HEADER];
    if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) {
      return reply.code(401).send({ error: 'authentication required' });
    }
    const token = header.slice(BEARER_PREFIX.length);
    const address = verifyToken(deps.env.authSecret, token);
    if (!address) {
      return reply.code(401).send({ error: 'invalid or expired session' });
    }
    request.ownerAddress = address;
  };
}
