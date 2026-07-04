/**
 * Static, network-scoped constants. Runtime-configurable values live in
 * `env.ts`; only genuinely fixed protocol/domain constants belong here.
 */
import { XrplNetwork } from './enums.js';

/** How long a 402 challenge remains payable before it expires (ms). */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Currency code used for RLUSD issued-currency amounts on XRPL. */
export const RLUSD_CURRENCY_CODE = 'RLUSD';

/** Number of decimal places RLUSD is quoted to. */
export const RLUSD_DECIMALS = 2;

/** 1 XRP expressed in drops (XRPL's base unit). */
export const DROPS_PER_XRP = 1_000_000;

/** Default public XRPL WebSocket endpoints per network. */
export const XRPL_ENDPOINTS: Readonly<Record<XrplNetwork, string>> = Object.freeze({
  [XrplNetwork.MAINNET]: 'wss://xrplcluster.com',
  [XrplNetwork.TESTNET]: 'wss://s.altnet.rippletest.net:51233',
});

/** Explorer base URLs per network; append a tx hash to link a settlement. */
export const XRPL_EXPLORER_TX_URL: Readonly<Record<XrplNetwork, string>> = Object.freeze({
  [XrplNetwork.MAINNET]: 'https://livenet.xrpl.org/transactions/',
  [XrplNetwork.TESTNET]: 'https://testnet.xrpl.org/transactions/',
});

/** Build the explorer URL for a settled transaction on a given network. */
export function explorerTxUrl(network: XrplNetwork, txHash: string): string {
  return `${XRPL_EXPLORER_TX_URL[network]}${txHash}`;
}
