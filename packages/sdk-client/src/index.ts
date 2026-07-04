/**
 * Client SDK public surface: wallet loading, RLUSD trustline management,
 * pay-per-call payment building, and the `x402fetch` 402→pay→retry loop.
 * PayChan credit helpers arrive in US-004.
 */
import { X402Header } from '@app/shared';

export { loadWallet, createClient, ensureConnected } from './wallet.js';
export { ensureTrustline, DEFAULT_RLUSD_TRUST_LIMIT } from './trustline.js';
export { payChallenge } from './payment.js';
export type { PayChallengeParams } from './payment.js';
export { openChannel, signClaim, hasCredits, DEFAULT_SETTLE_DELAY } from './channel.js';
export type { OpenChannelParams, ChannelHandle } from './channel.js';
export { currencyToHex, rlusdCurrency } from './currency.js';
export {
  x402fetch,
  readSettlement,
  MaxAmountExceededError,
} from './x402fetch.js';
export type { X402Config, X402FetchInit } from './x402fetch.js';

/** Header the SDK attaches when retrying a paid request. */
export const PAYMENT_HEADER: X402Header = X402Header.X_PAYMENT;
