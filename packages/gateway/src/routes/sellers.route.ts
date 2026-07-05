/**
 * Seller registration routes. A seller registers an origin API + price and
 * receives a working gateway URL — zero origin code change (PROXY mode).
 * Registration and listing require a signed-in session; the seller is owned by
 * the authenticated XRPL address. The single-seller lookup stays public so
 * agents (which hold no dashboard session) can resolve a seller's payTo.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Asset, PaymentMode, isClassicAddress } from '@app/shared';
import { createSeller, getSeller, listSellersByOwner } from '../db/repositories.js';
import type { SellerRow } from '../db/types.js';
import { isDecimalString } from '../util/decimal.js';
import { requireAuth } from './authenticate.js';
import type { GatewayDeps } from '../deps.js';
import { sellerGatewayUrl } from '../deps.js';

const CreateSellerSchema = z.object({
  name: z.string().min(1).max(120),
  originUrl: z.string().url(),
  payToAddress: z.string().refine(isClassicAddress, 'must be a valid XRPL classic address'),
  priceAmount: z
    .string()
    .refine(isDecimalString, 'priceAmount must be a decimal string')
    .refine((value) => Number(value) > 0, 'priceAmount must be greater than zero'),
  priceAsset: z.nativeEnum(Asset),
  paymentMode: z.nativeEnum(PaymentMode),
});

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
    gatewayUrl: sellerGatewayUrl(deps, seller.id),
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
    return reply.code(201).send({
      sellerId: seller.id,
      gatewayUrl: sellerGatewayUrl(deps, seller.id),
    });
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
