/**
 * Usage + facilitator-verify routes (US-005).
 *
 *   POST /verify              → x402 facilitator verify (no challenge consumed)
 *   GET  /usage/summary       → revenue per asset, total calls, active wallets
 *   GET  /usage/top-endpoints → busiest endpoints
 *   GET  /usage/by-wallet     → per-wallet call count + spend
 *   GET  /usage/history       → paginated audit history of settled calls
 *   GET  /usage/stream        → SSE live feed of settlements (Redis pub/sub)
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { FacilitatorRequestSchema, SettleResult, X402ErrorCode } from '@app/shared';
import type { VerifyResponse } from '@app/shared';
import {
  getSeller,
  getTopEndpoints,
  getUsageByWallet,
  getUsageSummary,
  listUsageEvents,
} from '../db/repositories.js';
import { verify } from '../services/settle.service.js';
import { decodeAuditCursor, encodeAuditCursor } from '../services/audit.service.js';
import { usageChannelName } from '../services/usage.service.js';
import { verifyToken } from '../services/auth.service.js';
import { requireAuth } from './authenticate.js';
import { SETTLEMENT_RATE_LIMIT } from '../constants.js';
import { rateLimitByIp } from '../util/rate-limit.js';
import type { GatewayDeps } from '../deps.js';

const SellerQuerySchema = z.object({ sellerId: z.string().uuid() });

/** `GET /usage/history` query: page size plus the previous page's cursor. */
const HistoryQuerySchema = z.object({
  sellerId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().min(1).optional(),
});

/**
 * The SSE stream is opened by the browser's `EventSource`, which cannot set an
 * `Authorization` header — so the session token rides in a query param instead.
 */
const StreamQuerySchema = z.object({
  sellerId: z.string().uuid(),
  token: z.string().min(1),
});

/** Heartbeat interval keeps SSE connections alive through idle proxies. */
const SSE_HEARTBEAT_MS = 15_000;

/**
 * Resolve the `sellerId` query param and confirm the authenticated caller owns
 * that seller. Usage data (revenue, customer wallets, live settlements) is
 * private to the seller, so every read is scoped to the owner — otherwise
 * anyone holding a seller UUID could read another seller's books. Replies with
 * the appropriate error and returns `undefined` when the request is not allowed.
 */
async function authorizeSellerQuery(
  deps: GatewayDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | undefined> {
  const parsed = SellerQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    await reply.code(400).send({ error: 'sellerId query param required' });
    return undefined;
  }
  const seller = await getSeller(deps.pool, parsed.data.sellerId);
  // Do not distinguish "not found" from "not yours": both return 404 so a caller
  // cannot probe which seller UUIDs exist.
  if (!seller || seller.owner_address !== request.ownerAddress) {
    await reply.code(404).send({ error: 'seller not found' });
    return undefined;
  }
  return seller.id;
}

export function registerUsageRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const auth = requireAuth(deps);
  const settlementLimited = { preHandler: rateLimitByIp(deps.redis, SETTLEMENT_RATE_LIMIT) };

  app.post('/verify', settlementLimited, async (request, reply) => {
    const parsed = FacilitatorRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: X402ErrorCode.INVALID_PAYLOAD, issues: parsed.error.issues });
    }

    const { paymentPayload, paymentRequirements } = parsed.data;
    const outcome = await verify(deps, paymentPayload, paymentRequirements);
    const isValid = outcome.result === SettleResult.VERIFIED;
    const body: VerifyResponse = {
      isValid,
      ...(isValid
        ? {}
        : { invalidReason: outcome.reason ?? X402ErrorCode.UNEXPECTED_VERIFY_ERROR }),
      payer: outcome.payer ?? paymentPayload.payload.payer,
    };
    // A gateway-side fault (ledger connection down) is a 503, not a verdict
    // on the payment: the payer should retry the same X-PAYMENT.
    return reply.code(outcome.unavailable ? 503 : 200).send(body);
  });

  // Paginated audit history of every settled call, straight from usage_events.
  // Same wire shape as the SSE feed events so the dashboard renders both alike.
  app.get('/usage/history', { preHandler: auth }, async (request, reply) => {
    const sellerId = await authorizeSellerQuery(deps, request, reply);
    if (!sellerId) return reply;
    const parsed = HistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid history query', issues: parsed.error.issues });
    }
    let before: { createdAt: Date; id: string } | undefined;
    if (parsed.data.before) {
      const cursor = decodeAuditCursor(parsed.data.before);
      if (!cursor) return reply.code(400).send({ error: 'invalid history cursor' });
      before = cursor;
    }
    const rows = await listUsageEvents(deps.pool, sellerId, parsed.data.limit, before);
    // A short page means the table is exhausted; only a full page gets a cursor.
    const last = rows.length === parsed.data.limit ? rows[rows.length - 1] : undefined;
    return reply.send({
      events: rows.map((row) => ({
        id: row.id,
        sellerId: row.seller_id,
        walletAddress: row.wallet_address,
        endpoint: row.endpoint,
        amount: row.amount,
        asset: row.asset,
        mode: row.mode,
        network: row.network,
        txHash: row.tx_hash,
        timestamp: row.created_at.toISOString(),
      })),
      nextCursor: last ? encodeAuditCursor({ createdAt: last.created_at, id: last.id }) : null,
    });
  });

  app.get('/usage/summary', { preHandler: auth }, async (request, reply) => {
    const sellerId = await authorizeSellerQuery(deps, request, reply);
    if (!sellerId) return reply;
    return reply.send(await getUsageSummary(deps.pool, sellerId));
  });

  app.get('/usage/top-endpoints', { preHandler: auth }, async (request, reply) => {
    const sellerId = await authorizeSellerQuery(deps, request, reply);
    if (!sellerId) return reply;
    return reply.send({ endpoints: await getTopEndpoints(deps.pool, sellerId) });
  });

  app.get('/usage/by-wallet', { preHandler: auth }, async (request, reply) => {
    const sellerId = await authorizeSellerQuery(deps, request, reply);
    if (!sellerId) return reply;
    return reply.send({ wallets: await getUsageByWallet(deps.pool, sellerId) });
  });

  app.get('/usage/stream', async (request, reply) => {
    const parsed = StreamQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'sellerId and token required' });

    // EventSource can't send an Authorization header, so authenticate the token
    // from the query param, then scope the stream to the owner's own seller.
    const address = verifyToken(deps.env.authSecret, parsed.data.token);
    if (!address) return reply.code(401).send({ error: 'invalid or expired session' });

    const seller = await getSeller(deps.pool, parsed.data.sellerId);
    if (!seller || seller.owner_address !== address) {
      return reply.code(404).send({ error: 'seller not found' });
    }

    await openUsageStream(deps, reply, seller.id);
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
