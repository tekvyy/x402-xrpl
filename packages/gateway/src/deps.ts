/**
 * The gateway's runtime dependencies, injected into routes. Keeping these
 * explicit (rather than module-level singletons) makes the app testable and
 * the wiring in `server.ts` the single composition root.
 */
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { AppEnv } from '@app/shared';
import type { XrplService } from './services/xrpl.service.js';
import type { SellerRow } from './db/types.js';

export interface GatewayDeps {
  pool: Pool;
  redis: Redis;
  xrpl: XrplService;
  env: AppEnv;
  /** Public facilitator base URL handed to bots and middleware (no trailing slash). */
  publicBaseUrl: string;
}

/**
 * Where a prepaid PayChan channel must be opened. The gateway is always the
 * destination because only the destination can submit a signed claim. It then
 * forwards the seller's cut (all of it when the platform fee is zero).
 */
export function channelDestinationFor(deps: Pick<GatewayDeps, 'xrpl'>, _seller: SellerRow): string {
  return deps.xrpl.address();
}
