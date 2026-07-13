/**
 * Demo seller API used by the demo. It prices its own `/data` route with the
 * `@app/sdk-server` x402 middleware, which delegates challenge issuance and
 * settlement to the gateway (the facilitator) — the recommended integration.
 * With no `SELLER_ID` configured the route is served unmetered, which keeps
 * the bare server bootable before the demo registers its seller.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { x402Fastify } from '@app/sdk-server';

export interface OriginOptions {
  /** Facilitator (gateway) base URL, no trailing slash. */
  gatewayUrl?: string;
  /** The registered seller this API charges as. */
  sellerId?: string;
}

/** Build the demo seller Fastify app, metering `/data` when configured. */
export function buildOrigin(options: OriginOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });

  const metered = options.gatewayUrl && options.sellerId;
  const preHandler = metered
    ? { preHandler: x402Fastify({ gatewayUrl: options.gatewayUrl!, sellerId: options.sellerId! }) }
    : {};

  app.get('/data', preHandler, async () => ({
    message: 'premium data unlocked',
    items: [
      { id: 1, value: 'alpha' },
      { id: 2, value: 'beta' },
      { id: 3, value: 'gamma' },
    ],
  }));

  return app;
}
