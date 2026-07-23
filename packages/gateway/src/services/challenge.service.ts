/**
 * 402 challenge issuance. Creates a single-use, request-bound nonce, persists
 * it (PENDING) in Postgres — the sole replay-protection ledger — then returns
 * the x402 `PaymentRequirements` describing how to pay. The wire
 * `maxAmountRequired` follows the x402 atomic-unit convention: drops for XRP,
 * decimal units for RLUSD (XRPL issued currencies are natively decimal).
 */
import { randomUUID } from 'node:crypto';
import { xrpToDrops } from 'xrpl';
import {
  Asset,
  CHALLENGE_TTL_MS,
  PaymentRequirementsSchema,
  networkConfig,
  schemeForMode,
  setupModes,
  x402NetworkId,
} from '@app/shared';
import type { PaymentRequirements, XrplNetwork } from '@app/shared';
import { createChallenge } from '../db/repositories.js';
import type { SellerRow } from '../db/types.js';
import type { GatewayDeps } from '../deps.js';

/**
 * Networks a seller can actually be paid on right now: the ones it advertises,
 * intersected with the ones this gateway serves. A seller registered for
 * mainnet on a testnet-only deployment is simply not payable until mainnet is
 * enabled, rather than being advertised and then failing at settle.
 */
export function payableNetworks(deps: GatewayDeps, seller: SellerRow): XrplNetwork[] {
  return seller.networks.filter((network) => deps.xrplRegistry.has(network));
}

/**
 * Issue a fresh challenge for `resource` priced by `seller` and return the 402
 * `accepts[]` array.
 *
 * One challenge row is persisted **per network**, each with its own nonce, and
 * every scheme the seller's setup accepts is advertised against that nonce. The
 * nonce is therefore bound to exactly one ledger for its whole life, which is
 * what lets settle resolve the network from persisted state instead of config
 * (see `loadChallenge` in settle.service.ts). Within a network the schemes
 * share a nonce, so the payer settles in exactly one of them.
 *
 * Returns an empty array when the seller has no payable network; the caller
 * turns that into an error rather than an empty 402.
 */
export async function issueChallenge(
  deps: GatewayDeps,
  seller: SellerRow,
  resource: string,
): Promise<PaymentRequirements[]> {
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  const wireAmount =
    seller.price_asset === Asset.XRP ? xrpToDrops(seller.price_amount) : seller.price_amount;
  const modes = setupModes(seller.payment_mode);

  const accepts: PaymentRequirements[] = [];
  for (const network of payableNetworks(deps, seller)) {
    const nonce = randomUUID();
    await createChallenge(deps.pool, {
      nonce,
      sellerId: seller.id,
      network,
      amount: seller.price_amount,
      asset: seller.price_asset,
      resource,
      expiresAt,
    });

    const { rlusdIssuer } = networkConfig(deps.env, network);
    for (const mode of modes) {
      accepts.push(
        PaymentRequirementsSchema.parse({
          scheme: schemeForMode(mode),
          network: x402NetworkId(network),
          maxAmountRequired: wireAmount,
          asset: seller.price_asset,
          payTo: seller.pay_to_address,
          resource,
          description: `${seller.name}: metered access to ${resource}`,
          maxTimeoutSeconds: Math.floor(CHALLENGE_TTL_MS / 1000),
          extra: {
            nonce,
            ...(seller.price_asset === Asset.RLUSD ? { issuer: rlusdIssuer } : {}),
          },
        }),
      );
    }
  }
  return accepts;
}
