/**
 * Seller registration routes. A seller registers their API (metered by the
 * `@xrpl-x402/server` middleware, which delegates to this gateway) with a price
 * and a payout address. Registration and listing require a signed-in session;
 * the seller is owned by the authenticated XRPL address. The single-seller
 * lookup stays public so agents (which hold no dashboard session) can resolve
 * the service URL, payTo, and channel destination.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Asset, PaymentSetup, XrplNetwork, isClassicAddress } from '@app/shared';
import {
  createSeller,
  getSeller,
  listPublicSellers,
  listSellersByOwner,
} from '../db/repositories.js';
import type { SellerRow } from '../db/types.js';
import { isPositiveMonetaryAmount } from '../util/decimal.js';
import { payableNetworks } from '../services/challenge.service.js';
import { requireAuth } from './authenticate.js';
import type { GatewayDeps } from '../deps.js';
import { channelDestinationFor, forNetwork } from '../deps.js';

const CreateSellerSchema = z
  .object({
    name: z.string().min(1).max(120),
    originUrl: z.string().url(),
    payToAddress: z.string().refine(isClassicAddress, 'must be a valid XRPL classic address'),
    priceAmount: z
      .string()
      .refine(
        isPositiveMonetaryAmount,
        'priceAmount must be a positive decimal with at most 38 digits and 6 decimal places',
      ),
    priceAsset: z.nativeEnum(Asset),
    paymentMode: z.nativeEnum(PaymentSetup),
    // Networks to advertise on. A seller may serve testnet, mainnet, or both;
    // the 402 `accepts[]` carries one group of entries per network.
    networks: z.array(z.nativeEnum(XrplNetwork)).min(1, 'name at least one network'),
  })
  .refine(
    // PayChan is XRP-native: any setup that accepts credits must price in XRP.
    (input) => input.paymentMode === PaymentSetup.PAY_PER_CALL || input.priceAsset === Asset.XRP,
    {
      message: 'prepaid credits require XRP pricing (PayChan is XRP-native)',
      path: ['paymentMode'],
    },
  );

/**
 * Public projection of a seller row (never exposes internal-only fields).
 *
 * `channelDestinations` is keyed by network because the gateway holds a
 * different wallet on each ledger — a client opening a prepaid channel must use
 * the destination for the network it is paying on. Only networks this gateway
 * currently serves are listed, so a client never sees an address it cannot pay.
 */
function toSellerResponse(deps: GatewayDeps, seller: SellerRow): Record<string, unknown> {
  const payable = payableNetworks(deps, seller);
  return {
    sellerId: seller.id,
    name: seller.name,
    originUrl: seller.origin_url,
    payToAddress: seller.pay_to_address,
    priceAmount: seller.price_amount,
    priceAsset: seller.price_asset,
    paymentMode: seller.payment_mode,
    networks: seller.networks,
    payableNetworks: payable,
    // Where a prepaid PayChan channel must be opened, per network: the gateway
    // when a platform fee is active (it redeems and forwards the seller's cut),
    // else the seller.
    channelDestinations: Object.fromEntries(
      payable.map((network) => [network, channelDestinationFor(forNetwork(deps, network), seller)]),
    ),
    platformFeeBps: deps.env.platformFeeBps,
  };
}

export function registerSellerRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const auth = requireAuth(deps);

  app.post('/sellers', { preHandler: auth }, async (request, reply) => {
    const parsed = CreateSellerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid seller', issues: parsed.error.issues });
    }
    // Refuse to register against a network this deployment does not serve:
    // better a clear 400 now than a seller that advertises an unpayable network.
    const unsupported = parsed.data.networks.filter((network) => !deps.xrplRegistry.has(network));
    if (unsupported.length > 0) {
      return reply.code(400).send({
        error: `network(s) not served here: ${unsupported.join(', ')}`,
        enabledNetworks: deps.env.enabledNetworks,
      });
    }
    const seller = await createSeller(deps.pool, {
      ...parsed.data,
      ownerAddress: request.ownerAddress!,
    });
    return reply.code(201).send({ sellerId: seller.id });
  });

  app.get('/sellers', { preHandler: auth }, async (request, reply) => {
    const sellers = await listSellersByOwner(deps.pool, request.ownerAddress!);
    return reply.send({ sellers: sellers.map((seller) => toSellerResponse(deps, seller)) });
  });

  app.get<{ Params: { id: string } }>('/sellers/:id', async (request, reply) => {
    const seller = await getSeller(deps.pool, request.params.id);
    if (!seller) return reply.code(404).send({ error: 'seller not found' });
    return reply.send(toSellerResponse(deps, seller));
  });

  // Public service catalog: every registered API, for agents (and the landing
  // page) to discover what is payable. Registration is the act of publishing.
  app.get('/catalog', async (_request, reply) => {
    const sellers = await listPublicSellers(deps.pool);
    return reply.send({
      networks: deps.env.enabledNetworks,
      facilitator: deps.publicBaseUrl,
      services: sellers.map((seller) => toSellerResponse(deps, seller)),
    });
  });
}
