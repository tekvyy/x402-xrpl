/**
 * The gateway's runtime dependencies, injected into routes. Keeping these
 * explicit (rather than module-level singletons) makes the app testable and
 * the wiring in `server.ts` the single composition root.
 *
 * The gateway serves several XRPL networks at once, so dependencies come in two
 * flavours. {@link GatewayDeps} carries the whole {@link XrplRegistry} and is
 * what routes receive. {@link NetworkDeps} has a single network's `XrplService`
 * already resolved and is what the settlement, channel, and escrow services
 * take — those services can only ever touch the ledger they were scoped to.
 * Routes cross that boundary exactly once, via {@link forNetwork}.
 */
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { AppEnv, XrplNetwork } from '@app/shared';
import type { XrplService } from './services/xrpl.service.js';
import type { XrplRegistry } from './services/xrpl-registry.js';
import type { SellerRow } from './db/types.js';

export interface GatewayDeps {
  pool: Pool;
  redis: Redis;
  /** Every enabled network's XRPL service; scope it with {@link forNetwork}. */
  xrplRegistry: XrplRegistry;
  env: AppEnv;
  /** Public facilitator base URL handed to bots and middleware (no trailing slash). */
  publicBaseUrl: string;
}

/** {@link GatewayDeps} narrowed to one network, with its `XrplService` resolved. */
export interface NetworkDeps extends GatewayDeps {
  /** The XRPL service for {@link network}. */
  xrpl: XrplService;
  /** The network every operation on these deps acts on. */
  network: XrplNetwork;
}

/**
 * Scope `deps` to a single network. This is the one place a network turns into
 * a connection, so the network must already have been resolved from persisted
 * state (a challenge's or channel's `network` column) rather than from config.
 *
 * @throws Error when `network` is not enabled on this gateway.
 */
export function forNetwork(deps: GatewayDeps, network: XrplNetwork): NetworkDeps {
  return { ...deps, xrpl: deps.xrplRegistry.for(network), network };
}

/**
 * Where a prepaid PayChan channel must be opened. The gateway is always the
 * destination because only the destination can submit a signed claim. It then
 * forwards the seller's cut (all of it when the platform fee is zero).
 *
 * The address is network-specific — each network has its own gateway wallet —
 * so this takes network-scoped deps.
 */
export function channelDestinationFor(deps: Pick<NetworkDeps, 'xrpl'>, _seller: SellerRow): string {
  return deps.xrpl.address();
}
