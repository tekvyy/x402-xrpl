/**
 * Typed, validated runtime configuration. `loadEnv` throws a clear aggregated
 * error listing every missing/invalid key so misconfiguration fails fast at
 * boot rather than deep inside a request handler.
 */
import { z } from 'zod';
import { XrplNetwork } from './enums.js';
import { XRPL_ENDPOINTS } from './constants.js';

const EnvSchema = z.object({
  XRPL_NETWORK: z.nativeEnum(XrplNetwork),
  // Optional: falls back to the network default endpoint when unset.
  XRPL_ENDPOINT: z.string().url().optional(),
  GATEWAY_XRPL_SEED: z.string().min(1, 'GATEWAY_XRPL_SEED is required'),
  SOURCE_TAG: z.coerce.number().int().nonnegative(),
  RLUSD_ISSUER: z.string().min(1, 'RLUSD_ISSUER is required'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  GATEWAY_PORT: z.coerce.number().int().positive(),
  DASHBOARD_ORIGIN: z.string().url(),
  // Optional: enables the custodial escrow-credits fallback (US-004). Off by
  // default; the authentic path is PayChan. Accepts `true`/`1`/`false`/`0`.
  ESCROW_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((value) => value === 'true' || value === '1'),
});

/** Fully resolved config, with `xrplEndpoint` defaulted from the network. */
export interface AppEnv {
  xrplNetwork: XrplNetwork;
  xrplEndpoint: string;
  gatewayXrplSeed: string;
  sourceTag: number;
  rlusdIssuer: string;
  databaseUrl: string;
  redisUrl: string;
  gatewayPort: number;
  dashboardOrigin: string;
  /** Whether the config-gated escrow-credits fallback is enabled (US-004). */
  escrowEnabled: boolean;
}

/**
 * Validate `source` (defaults to `process.env`) and return typed config.
 * @throws Error with a readable, multi-line message when any key is invalid.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const data = parsed.data;
  return {
    xrplNetwork: data.XRPL_NETWORK,
    xrplEndpoint: data.XRPL_ENDPOINT ?? XRPL_ENDPOINTS[data.XRPL_NETWORK],
    gatewayXrplSeed: data.GATEWAY_XRPL_SEED,
    sourceTag: data.SOURCE_TAG,
    rlusdIssuer: data.RLUSD_ISSUER,
    databaseUrl: data.DATABASE_URL,
    redisUrl: data.REDIS_URL,
    gatewayPort: data.GATEWAY_PORT,
    dashboardOrigin: data.DASHBOARD_ORIGIN,
    escrowEnabled: data.ESCROW_ENABLED ?? false,
  };
}
