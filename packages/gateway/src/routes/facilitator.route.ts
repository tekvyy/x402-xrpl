/**
 * Facilitator HTTP surface (US-007). These endpoints let the `sdk-server`
 * middleware price the seller's *own* routes without re-implementing any x402
 * logic: the middleware asks the gateway to issue a challenge, then hands the
 * payment back for settlement. They mirror Coinbase x402's stateless
 * facilitator, but challenge issuance is delegated too because replay
 * protection is anchored in the gateway's single-use nonce ledger.
 *
 *   POST /challenge  → issue a single-use 402 challenge for (seller, resource)
 *   POST /settle     → verify + settle a payment, consuming the challenge
 *
 * `POST /verify` (no-consume) already lives in the usage route.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PaymentPayloadSchema, SettleResult } from '@app/shared';
import type { PaymentResponse } from '@app/shared';
import { getSeller } from '../db/repositories.js';
import { issueChallenge } from '../services/challenge.service.js';
import { settle } from '../services/settle.service.js';
import type { GatewayDeps } from '../deps.js';

/** Request a challenge for a registered seller's resource path. */
const ChallengeBodySchema = z.object({
  sellerId: z.string().uuid(),
  /** The seller's own route being priced (leading-slash path). */
  resource: z.string().min(1),
});

/** Settle a payment presented by the middleware on a client's retry. */
const SettleBodySchema = z.object({
  sellerId: z.string().uuid(),
  payment: PaymentPayloadSchema,
});

export function registerFacilitatorRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  app.post('/challenge', async (request, reply) => {
    const parsed = ChallengeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid challenge request', issues: parsed.error.issues });
    }

    const seller = await getSeller(deps.pool, parsed.data.sellerId);
    if (!seller) return reply.code(404).send({ error: 'unknown seller' });

    const requirements = await issueChallenge(deps, seller, parsed.data.resource);
    return reply.send({ x402Version: 1, accepts: requirements });
  });

  app.post('/settle', async (request, reply) => {
    const parsed = SettleBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid settle request', issues: parsed.error.issues });
    }

    const outcome = await settle(deps, parsed.data.payment, parsed.data.sellerId);
    const body: PaymentResponse =
      outcome.result === SettleResult.SETTLED
        ? { result: SettleResult.SETTLED, txHash: outcome.txHash, explorerUrl: outcome.explorerUrl }
        : { result: SettleResult.REJECTED, reason: outcome.reason };
    return reply.send(body);
  });
}
