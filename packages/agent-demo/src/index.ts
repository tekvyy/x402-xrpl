/**
 * AI agent demo: opens a channel, makes metered calls, then one pay-per-call.
 * Implemented in US-007. Skeleton proves the shared contract resolves.
 */
import { PaymentMode } from '@app/shared';
import { PAYMENT_HEADER } from '@app/sdk-client';

/** The agent's fast path uses prepaid credits over a payment channel. */
export const AGENT_PRIMARY_MODE: PaymentMode = PaymentMode.PREPAID_CREDITS;

export { PAYMENT_HEADER };
