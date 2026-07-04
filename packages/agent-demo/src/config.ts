/**
 * Runtime configuration for the agent demo, read from the environment. Kept
 * local (rather than reusing the gateway's `env.ts`) because the agent is a
 * standalone client with its own, smaller set of knobs.
 */
import { Asset, XrplNetwork, XRPL_ENDPOINTS } from '@app/shared';

export interface AgentConfig {
  /** Facilitator / gateway base URL (no trailing slash). */
  gatewayUrl: string;
  /** The registered seller the agent buys from. */
  sellerId: string;
  /** XRPL wallet seed the agent pays from. */
  seed: string;
  /** Resource path under the seller's gateway URL (leading slash). */
  resource: string;
  /** Channel deposit in XRP (human units). */
  depositXrp: string;
  /** How many off-ledger metered calls to make over the channel. */
  meteredCalls: number;
  /** Team source tag stamped on every on-chain tx. */
  sourceTag: number;
  /** XRPL WebSocket endpoint. */
  xrplEndpoint: string;
}

/** The channel/credits path is XRP-native, so the demo transacts in XRP. */
export const DEMO_ASSET: Asset = Asset.XRP;

function required(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.length === 0) {
    throw new Error(`missing required env var ${key}`);
  }
  return value;
}

function parseNetwork(value: string | undefined): XrplNetwork {
  if (value === XrplNetwork.MAINNET || value === XrplNetwork.TESTNET) return value;
  return XrplNetwork.TESTNET;
}

/** Load and validate the agent demo configuration from `process.env`. */
export function loadAgentConfig(): AgentConfig {
  const network = parseNetwork(process.env.XRPL_NETWORK);
  return {
    gatewayUrl: required('GATEWAY_URL').replace(/\/+$/, ''),
    sellerId: required('SELLER_ID'),
    seed: required('AGENT_SEED'),
    resource: `/${(process.env.RESOURCE ?? 'data').replace(/^\/+/, '')}`,
    depositXrp: process.env.CHANNEL_DEPOSIT_XRP ?? '1',
    meteredCalls: Number.parseInt(process.env.METERED_CALLS ?? '20', 10),
    sourceTag: Number.parseInt(required('SOURCE_TAG'), 10),
    xrplEndpoint: process.env.XRPL_ENDPOINT ?? XRPL_ENDPOINTS[network],
  };
}
