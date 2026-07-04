/**
 * Trivial priced origin API used by the demo. It knows nothing about x402 or
 * payments — the gateway meters access to it. `GET /data` returns a small
 * premium payload.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { Asset } from '@app/shared';

/** The demo endpoint is priced in RLUSD by default. */
export const DEMO_PRICE_ASSET: Asset = Asset.RLUSD;

/** Build the demo origin Fastify app. */
export function buildOrigin(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get('/data', async () => ({
    message: 'premium data unlocked',
    pricedIn: DEMO_PRICE_ASSET,
    items: [
      { id: 1, value: 'alpha' },
      { id: 2, value: 'beta' },
      { id: 3, value: 'gamma' },
    ],
  }));

  return app;
}
