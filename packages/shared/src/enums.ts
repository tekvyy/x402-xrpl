/**
 * Single source of truth for every domain enum used across the gateway,
 * SDKs, middleware, and dashboard. No package should redefine these or use
 * bare string literals for the concepts they model.
 */

/** How a caller pays for a metered request. */
export enum PaymentMode {
  /** One settled on-chain XRPL Payment per call. */
  PAY_PER_CALL = 'PAY_PER_CALL',
  /** Off-ledger PayChan claims drawn against a prepaid deposit. */
  PREPAID_CREDITS = 'PREPAID_CREDITS',
}

/** Settlement asset. */
export enum Asset {
  RLUSD = 'RLUSD',
  XRP = 'XRP',
}

/** How a seller wires the gateway into their API. */
export enum IntegrationMode {
  /** Gateway proxies the origin API; zero seller code change. */
  PROXY = 'PROXY',
  /** Seller prices their own routes via SDK middleware. */
  MIDDLEWARE = 'MIDDLEWARE',
}

/** Lifecycle of a single-use 402 challenge. */
export enum ChallengeStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  EXPIRED = 'EXPIRED',
  CONSUMED = 'CONSUMED',
}

/** Lifecycle of a payment channel. */
export enum ChannelStatus {
  OPEN = 'OPEN',
  SETTLING = 'SETTLING',
  CLOSED = 'CLOSED',
}

/** Outcome of a facilitator verify/settle operation. */
export enum SettleResult {
  VERIFIED = 'VERIFIED',
  SETTLED = 'SETTLED',
  REJECTED = 'REJECTED',
}

/** x402 wire header names (lowercased for HTTP). */
export enum X402Header {
  X_PAYMENT = 'x-payment',
  X_PAYMENT_RESPONSE = 'x-payment-response',
}

/** XRPL network selector. */
export enum XrplNetwork {
  MAINNET = 'MAINNET',
  TESTNET = 'TESTNET',
}
