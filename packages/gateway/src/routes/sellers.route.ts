/**
 * Seller registration routes. A seller registers an origin API + price and
 * receives a working gateway URL — zero origin code change (PROXY mode).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Asset, PaymentMode } from '@app/shared';
import { createSeller, getSeller } from '../db/repositories.js';
import { isDecimalString } from '../util/decimal.js';
import type { GatewayDeps } from '../deps.js';
import { sellerGatewayUrl } from '../deps.js';

const CreateSellerSchema = z.object({
  name: z.string().min(1),
  originUrl: z.string().url(),
  payToAddress: z.string().min(25),
  priceAmount: z.string().refine(isDecimalString, 'priceAmount must be a decimal string'),
  priceAsset: z.nativeEnum(Asset),
  paymentMode: z.nativeEnum(PaymentMode),
});

export function registerSellerRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  app.post('/sellers', async (request, reply) => {
    const parsed = CreateSellerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid seller', issues: parsed.error.issues });
    }
    const seller = await createSeller(deps.pool, parsed.data);
    return reply.code(201).send({
      sellerId: seller.id,
      gatewayUrl: sellerGatewayUrl(deps, seller.id),
    });
  });

  app.get<{ Params: { id: string } }>('/sellers/:id', async (request, reply) => {
    const seller = await getSeller(deps.pool, request.params.id);
    if (!seller) return reply.code(404).send({ error: 'seller not found' });
    return reply.send({
      sellerId: seller.id,
      name: seller.name,
      originUrl: seller.origin_url,
      payToAddress: seller.pay_to_address,
      priceAmount: seller.price_amount,
      priceAsset: seller.price_asset,
      paymentMode: seller.payment_mode,
      gatewayUrl: sellerGatewayUrl(deps, seller.id),
    });
  });
}
