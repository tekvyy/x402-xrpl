/**
 * Facilitator HTTP surface (US-007). The spec endpoints follow the x402 v1
 * facilitator interface exactly; `/challenge` is a non-spec convenience that
 * lets the `sdk-server` middleware price the seller's *own* routes without
 * re-implementing any x402 logic. Challenge issuance is delegated here because
 * replay protection is anchored in the gateway's single-use nonce ledger.
 *
 *   POST /challenge  → issue a single-use 402 challenge for (seller, resource)
 *                      (non-spec; returns a full PaymentRequirementsResponse)
 *   POST /settle     → x402 facilitator settle: verify + settle a payment,
 *                      consuming the challenge
 *   GET  /supported  → x402 facilitator capability listing
 *
 * `POST /verify` (no-consume) lives in the usage route.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  FacilitatorRequestSchema,
  SettleResult,
  X402Scheme,
  X402_VERSION,
  X402ErrorCode,
  x402NetworkId,
} from '@app/shared';
import type { SettlementResponse, SupportedResponse } from '@app/shared';
import { getSeller } from '../db/repositories.js';
import { issueChallenge } from '../services/challenge.service.js';
import { settle } from '../services/settle.service.js';
import { CHALLENGE_RATE_LIMIT, SETTLEMENT_RATE_LIMIT } from '../constants.js';
import { rateLimitByIp } from '../util/rate-limit.js';
import type { GatewayDeps } from '../deps.js';

/** Request a challenge for a registered seller's resource path. */
const ChallengeBodySchema = z.object({
  sellerId: z.string().uuid(),
  /** The seller's own route being priced (leading-slash path). */
  resource: z.string().min(1).max(512),
});

export function registerFacilitatorRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const limited = { preHandler: rateLimitByIp(deps.redis, CHALLENGE_RATE_LIMIT) };
  const settlementLimited = { preHandler: rateLimitByIp(deps.redis, SETTLEMENT_RATE_LIMIT) };
  app.post('/challenge', limited, async (request, reply) => {
    const parsed = ChallengeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid challenge request', issues: parsed.error.issues });
    }

    const seller = await getSeller(deps.pool, parsed.data.sellerId);
    if (!seller) return reply.code(404).send({ error: 'unknown seller' });

    const requirements = await issueChallenge(deps, seller, parsed.data.resource);
    // A seller whose networks are all disabled here has nothing payable; say so
    // rather than returning a 402 with an empty accepts[] the client can't use.
    if (requirements.length === 0) {
      return reply.code(503).send({
        error: 'seller has no payable network on this gateway',
        sellerNetworks: seller.networks,
        enabledNetworks: deps.env.enabledNetworks,
      });
    }
    // The middleware relays this body verbatim as its 402 response, so it is a
    // complete spec `PaymentRequirementsResponse`, `error` included.
    return reply.send({
      x402Version: X402_VERSION,
      error: 'X-PAYMENT header is required',
      accepts: requirements,
    });
  });

  app.post('/settle', settlementLimited, async (request, reply) => {
    const parsed = FacilitatorRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: X402ErrorCode.INVALID_PAYLOAD, issues: parsed.error.issues });
    }

    const { paymentPayload, paymentRequirements } = parsed.data;
    const outcome = await settle(deps, paymentPayload, paymentRequirements);
    const settled = outcome.result === SettleResult.SETTLED;
    const body: SettlementResponse = {
      success: settled,
      ...(settled ? {} : { errorReason: outcome.reason ?? X402ErrorCode.UNEXPECTED_SETTLE_ERROR }),
      transaction: outcome.txHash ?? '',
      // Echo the network actually settled on (resolved from the challenge), not
      // a process-wide default. Falls back to the payload's own network when the
      // request was rejected before the challenge could be resolved.
      network: outcome.challenge
        ? x402NetworkId(outcome.challenge.network)
        : paymentPayload.network,
      payer: outcome.payer ?? paymentPayload.payload.payer,
      ...(outcome.explorerUrl ? { explorerUrl: outcome.explorerUrl } : {}),
    };
    // A gateway-side fault (ledger connection down) is a 503, not a payment
    // rejection: the payer must retry the same X-PAYMENT, not pay again.
    return reply.code(outcome.unavailable ? 503 : 200).send(body);
  });

  app.get('/supported', async (_request, reply) => {
    // Both schemes on every network this gateway actually serves.
    const body: SupportedResponse = {
      kinds: deps.env.enabledNetworks.flatMap((xrplNetwork) => {
        const network = x402NetworkId(xrplNetwork);
        return [
          { x402Version: X402_VERSION, scheme: X402Scheme.EXACT, network },
          { x402Version: X402_VERSION, scheme: X402Scheme.PAYCHAN, network },
        ];
      }),
    };
    return reply.send(body);
  });
}
