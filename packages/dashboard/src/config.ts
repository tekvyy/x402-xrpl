/**
 * Runtime configuration. Only the gateway URL and optional wallet-adapter keys
 * come from build-time env; the XRPL network is chosen in the UI at runtime and
 * lives in `network.ts`, so there is no network env var.
 */

/** Base URL of the gateway facilitator (no trailing slash). */
export const GATEWAY_URL = (import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8402').replace(
  /\/$/,
  '',
);

/** Public source repository. The whole gateway is open source and self-hostable. */
export const REPO_URL = 'https://github.com/tekvyy/x402-xrpl';

/** Optional wallet-adapter credentials (adapters load only when present). */
export const XAMAN_API_KEY = import.meta.env.VITE_XAMAN_API_KEY ?? '';
export const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '';

/** localStorage key persisting the last-viewed seller id across reloads. */
export const SELLER_STORAGE_KEY = 'xrpl-x402.sellerId';

/** localStorage key persisting the user's selected XRPL network across reloads. */
export const NETWORK_STORAGE_KEY = 'xrpl-x402.network';

/** localStorage key holding the dashboard session (bearer) token. */
export const TOKEN_STORAGE_KEY = 'xrpl-x402.token';

/** Maximum number of live-feed rows retained in memory. */
export const LIVE_FEED_CAP = 50;
