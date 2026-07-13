/**
 * 402 challenge issuance. Creates a single-use, request-bound nonce, persists
 * it (PENDING) and mirrors it into the Redis nonce cache, then returns the
 * x402 `PaymentRequirements` describing how to pay. The wire `amount` follows
 * the x402 convention: drops for XRP, human units for RLUSD.
 */
import { randomUUID } from 'node:crypto';
import { xrpToDrops } from 'xrpl';
import {
  Asset,
  CHALLENGE_TTL_MS,
  PaymentRequirementsSchema,
  setupModes,
} from '@app/shared';
import type { PaymentRequirements } from '@app/shared';
import { createChallenge } from '../db/repositories.js';
import type { SellerRow } from '../db/types.js';
import { cacheNonce } from '../redis/client.js';
import type { GatewayDeps } from '../deps.js';

/**
 * Issue a fresh challenge for `resource` priced by `seller`. Persists one
 * single-use challenge and returns a validated `PaymentRequirements` entry
 * per payment mode the seller's setup accepts — the 402 `accepts[]` array.
 * All entries share the nonce; the payer settles it in exactly one mode.
 */
export async function issueChallenge(
  deps: GatewayDeps,
  seller: SellerRow,
  resource: string,
): Promise<PaymentRequirements[]> {
  const nonce = randomUUID();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

  await createChallenge(deps.pool, {
    nonce,
    sellerId: seller.id,
    amount: seller.price_amount,
    asset: seller.price_asset,
    resource,
    expiresAt,
  });
  await cacheNonce(deps.redis, nonce, CHALLENGE_TTL_MS);

  const wireAmount =
    seller.price_asset === Asset.XRP ? xrpToDrops(seller.price_amount) : seller.price_amount;

  return setupModes(seller.payment_mode).map((mode) =>
    PaymentRequirementsSchema.parse({
      mode,
      asset: seller.price_asset,
      amount: wireAmount,
      payTo: seller.pay_to_address,
      nonce,
      resource,
      expiresAt: expiresAt.getTime(),
      ...(seller.price_asset === Asset.RLUSD ? { issuer: deps.env.rlusdIssuer } : {}),
    }),
  );
}
