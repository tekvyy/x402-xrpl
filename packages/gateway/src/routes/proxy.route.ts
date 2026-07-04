/**
 * The metered proxy route — the heart of the pay-per-call loop.
 *
 *   unpaid request           → 402 with x402 `accepts[]` challenge
 *   request with X-PAYMENT    → verify + settle, then forward to the origin
 *                               and return the body with `X-PAYMENT-RESPONSE`.
 */
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  SettleResult,
  X402Header,
  encodeHeaderPayload,
  parsePaymentHeader,
} from '@app/shared';
import type { PaymentPayload, PaymentResponse } from '@app/shared';
import { getSeller } from '../db/repositories.js';
import type { SellerRow } from '../db/types.js';
import { issueChallenge } from '../services/challenge.service.js';
import { settle } from '../services/settle.service.js';
import type { SettleOutcome } from '../services/settle.service.js';
import type { GatewayDeps } from '../deps.js';

/** Headers that must not be copied verbatim when proxying a response. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'content-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
]);

/** Request headers we never forward upstream. */
const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'accept-encoding',
  X402Header.X_PAYMENT,
]);

interface ProxyParams {
  sellerId: string;
  '*': string;
}

export function registerProxyRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  app.all<{ Params: ProxyParams }>('/gw/:sellerId/*', async (request, reply) => {
    const seller = await getSeller(deps.pool, request.params.sellerId);
    if (!seller) return reply.code(404).send({ error: 'unknown gateway' });

    const subpath = request.params['*'] ?? '';
    const resource = `/${subpath}`;

    const header = request.headers[X402Header.X_PAYMENT];
    if (typeof header !== 'string' || header.length === 0) {
      const requirements = await issueChallenge(deps, seller, resource);
      return reply.code(402).send({ x402Version: 1, accepts: [requirements] });
    }

    let payload: PaymentPayload;
    try {
      payload = parsePaymentHeader(header);
    } catch {
      return reply.code(400).send({ error: 'malformed X-PAYMENT header' });
    }

    const outcome = await settle(deps, payload, seller.id);
    if (outcome.result !== SettleResult.SETTLED) {
      const body: PaymentResponse = { result: SettleResult.REJECTED, reason: outcome.reason };
      return reply
        .code(402)
        .header(X402Header.X_PAYMENT_RESPONSE, encodeHeaderPayload(body))
        .send({ x402Version: 1, error: outcome.reason ?? 'payment rejected' });
    }

    return forwardToOrigin(seller, request, reply, subpath, outcome);
  });
}

/** Forward the (now paid-for) request to the origin and stream the response. */
async function forwardToOrigin(
  seller: SellerRow,
  request: FastifyRequest,
  reply: FastifyReply,
  subpath: string,
  outcome: SettleOutcome,
): Promise<FastifyReply> {
  const base = seller.origin_url.replace(/\/+$/, '');
  const target = new URL(`${base}/${subpath}`);
  const queryIndex = request.url.indexOf('?');
  if (queryIndex >= 0) target.search = request.url.slice(queryIndex);

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined || STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD' && request.body != null;
  const body = hasBody
    ? typeof request.body === 'string'
      ? request.body
      : JSON.stringify(request.body)
    : undefined;

  const upstream = await fetch(target, { method, headers, body });

  reply.code(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) reply.header(key, value);
  });

  const paymentResponse: PaymentResponse = {
    result: SettleResult.SETTLED,
    txHash: outcome.txHash,
    explorerUrl: outcome.explorerUrl,
  };
  reply.header(X402Header.X_PAYMENT_RESPONSE, encodeHeaderPayload(paymentResponse));

  if (!upstream.body) return reply.send();
  return reply.send(Readable.fromWeb(upstream.body as unknown as WebReadableStream<Uint8Array>));
}
