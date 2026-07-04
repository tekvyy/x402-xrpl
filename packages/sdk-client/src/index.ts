/**
 * Client SDK: wallet, `x402fetch`, trustline, and PayChan helpers.
 * Implemented in US-003/US-004. Skeleton proves the shared contract resolves.
 */
import { X402Header } from '@app/shared';

/** Header the SDK attaches when retrying a paid request. */
export const PAYMENT_HEADER: X402Header = X402Header.X_PAYMENT;
