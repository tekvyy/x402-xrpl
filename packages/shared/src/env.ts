/**
 * Typed, validated runtime configuration. `loadEnv` throws a clear aggregated
 * error listing every missing/invalid key so misconfiguration fails fast at
 * boot rather than deep inside a request handler.
 *
 * The gateway serves one or more XRPL networks at once. `ENABLED_NETWORKS`
 * selects them and each one carries its own wallet, endpoint, and RLUSD issuer
 * — a network is only configurable if it is enabled, so a testnet-only
 * deployment never needs mainnet keys or funds.
 */
import { z } from 'zod';
import { XrplNetwork } from './enums.js';
import { isClassicAddress, RLUSD_ISSUERS, XRPL_ENDPOINTS } from './constants.js';

const EnvSchema = z.object({
  // Comma-separated networks this deployment serves, e.g. "TESTNET" or
  // "TESTNET,MAINNET". Each entry needs a gateway seed: the shared
  // GATEWAY_XRPL_SEED, or a per-network GATEWAY_XRPL_SEED_<NETWORK> override.
  ENABLED_NETWORKS: z.string().optional(),
  // Secret used to sign stateless dashboard session (JWT-style HMAC) tokens.
  // Require at least 256 bits when generated as hexadecimal (64 chars) and a
  // meaningful floor for other encodings; operators should use a CSPRNG.
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  // The team source tag stamped on every gateway-submitted transaction. Shared
  // across networks: it identifies the operator, not the ledger.
  SOURCE_TAG: z.coerce.number().int().nonnegative(),
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
  // Optional: platform fee in basis points (1% = 100 bps) taken on the PayChan
  // credits path. Prepaid channels always pay the gateway, which redeems on
  // chain and forwards the seller's cut minus this fee. Max 10000 (100%).
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).optional(),
  // Optional: honor X-Forwarded-For from a fronting reverse proxy so per-IP
  // rate limits key on the real client, not the proxy. Only enable when the
  // gateway is actually behind a trusted proxy.
  TRUST_PROXY: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((value) => value === 'true' || value === '1'),
  // Optional: comma-separated XRPL classic addresses granted admin access
  // (audit-log endpoints). Admins sign in through the normal wallet auth flow;
  // membership in this list is what elevates the session. Empty = no admins.
  ADMIN_ADDRESSES: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((address) => address.trim())
        .filter((address) => address.length > 0),
    )
    .refine((addresses) => addresses.every(isClassicAddress), {
      message: 'ADMIN_ADDRESSES must be comma-separated XRPL classic addresses',
    }),
});

/** Everything needed to transact on one XRPL network. */
export interface NetworkConfig {
  network: XrplNetwork;
  /** WebSocket endpoint, defaulted from the network when not overridden. */
  endpoint: string;
  /** Family seed for this network's gateway wallet. */
  gatewayXrplSeed: string;
  /** RLUSD issuing account on this network. */
  rlusdIssuer: string;
}

/** Fully resolved config. */
export interface AppEnv {
  /** Networks this deployment serves, in `ENABLED_NETWORKS` order. Never empty. */
  enabledNetworks: XrplNetwork[];
  /** Per-network XRPL config. Only enabled networks are present. */
  networks: Partial<Readonly<Record<XrplNetwork, NetworkConfig>>>;
  /** Secret for signing dashboard session tokens. */
  authSecret: string;
  sourceTag: number;
  databaseUrl: string;
  redisUrl: string;
  gatewayPort: number;
  dashboardOrigin: string;
  /** Whether the config-gated escrow-credits fallback is enabled (US-004). */
  escrowEnabled: boolean;
  /** Platform fee in basis points taken on the PayChan credits path (0 = off). */
  platformFeeBps: number;
  /** Whether to trust X-Forwarded-For from a fronting reverse proxy. */
  trustProxy: boolean;
  /** XRPL addresses whose sessions get admin access (audit log); empty = none. */
  adminAddresses: string[];
}

/** Whether `env` serves `network`. */
export function isNetworkEnabled(env: AppEnv, network: XrplNetwork): boolean {
  return env.networks[network] !== undefined;
}

/**
 * Resolve the config for `network`.
 * @throws Error when the network is not enabled — callers must gate on
 * {@link isNetworkEnabled} first, so reaching here is a programming error
 * rather than bad input.
 */
export function networkConfig(env: AppEnv, network: XrplNetwork): NetworkConfig {
  const config = env.networks[network];
  if (!config) {
    throw new Error(
      `network ${network} is not enabled on this gateway ` +
        `(ENABLED_NETWORKS=${env.enabledNetworks.join(',')})`,
    );
  }
  return config;
}

/** Parse `ENABLED_NETWORKS`, collecting errors rather than throwing on the first. */
function parseEnabledNetworks(raw: string | undefined, errors: string[]): XrplNetwork[] {
  const names = (raw ?? XrplNetwork.TESTNET)
    .split(',')
    .map((name) => name.trim().toUpperCase())
    .filter((name) => name.length > 0);

  if (names.length === 0) {
    errors.push('  - ENABLED_NETWORKS: must name at least one network');
    return [];
  }

  const valid = Object.values(XrplNetwork) as string[];
  const networks: XrplNetwork[] = [];
  for (const name of names) {
    if (!valid.includes(name)) {
      errors.push(
        `  - ENABLED_NETWORKS: unknown network "${name}" (expected ${valid.join(' or ')})`,
      );
      continue;
    }
    const network = name as XrplNetwork;
    if (networks.includes(network)) {
      errors.push(`  - ENABLED_NETWORKS: ${network} listed more than once`);
      continue;
    }
    networks.push(network);
  }
  return networks;
}

/**
 * Resolve per-network XRPL config, collecting errors.
 *
 * The gateway seed for a network is `GATEWAY_XRPL_SEED_<NETWORK>` if set, else
 * the shared `GATEWAY_XRPL_SEED`. A seed derives the same address on every
 * network, so one shared seed is enough for a single-network deployment (or for
 * running several networks off the same wallet, funded on each). The per-network
 * override only exists for the case where you want a *different* wallet per
 * network. The endpoint and RLUSD issuer fall back to the network's well-known
 * defaults.
 */
function resolveNetworks(
  source: NodeJS.ProcessEnv,
  enabled: XrplNetwork[],
  errors: string[],
): Partial<Record<XrplNetwork, NetworkConfig>> {
  const networks: Partial<Record<XrplNetwork, NetworkConfig>> = {};
  const sharedSeed = source.GATEWAY_XRPL_SEED;

  for (const network of enabled) {
    const seed = source[`GATEWAY_XRPL_SEED_${network}`] || sharedSeed;
    if (seed === undefined || seed.length === 0) {
      errors.push(
        `  - GATEWAY_XRPL_SEED (or GATEWAY_XRPL_SEED_${network}): ` +
          `required because ${network} is in ENABLED_NETWORKS`,
      );
      continue;
    }

    const issuer = source[`RLUSD_ISSUER_${network}`] ?? RLUSD_ISSUERS[network];
    if (!isClassicAddress(issuer)) {
      errors.push(`  - RLUSD_ISSUER_${network}: must be a valid XRPL classic address`);
      continue;
    }

    networks[network] = {
      network,
      endpoint: source[`XRPL_ENDPOINT_${network}`] ?? XRPL_ENDPOINTS[network],
      gatewayXrplSeed: seed,
      rlusdIssuer: issuer,
    };
  }

  return networks;
}

/**
 * Validate `source` (defaults to `process.env`) and return typed config.
 * @throws Error with a readable, multi-line message when any key is invalid.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = EnvSchema.safeParse(source);
  const errors: string[] = parsed.success
    ? []
    : parsed.error.issues.map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      );

  const enabledNetworks = parseEnabledNetworks(source.ENABLED_NETWORKS, errors);
  const networks = resolveNetworks(source, enabledNetworks, errors);

  if (errors.length > 0 || !parsed.success) {
    throw new Error(`Invalid environment configuration:\n${errors.join('\n')}`);
  }

  const data = parsed.data;
  return {
    enabledNetworks,
    networks,
    authSecret: data.AUTH_SECRET,
    sourceTag: data.SOURCE_TAG,
    databaseUrl: data.DATABASE_URL,
    redisUrl: data.REDIS_URL,
    gatewayPort: data.GATEWAY_PORT,
    dashboardOrigin: data.DASHBOARD_ORIGIN,
    escrowEnabled: data.ESCROW_ENABLED ?? false,
    platformFeeBps: data.PLATFORM_FEE_BPS ?? 0,
    trustProxy: data.TRUST_PROXY ?? false,
    adminAddresses: data.ADMIN_ADDRESSES,
  };
}
