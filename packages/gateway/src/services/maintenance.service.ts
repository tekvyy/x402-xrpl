/**
 * Periodic background maintenance. One sweep, four duties:
 *
 *  1. Reconcile channels stranded in SETTLING (crash or ambiguous submit
 *     between the on-chain claim and the watermark write) — the ledger is the
 *     source of truth for whether the claim landed.
 *  2. Resolve payouts stranded in SENDING from the ledger (validated → PAID,
 *     expired/failed → re-queued), then retry PENDING payouts, draining the
 *     backlog while progress is being made.
 *  3. Report payouts that exhausted their retry budget — money still owed
 *     that now needs an operator (e.g. the seller's address cannot receive).
 *  4. Prune expired, never-consumed challenge rows so unauthenticated
 *     challenge issuance cannot grow Postgres without bound.
 *
 * Every duty is idempotent and guarded by atomic status transitions, so an
 * overlapping or repeated sweep is harmless.
 */
import {
  deleteExpiredChallenges,
  listExhaustedChannelPayouts,
  listPendingChannelPayouts,
  listStaleSettlingChannels,
  listUnresolvedSendingPayouts,
} from '../db/repositories.js';
import {
  processChannelPayout,
  reconcileSettlingChannel,
  resolveSendingPayout,
} from './channel.service.js';
import type { RedeemDeps } from './channel.service.js';
import {
  CHALLENGE_RETENTION_MS,
  MAINTENANCE_INTERVAL_MS,
  MAX_PAYOUT_ATTEMPTS,
  MAX_PAYOUT_ROUNDS,
  PAYOUT_RESOLVE_AFTER_MS,
  SETTLING_LEASE_STALE_MS,
} from '../constants.js';

/** Run one maintenance sweep. Never throws — each duty logs its own failure. */
export async function runMaintenance(deps: RedeemDeps): Promise<void> {
  await reconcileStrandedChannels(deps);
  await resolveInFlightPayouts(deps);
  await retryPendingPayouts(deps);
  await reportExhaustedPayouts(deps);
  await pruneExpiredChallenges(deps);
}

async function reconcileStrandedChannels(deps: RedeemDeps): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - SETTLING_LEASE_STALE_MS);
    const stranded = await listStaleSettlingChannels(deps.pool, cutoff);
    for (const channel of stranded) {
      try {
        await reconcileSettlingChannel(deps, channel);
      } catch (err) {
        console.error(`[maintenance] failed to reconcile channel ${channel.channel_id}`, err);
      }
    }
  } catch (err) {
    console.error('[maintenance] stranded-channel scan failed', err);
  }
}

async function resolveInFlightPayouts(deps: RedeemDeps): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - PAYOUT_RESOLVE_AFTER_MS);
    const unresolved = await listUnresolvedSendingPayouts(deps.pool, cutoff);
    for (const payout of unresolved) {
      try {
        await resolveSendingPayout(deps, payout);
      } catch (err) {
        console.error(`[maintenance] failed to resolve payout ${payout.id}`, err);
      }
    }
  } catch (err) {
    console.error('[maintenance] in-flight payout scan failed', err);
  }
}

async function retryPendingPayouts(deps: RedeemDeps): Promise<void> {
  try {
    for (let round = 0; round < MAX_PAYOUT_ROUNDS; round += 1) {
      const pending = await listPendingChannelPayouts(deps.pool, MAX_PAYOUT_ATTEMPTS);
      if (pending.length === 0) return;
      let succeeded = 0;
      for (const payout of pending) {
        if (await processChannelPayout(deps, payout)) succeeded += 1;
      }
      // Keep draining a backlog while sends succeed; stop when nothing moves
      // (failed sends sit SENDING for ledger resolution, not instant retry).
      if (succeeded === 0) return;
    }
  } catch (err) {
    console.error('[maintenance] payout retry scan failed', err);
  }
}

async function reportExhaustedPayouts(deps: RedeemDeps): Promise<void> {
  try {
    const exhausted = await listExhaustedChannelPayouts(deps.pool, MAX_PAYOUT_ATTEMPTS);
    for (const payout of exhausted) {
      console.error(
        `[maintenance] payout ${payout.id} exhausted ${payout.attempts} attempts ` +
          `(${payout.amount} XRP to ${payout.destination}); needs operator resolution`,
      );
    }
  } catch (err) {
    console.error('[maintenance] exhausted-payout scan failed', err);
  }
}

async function pruneExpiredChallenges(deps: RedeemDeps): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - CHALLENGE_RETENTION_MS);
    const removed = await deleteExpiredChallenges(deps.pool, cutoff);
    if (removed > 0) console.info(`[maintenance] pruned ${removed} expired challenges`);
  } catch (err) {
    console.error('[maintenance] challenge prune failed', err);
  }
}

/**
 * Start the recurring sweep (also running one immediately) and return a stop
 * function for graceful shutdown. The timer is unref'd so it never keeps the
 * process alive on its own.
 */
export function startMaintenance(deps: RedeemDeps): () => void {
  void runMaintenance(deps);
  const timer = setInterval(() => void runMaintenance(deps), MAINTENANCE_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
