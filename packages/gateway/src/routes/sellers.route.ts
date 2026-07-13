/**
 * Seller registration routes. A seller registers their API (metered by the
 * `@app/sdk-server` middleware, which delegates to this gateway) with a price
 * and a payout address. Registration and listing require a signed-in session;
 * the seller is owned by the authenticated XRPL address. The single-seller
 * lookup stays public so agents (which hold no dashboard session) can resolve
 * the service URL, payTo, and channel destination.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Asset, PaymentSetup, isClassicAddress } from '@app/shared';
import { createSeller, getSeller, listSellersByOwner } from '../db/repositories.js';
import type { SellerRow } from '../db/types.js';
import { isDecimalString } from '../util/decimal.js';
import { requireAuth } from './authenticate.js';
import type { GatewayDeps } from '../deps.js';
import { channelDestinationFor } from '../deps.js';

const CreateSellerSchema = z.object({
  name: z.string().min(1).max(120),
  originUrl: z.string().url(),
  payToAddress: z.string().refine(isClassicAddress, 'must be a valid XRPL classic address'),
  priceAmount: z
    .string()
    .refine(isDecimalString, 'priceAmount must be a decimal string')
    .refine((value) => Number(value) > 0, 'priceAmount must be greater than zero'),
  priceAsset: z.nativeEnum(Asset),
  paymentMode: z.nativeEnum(PaymentSetup),
}).refine(
  // PayChan is XRP-native: any setup that accepts credits must price in XRP.
  (input) => input.paymentMode === PaymentSetup.PAY_PER_CALL || input.priceAsset === Asset.XRP,
  { message: 'prepaid credits require XRP pricing (PayChan is XRP-native)', path: ['paymentMode'] },
);

/** Public projection of a seller row (never exposes internal-only fields). */
function toSellerResponse(deps: GatewayDeps, seller: SellerRow): Record<string, unknown> {
  return {
    sellerId: seller.id,
    name: seller.name,
    originUrl: seller.origin_url,
    payToAddress: seller.pay_to_address,
    priceAmount: seller.price_amount,
    priceAsset: seller.price_asset,
    paymentMode: seller.payment_mode,
    // Where a prepaid PayChan channel must be opened: the gateway when a platform
    // fee is active (it redeems and forwards the seller's cut), else the seller.
    channelDestination: channelDestinationFor(deps, seller),
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
}
