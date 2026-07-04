/**
 * Runtime configuration resolved from Vite env vars, with safe defaults for
 * local development against the US-002/US-005 gateway.
 */
import { XrplNetwork } from '@app/shared';

/** Base URL of the gateway facilitator (no trailing slash). */
export const GATEWAY_URL = (import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8402').replace(
  /\/$/,
  '',
);

/** Network used to build explorer links for settled transactions. */
export const XRPL_NETWORK: XrplNetwork =
  import.meta.env.VITE_XRPL_NETWORK === XrplNetwork.MAINNET
    ? XrplNetwork.MAINNET
    : XrplNetwork.TESTNET;

/** localStorage key persisting the last-viewed seller id across reloads. */
export const SELLER_STORAGE_KEY = 'xrpl-x402.sellerId';

/** Maximum number of live-feed rows retained in memory. */
export const LIVE_FEED_CAP = 50;
