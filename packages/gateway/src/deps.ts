/**
 * The gateway's runtime dependencies, injected into routes. Keeping these
 * explicit (rather than module-level singletons) makes the app testable and
 * the wiring in `server.ts` the single composition root.
 */
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { AppEnv } from '@app/shared';
import type { XrplService } from './services/xrpl.service.js';

export interface GatewayDeps {
  pool: Pool;
  redis: Redis;
  xrpl: XrplService;
  env: AppEnv;
  /** Public base URL used to build seller gateway URLs (no trailing slash). */
  publicBaseUrl: string;
}

/** Build the public proxy URL a seller hands to their callers. */
export function sellerGatewayUrl(deps: GatewayDeps, sellerId: string): string {
  return `${deps.publicBaseUrl}/gw/${sellerId}`;
}
