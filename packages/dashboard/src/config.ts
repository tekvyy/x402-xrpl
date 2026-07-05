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

/** Network id xrpl-connect expects ('mainnet' | 'testnet'). */
export const XRPL_CONNECT_NETWORK: 'mainnet' | 'testnet' =
  XRPL_NETWORK === XrplNetwork.MAINNET ? 'mainnet' : 'testnet';

/** Optional wallet-adapter credentials (adapters load only when present). */
export const XAMAN_API_KEY = import.meta.env.VITE_XAMAN_API_KEY ?? '';
export const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '';

/** localStorage key persisting the last-viewed seller id across reloads. */
export const SELLER_STORAGE_KEY = 'xrpl-x402.sellerId';

/** localStorage key holding the dashboard session (bearer) token. */
export const TOKEN_STORAGE_KEY = 'xrpl-x402.token';

/** Maximum number of live-feed rows retained in memory. */
export const LIVE_FEED_CAP = 50;
