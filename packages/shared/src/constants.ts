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

/**
 * x402 v1 network identifiers for XRPL, following the spec's naming style
 * (`base` / `base-sepolia`). These are the `network` values carried in
 * `accepts[]`, `X-PAYMENT`, and `X-PAYMENT-RESPONSE`.
 */
export const X402_NETWORKS = ['xrpl', 'xrpl-testnet'] as const;
export type X402Network = (typeof X402_NETWORKS)[number];

const X402_NETWORK_IDS: Readonly<Record<XrplNetwork, X402Network>> = Object.freeze({
  [XrplNetwork.MAINNET]: 'xrpl',
  [XrplNetwork.TESTNET]: 'xrpl-testnet',
});

/** The x402 wire `network` identifier for an XRPL network selector. */
export function x402NetworkId(network: XrplNetwork): X402Network {
  return X402_NETWORK_IDS[network];
}

/**
 * CAIP-2 chain identifiers per network, for the future x402 v2 transport
 * (v2 replaces the v1 network names above with CAIP-2 ids). Unused on the v1
 * wire; kept here so the mapping lives in one place when v2 lands.
 */
export const X402_CAIP2_IDS: Readonly<Record<XrplNetwork, string>> = Object.freeze({
  [XrplNetwork.MAINNET]: 'xrpl:0',
  [XrplNetwork.TESTNET]: 'xrpl:1',
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

/** Largest value an XRPL source tag / u32 field can hold. */
export const MAX_UINT32 = 4_294_967_295;

/**
 * Minimum PayChan `SettleDelay` (seconds) the gateway will register. A channel
 * owner can only force-close and reclaim the unspent deposit at
 * `close_time + SettleDelay`, so this is the redemption runway the gateway is
 * guaranteed even if the owner sets `Expiration` to the earliest allowed value.
 * A tiny SettleDelay would let a client spend credits off-ledger, force-close,
 * and reclaim the deposit before the gateway can redeem — so we refuse it.
 */
export const MIN_CHANNEL_SETTLE_DELAY_SEC = 60 * 60;

/**
 * Refuse to register — and stop honoring off-ledger claims against — a channel
 * within this many seconds of its immutable `CancelAfter` expiry, so the gateway
 * always has time to redeem what was already delivered before the channel can be
 * cancelled and the deposit returned to the payer.
 */
export const CHANNEL_REDEEM_BUFFER_SEC = 15 * 60;

/**
 * Auto-redeem a channel on chain once this fraction of its deposit has been
 * spent off-ledger, so delivered value is pulled on chain well before the
 * channel nears exhaustion or expiry.
 */
export const CHANNEL_AUTO_REDEEM_RATIO = 0.8;

/** XRPL classic address: `r` + 24–34 base58 (Ripple alphabet) characters. */
export const XRPL_CLASSIC_ADDRESS_PATTERN = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/** Whether `value` looks like a well-formed XRPL classic address. */
export function isClassicAddress(value: string): boolean {
  return XRPL_CLASSIC_ADDRESS_PATTERN.test(value);
}
