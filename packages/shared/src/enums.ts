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
 * x402 payment scheme identifiers — the on-wire names for the two payment
 * mechanisms. `PaymentMode` remains the internal/database vocabulary; these are
 * the spec-facing `scheme` strings carried in `accepts[]` and `X-PAYMENT`.
 */
export enum X402Scheme {
  /** Exact-amount on-ledger XRPL Payment, proven by tx hash (pay-per-call). */
  EXACT = 'exact',
  /** Off-ledger XRPL payment-channel signed claim (prepaid credits). */
  PAYCHAN = 'paychan',
}

const MODE_TO_SCHEME: Readonly<Record<PaymentMode, X402Scheme>> = Object.freeze({
  [PaymentMode.PAY_PER_CALL]: X402Scheme.EXACT,
  [PaymentMode.PREPAID_CREDITS]: X402Scheme.PAYCHAN,
});

const SCHEME_TO_MODE: Readonly<Record<X402Scheme, PaymentMode>> = Object.freeze({
  [X402Scheme.EXACT]: PaymentMode.PAY_PER_CALL,
  [X402Scheme.PAYCHAN]: PaymentMode.PREPAID_CREDITS,
});

/** The wire scheme identifier for an internal payment mode. */
export function schemeForMode(mode: PaymentMode): X402Scheme {
  return MODE_TO_SCHEME[mode];
}

/** The internal payment mode for a wire scheme identifier. */
export function modeForScheme(scheme: X402Scheme): PaymentMode {
  return SCHEME_TO_MODE[scheme];
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

/**
 * Lifecycle of a seller payout owed from a channel redemption. `SENDING` marks
 * an in-flight on-chain forward; a row stuck there means the process died
 * mid-payment and needs manual review (never auto-retried, to avoid double
 * paying).
 */
export enum PayoutStatus {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
  PAID = 'PAID',
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
