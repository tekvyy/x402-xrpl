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

/**
 * Which payment modes a seller accepts. Distinct from {@link PaymentMode}:
 * every individual payment settles in exactly one mode, but a seller's setup
 * may allow either. Credits setups require XRP pricing (PayChan is XRP-native).
 */
export enum PaymentSetup {
  /** Traditional: one on-chain Payment per call (XRP or RLUSD). */
  PAY_PER_CALL = 'PAY_PER_CALL',
  /** Prepaid credits only: off-ledger PayChan claims (XRP). */
  PREPAID_CREDITS = 'PREPAID_CREDITS',
  /** Accept both pay-per-call and prepaid credits. */
  BOTH = 'BOTH',
}

/** Whether a seller with `setup` accepts a payment in `mode`. */
export function setupAllowsMode(setup: PaymentSetup, mode: PaymentMode): boolean {
  if (setup === PaymentSetup.BOTH) return true;
  return (setup as string) === (mode as string);
}

/** The payment modes a seller with `setup` accepts, credits first (fast path). */
export function setupModes(setup: PaymentSetup): PaymentMode[] {
  switch (setup) {
    case PaymentSetup.PAY_PER_CALL:
      return [PaymentMode.PAY_PER_CALL];
    case PaymentSetup.PREPAID_CREDITS:
      return [PaymentMode.PREPAID_CREDITS];
    case PaymentSetup.BOTH:
      return [PaymentMode.PREPAID_CREDITS, PaymentMode.PAY_PER_CALL];
  }
}

/** Settlement asset. */
export enum Asset {
  RLUSD = 'RLUSD',
  XRP = 'XRP',
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
