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

/**
 * Validate the bearer token and pin the caller's address onto the request.
 * Sends the 401 and returns `undefined` when the request is unauthenticated.
 */
async function authenticate(
  deps: GatewayDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | undefined> {
  const header = request.headers[AUTHORIZATION_HEADER];
  if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) {
    await reply.code(401).send({ error: 'authentication required' });
    return undefined;
  }
  const token = header.slice(BEARER_PREFIX.length);
  const address = verifyToken(deps.env.authSecret, token);
  if (!address) {
    await reply.code(401).send({ error: 'invalid or expired session' });
    return undefined;
  }
  request.ownerAddress = address;
  return address;
}

/** Build a preHandler that rejects unauthenticated requests with 401. */
export function requireAuth(deps: GatewayDeps): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await authenticate(deps, request, reply);
  };
}

/**
 * Build a preHandler that additionally requires the authenticated address to
 * be in `ADMIN_ADDRESSES`. Admins hold ordinary wallet sessions; membership in
 * the configured list is the only thing that elevates them.
 */
export function requireAdmin(deps: GatewayDeps): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const address = await authenticate(deps, request, reply);
    if (!address) return;
    if (!deps.env.adminAddresses.includes(address)) {
      return reply.code(403).send({ error: 'admin access required' });
    }
  };
}
