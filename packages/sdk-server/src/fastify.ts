/**
 * Fastify adapter for the `x402` middleware, exposed as a `preHandler` hook.
 * Attach it to any route to charge per call:
 *
 *   import Fastify from 'fastify';
 *   import { x402Fastify } from '@xrpl-x402/server';
 *
 *   const app = Fastify();
 *   const pay = x402Fastify({ gatewayUrl: 'http://localhost:8402', sellerId });
 *   app.get('/premium', { preHandler: pay }, async () => ({ secret: 42 }));
 *
 * On a valid payment the hook resolves without sending, so the route handler
 * runs; otherwise it answers 402/400 itself and the handler is skipped.
 */
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { X402Header } from '@app/shared/sdk';
import { decide, PAYMENT_RESPONSE_HEADER } from './core.js';
import type { X402MiddlewareOptions } from './types.js';

/** Build a Fastify `preHandler` that meters its route via x402. */
export function x402Fastify(options: X402MiddlewareOptions): preHandlerHookHandler {
  return async function x402PreHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const raw = request.headers[X402Header.X_PAYMENT];
    const header = Array.isArray(raw) ? raw[0] : raw;

    const decision = await decide(options, request.url.split('?')[0] ?? request.url, header);

    if (decision.kind === 'proceed') {
      reply.header(PAYMENT_RESPONSE_HEADER, decision.paymentResponseHeader);
      return;
    }

    if (decision.paymentResponseHeader) {
      reply.header(PAYMENT_RESPONSE_HEADER, decision.paymentResponseHeader);
    }
    await reply.code(decision.status).send(decision.body);
  };
}
