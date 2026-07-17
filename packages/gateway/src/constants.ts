/**
 * Gateway-internal policy constants (tunables): session lifetime, maintenance
 * cadence, payout retry budget, and rate-limit policies. Protocol/domain
 * constants shared across packages live in `@app/shared` — only values private
 * to the gateway process belong here.
 */
import type { RateLimitPolicy } from './util/rate-limit.js';

/** Dashboard session-token lifetime: 12 hours. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * How long a SETTLING lease may stand before the maintenance sweep treats it
 * as stranded by a crash and reconciles it against the ledger. Long enough
 * that a slow (ledger round-trip) in-flight redemption is never disturbed.
 */
export const SETTLING_LEASE_STALE_MS = 5 * 60 * 1000;

/** How often the maintenance sweep runs. */
export const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;

/** Expired challenges are kept this long for debugging before being pruned. */
export const CHALLENGE_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * How long a payout may sit SENDING before its outcome is resolved from the
 * ledger. Must comfortably exceed the Payment's LastLedgerSequence window
 * (a few minutes), so "hash not found" is proof the tx can never validate.
 */
export const PAYOUT_RESOLVE_AFTER_MS = 15 * 60 * 1000;

/** Send attempts per payout before it is parked for operator review. */
export const MAX_PAYOUT_ATTEMPTS = 5;

/** Cap on backlog-drain rounds per sweep (50 payouts per round). */
export const MAX_PAYOUT_ROUNDS = 20;

/** Sign-in challenge + verify endpoints: a human logging in, not a hot path. */
export const AUTH_RATE_LIMIT: RateLimitPolicy = { name: 'auth', limit: 30, windowMs: 60_000 };

/**
 * Facilitator challenge issuance: called by seller servers once per unpaid
 * request, so the per-IP budget is generous — it bounds abuse, not real load.
 */
export const CHALLENGE_RATE_LIMIT: RateLimitPolicy = {
  name: 'challenge',
  limit: 600,
  windowMs: 60_000,
};

/** Channel registration / escrow deposits: occasional setup actions. */
export const REGISTRATION_RATE_LIMIT: RateLimitPolicy = {
  name: 'register',
  limit: 60,
  windowMs: 60_000,
};
