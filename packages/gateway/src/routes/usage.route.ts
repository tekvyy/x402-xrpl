/**
 * Usage + facilitator-verify routes (US-005).
 *
 *   POST /verify              → x402 facilitator verify (no challenge consumed)
 *   GET  /usage/summary       → revenue per asset, total calls, active wallets
 *   GET  /usage/top-endpoints → busiest endpoints
 *   GET  /usage/by-wallet     → per-wallet call count + spend
 *   GET  /usage/stream        → SSE live feed of settlements (Redis pub/sub)
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PaymentPayloadSchema, SettleResult } from '@app/shared';
import type { PaymentResponse } from '@app/shared';
import {
  getTopEndpoints,
  getUsageByWallet,
  getUsageSummary,
} from '../db/repositories.js';
import { verify } from '../services/settle.service.js';
import { usageChannelName } from '../services/usage.service.js';
import type { GatewayDeps } from '../deps.js';

/** Facilitator verify request: which seller + the payment payload to check. */
const VerifyBodySchema = z.object({
  sellerId: z.string().uuid(),
  payment: PaymentPayloadSchema,
});

const SellerQuerySchema = z.object({ sellerId: z.string().uuid() });

/** Heartbeat interval keeps SSE connections alive through idle proxies. */
const SSE_HEARTBEAT_MS = 15_000;

export function registerUsageRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  app.post('/verify', async (request, reply) => {
    const parsed = VerifyBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid verify request', issues: parsed.error.issues });
    }

    const outcome = await verify(deps, parsed.data.payment, parsed.data.sellerId);
    const body: PaymentResponse =
      outcome.result === SettleResult.VERIFIED
        ? { result: SettleResult.VERIFIED, txHash: outcome.txHash, explorerUrl: outcome.explorerUrl }
        : { result: SettleResult.REJECTED, reason: outcome.reason };
    return reply.send(body);
  });

  app.get('/usage/summary', async (request, reply) => {
    const parsed = SellerQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'sellerId query param required' });
    return reply.send(await getUsageSummary(deps.pool, parsed.data.sellerId));
  });

  app.get('/usage/top-endpoints', async (request, reply) => {
    const parsed = SellerQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'sellerId query param required' });
    return reply.send({ endpoints: await getTopEndpoints(deps.pool, parsed.data.sellerId) });
  });

  app.get('/usage/by-wallet', async (request, reply) => {
    const parsed = SellerQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'sellerId query param required' });
    return reply.send({ wallets: await getUsageByWallet(deps.pool, parsed.data.sellerId) });
  });

  app.get('/usage/stream', async (request, reply) => {
    const parsed = SellerQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'sellerId query param required' });

    await openUsageStream(deps, reply, parsed.data.sellerId);
  });
}

/**
 * Take over the raw socket and stream this seller's usage events as SSE. Uses a
 * dedicated Redis connection (subscribe mode is exclusive) that is torn down,
 * along with the heartbeat, when the client disconnects.
 */
async function openUsageStream(
  deps: GatewayDeps,
  reply: FastifyReply,
  sellerId: string,
): Promise<void> {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': deps.env.dashboardOrigin,
  });
  res.write(': connected\n\n');

  const subscriber = deps.redis.duplicate();
  const channel = usageChannelName(sellerId);
  subscriber.on('message', (_channel, message) => {
    res.write(`data: ${message}\n\n`);
  });
  await subscriber.subscribe(channel);

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), SSE_HEARTBEAT_MS);

  res.on('close', () => {
    clearInterval(heartbeat);
    void subscriber.quit().catch(() => undefined);
  });
}
