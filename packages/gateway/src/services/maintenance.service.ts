/**
 * Periodic background maintenance. One sweep, five duties:
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
 *  5. Prune audit-log rows past their retention window, for the same reason.
 *
 * Every duty is idempotent and guarded by atomic status transitions, so an
 * overlapping or repeated sweep is harmless.
 */
import {
  deleteExpiredChallenges,
  deleteOldAuditLogs,
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
import type { GatewayDeps } from '../deps.js';
import type { XrplNetwork } from '@app/shared';
import {
  AUDIT_LOG_RETENTION_MS,
  CHALLENGE_RETENTION_MS,
  MAINTENANCE_INTERVAL_MS,
  MAX_PAYOUT_ATTEMPTS,
  MAX_PAYOUT_ROUNDS,
  PAYOUT_RESOLVE_AFTER_MS,
  SETTLING_LEASE_STALE_MS,
} from '../constants.js';

/**
 * Maintenance sweeps every network at once, so it takes the whole registry and
 * resolves each row's network individually rather than being scoped up front.
 */
export type MaintenanceDeps = Pick<GatewayDeps, 'pool' | 'xrplRegistry' | 'env'>;

/**
 * Scope `deps` to the network a row belongs to, or `null` when that network is
 * no longer enabled.
 *
 * Returning null rather than throwing matters: if a row references a network
 * this build no longer serves while channels on it still hold unredeemed value,
 * the whole sweep must not die (which would strand every *other* network's
 * payouts too). Callers log loudly instead — this is real money owed.
 */
function scopeTo(deps: MaintenanceDeps, network: XrplNetwork): RedeemDeps | null {
  if (!deps.xrplRegistry.has(network)) return null;
  return { pool: deps.pool, env: deps.env, xrpl: deps.xrplRegistry.for(network), network };
}

/** Run one maintenance sweep. Never throws — each duty logs its own failure. */
export async function runMaintenance(deps: MaintenanceDeps): Promise<void> {
  await reconcileStrandedChannels(deps);
  await resolveInFlightPayouts(deps);
  await retryPendingPayouts(deps);
  await reportExhaustedPayouts(deps);
  await pruneExpiredChallenges(deps);
  await pruneOldAuditLogs(deps);
}

async function reconcileStrandedChannels(deps: MaintenanceDeps): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - SETTLING_LEASE_STALE_MS);
    const stranded = await listStaleSettlingChannels(deps.pool, cutoff);
    for (const channel of stranded) {
      const scoped = scopeTo(deps, channel.network);
      if (!scoped) {
        console.error(
          `[maintenance] channel ${channel.channel_id} is on disabled network ` +
            `${channel.network}; cannot reconcile until it is re-enabled`,
        );
        continue;
      }
      try {
        await reconcileSettlingChannel(scoped, channel);
      } catch (err) {
        console.error(`[maintenance] failed to reconcile channel ${channel.channel_id}`, err);
      }
    }
  } catch (err) {
    console.error('[maintenance] stranded-channel scan failed', err);
  }
}

async function resolveInFlightPayouts(deps: MaintenanceDeps): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - PAYOUT_RESOLVE_AFTER_MS);
    const unresolved = await listUnresolvedSendingPayouts(deps.pool, cutoff);
    for (const payout of unresolved) {
      const scoped = scopeTo(deps, payout.network);
      if (!scoped) {
        console.error(
          `[maintenance] payout ${payout.id} is on disabled network ${payout.network}; ` +
            'cannot resolve until it is re-enabled',
        );
        continue;
      }
      try {
        await resolveSendingPayout(scoped, payout);
      } catch (err) {
        console.error(`[maintenance] failed to resolve payout ${payout.id}`, err);
      }
    }
  } catch (err) {
    console.error('[maintenance] in-flight payout scan failed', err);
  }
}

async function retryPendingPayouts(deps: MaintenanceDeps): Promise<void> {
  try {
    for (let round = 0; round < MAX_PAYOUT_ROUNDS; round += 1) {
      const pending = await listPendingChannelPayouts(deps.pool, MAX_PAYOUT_ATTEMPTS);
      if (pending.length === 0) return;
      let succeeded = 0;
      for (const payout of pending) {
        const scoped = scopeTo(deps, payout.network);
        if (!scoped) {
          console.error(
            `[maintenance] payout ${payout.id} is on disabled network ${payout.network}; ` +
              'cannot pay out until it is re-enabled',
          );
          continue;
        }
        if (await processChannelPayout(scoped, payout)) succeeded += 1;
      }
      // Keep draining a backlog while sends succeed; stop when nothing moves
      // (failed sends sit SENDING for ledger resolution, not instant retry).
      if (succeeded === 0) return;
    }
  } catch (err) {
    console.error('[maintenance] payout retry scan failed', err);
  }
}

async function reportExhaustedPayouts(deps: MaintenanceDeps): Promise<void> {
  try {
    const exhausted = await listExhaustedChannelPayouts(deps.pool, MAX_PAYOUT_ATTEMPTS);
    for (const payout of exhausted) {
      console.error(
        `[maintenance] payout ${payout.id} exhausted ${payout.attempts} attempts ` +
          `(${payout.amount} XRP to ${payout.destination} on ${payout.network}); ` +
          'needs operator resolution',
      );
    }
  } catch (err) {
    console.error('[maintenance] exhausted-payout scan failed', err);
  }
}

async function pruneExpiredChallenges(deps: MaintenanceDeps): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - CHALLENGE_RETENTION_MS);
    const removed = await deleteExpiredChallenges(deps.pool, cutoff);
    if (removed > 0) console.info(`[maintenance] pruned ${removed} expired challenges`);
  } catch (err) {
    console.error('[maintenance] challenge prune failed', err);
  }
}

async function pruneOldAuditLogs(deps: MaintenanceDeps): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - AUDIT_LOG_RETENTION_MS);
    const removed = await deleteOldAuditLogs(deps.pool, cutoff);
    if (removed > 0) console.info(`[maintenance] pruned ${removed} old audit logs`);
  } catch (err) {
    console.error('[maintenance] audit-log prune failed', err);
  }
}

/**
 * Start the recurring sweep (also running one immediately) and return a stop
 * function for graceful shutdown. The timer is unref'd so it never keeps the
 * process alive on its own.
 */
export function startMaintenance(deps: MaintenanceDeps): () => void {
  void runMaintenance(deps);
  const timer = setInterval(() => void runMaintenance(deps), MAINTENANCE_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
