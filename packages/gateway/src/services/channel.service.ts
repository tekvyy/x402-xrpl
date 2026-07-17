/**
 * PayChan channel lifecycle on the gateway side: register an on-ledger channel
 * as a prepaid-credits source, and redeem accumulated off-ledger claims on
 * chain. Registration trusts the *ledger* (not the client) for the channel's
 * destination, deposit, and signing public key.
 */
import { dropsToXrp, rippleTimeToUnixTime, xrpToDrops } from 'xrpl';
import {
  Asset,
  CHANNEL_AUTO_REDEEM_RATIO,
  CHANNEL_REDEEM_BUFFER_SEC,
  ChannelStatus,
  MIN_CHANNEL_SETTLE_DELAY_SEC,
  PaymentMode,
  SettleResult,
  explorerTxUrl,
  setupAllowsMode,
} from '@app/shared';
import type { AppEnv } from '@app/shared';
import {
  abandonChannelRedemption,
  beginChannelRedemption,
  claimChannelPayout,
  completeChannelRedemption,
  createChannel,
  getChannelByChannelId,
  getSeller,
  insertChannelPayout,
  insertPayment,
  markChannelPayoutPaid,
  releaseChannelPayout,
  setChannelPayoutTxHash,
  setChannelStatus,
} from '../db/repositories.js';
import type { ChannelPayoutRow, ChannelRow } from '../db/types.js';
import { decimalGte } from '../util/decimal.js';
import { unwrapTxResult } from './verify.service.js';
import { rippledErrorCode } from './xrpl.service.js';
import { channelDestinationFor } from '../deps.js';
import type { GatewayDeps } from '../deps.js';
import { SETTLING_LEASE_STALE_MS } from '../constants.js';

/** Whether a SETTLING lease is old enough to be reconciled safely. */
export function isStaleSettlingLease(channel: ChannelRow, now: number = Date.now()): boolean {
  if (channel.status !== ChannelStatus.SETTLING) return false;
  return channel.settling_since == null || channel.settling_since.getTime() < now - SETTLING_LEASE_STALE_MS;
}

export interface RegisterChannelInput {
  channelId: string;
  sellerId: string;
  walletAddress: string;
}

export type RegisterChannelResult =
  | { ok: true; channel: ChannelRow }
  | { ok: false; reason: string };

/**
 * Register a payment channel as a prepaid-credits source for a seller. Verifies
 * the channel on-ledger (destination, deposit, public key), rejects a deposit
 * below one call price, and is idempotent on `channelId`.
 */
export async function registerChannel(
  deps: GatewayDeps,
  input: RegisterChannelInput,
): Promise<RegisterChannelResult> {
  const existing = await getChannelByChannelId(deps.pool, input.channelId);
  if (existing) {
    if (existing.seller_id !== input.sellerId || existing.wallet_address !== input.walletAddress) {
      return { ok: false, reason: 'channel is already registered to a different seller or wallet' };
    }
    return { ok: true, channel: existing };
  }

  const seller = await getSeller(deps.pool, input.sellerId);
  if (!seller) return { ok: false, reason: 'seller not found' };
  if (!setupAllowsMode(seller.payment_mode, PaymentMode.PREPAID_CREDITS)) {
    return { ok: false, reason: 'seller does not accept prepaid credits (pay-per-call only)' };
  }
  if (seller.price_asset !== Asset.XRP) {
    return { ok: false, reason: 'PayChan credits require an XRP-priced seller' };
  }

  let node;
  try {
    node = await deps.xrpl.getPaymentChannel(input.channelId);
  } catch {
    return { ok: false, reason: 'could not read the channel from the ledger; try again' };
  }
  if (!node) return { ok: false, reason: 'payment channel not found on ledger' };
  // With a platform fee the channel must pay the gateway (which forwards the
  // seller's cut); with no fee it must pay the seller directly.
  const expectedDestination = channelDestinationFor(deps, seller);
  if (node.Destination !== expectedDestination) {
    return { ok: false, reason: 'channel destination does not match the expected payee' };
  }
  if (node.Account !== input.walletAddress) {
    return { ok: false, reason: 'channel owner does not match the wallet' };
  }
  if (node.Balance !== '0') {
    return { ok: false, reason: 'channel has already redeemed funds and cannot be registered' };
  }
  if (node.Expiration != null) {
    return { ok: false, reason: 'channel has a pending expiration and cannot be registered' };
  }

  const depositHuman = String(dropsToXrp(node.Amount));
  if (!decimalGte(depositHuman, seller.price_amount)) {
    return { ok: false, reason: 'deposit is below one call price' };
  }

  // Expiry guard: the gateway delivers value off-ledger before redeeming on
  // chain, so it must be able to redeem before the owner can force-close and
  // reclaim the deposit. A SettleDelay below the minimum, or a CancelAfter too
  // near, would let a client spend credits and then reclaim them before redeem.
  if (node.SettleDelay < MIN_CHANNEL_SETTLE_DELAY_SEC) {
    return {
      ok: false,
      reason: `channel SettleDelay must be at least ${MIN_CHANNEL_SETTLE_DELAY_SEC}s so the gateway can redeem before the channel can be closed`,
    };
  }
  const cancelAfter =
    node.CancelAfter != null ? new Date(rippleTimeToUnixTime(node.CancelAfter)) : null;
  if (cancelAfter && cancelAfter.getTime() - Date.now() <= MIN_CHANNEL_SETTLE_DELAY_SEC * 1000) {
    return { ok: false, reason: 'channel CancelAfter is too soon to safely redeem credits' };
  }

  const channel = await createChannel(deps.pool, {
    channelId: input.channelId,
    walletAddress: input.walletAddress,
    sellerId: seller.id,
    depositAmount: depositHuman,
    asset: Asset.XRP,
    creditsTotal: depositHuman,
    publicKey: node.PublicKey,
    settleDelay: node.SettleDelay,
    cancelAfter,
  });
  return { ok: true, channel };
}

export interface RedeemChannelResult {
  result: SettleResult;
  reason?: string;
  txHash?: string;
  explorerUrl?: string;
  /** Cumulative amount redeemed, in the human unit. */
  amount?: string;
}

/**
 * Redeem a channel's accumulated claims by submitting a source-tagged
 * `PaymentChannelClaim`, then record the on-chain settlement as a payment. Only
 * the aggregate claim is settled on chain; the per-call credit spends were
 * already recorded off-ledger as usage events.
 */
/** The subset of {@link GatewayDeps} the redeem path needs (no redis / base URL). */
export type RedeemDeps = Pick<GatewayDeps, 'pool' | 'xrpl' | 'env'>;

export async function redeemChannel(
  deps: RedeemDeps,
  channelId: string,
): Promise<RedeemChannelResult> {
  let channel = await beginChannelRedemption(deps.pool, channelId);
  if (!channel) {
    const known = await getChannelByChannelId(deps.pool, channelId);
    if (!known) return { result: SettleResult.REJECTED, reason: 'unknown channel' };
    // A crash between the on-chain claim and the watermark write leaves the
    // lease held forever; reconcile against the ledger, then retry once. A
    // reconcile failure (node down, unexplained ledger state) must surface as
    // a rejection with a reason, not a 500 — the sweep will retry it anyway.
    if (isStaleSettlingLease(known)) {
      try {
        await reconcileSettlingChannel(deps, known);
      } catch (err) {
        console.error(`[channel] reconcile of ${channelId} failed during redeem`, err);
        return {
          result: SettleResult.REJECTED,
          reason: 'channel reconciliation failed; try again later',
        };
      }
      channel = await beginChannelRedemption(deps.pool, channelId);
    }
    if (!channel) {
      return {
        result: SettleResult.REJECTED,
        reason: 'no outstanding claim to redeem or redemption already in progress',
      };
    }
  }
  if (!channel.last_claim_signature || !channel.public_key) {
    await abandonChannelRedemption(deps.pool, channelId);
    return { result: SettleResult.REJECTED, reason: 'no claims to redeem' };
  }

  const balanceDrops = xrpToDrops(channel.credits_used);
  const previouslyRedeemedDrops = xrpToDrops(channel.redeemed_amount);
  const deltaDrops = (BigInt(balanceDrops) - BigInt(previouslyRedeemedDrops)).toString();
  let ledgerChannel;
  try {
    ledgerChannel = await deps.xrpl.getPaymentChannel(channelId);
  } catch {
    // Nothing has been broadcast yet, so releasing the lease is safe.
    await abandonChannelRedemption(deps.pool, channelId);
    return {
      result: SettleResult.REJECTED,
      reason: 'could not read the channel from the ledger; try again',
    };
  }
  if (
    !ledgerChannel ||
    ledgerChannel.Destination !== deps.xrpl.address() ||
    ledgerChannel.Account !== channel.wallet_address ||
    ledgerChannel.PublicKey !== channel.public_key ||
    ledgerChannel.Balance !== previouslyRedeemedDrops
  ) {
    await abandonChannelRedemption(deps.pool, channelId);
    return {
      result: SettleResult.REJECTED,
      reason: 'channel ledger state diverged; reconciliation is required before redemption',
    };
  }
  // If this submit throws, the lease is deliberately NOT released:
  // `submitAndWait` can throw (disconnect while polling) after the claim was
  // broadcast, and it may still validate. The channel stays SETTLING — claims
  // keep flowing (applyChannelClaim allows SETTLING) — and the maintenance
  // sweep reconciles it from the ledger: claim landed → watermark advances;
  // claim expired → lease released.
  const txHash = await deps.xrpl.redeemChannel({
    channelId,
    balanceDrops,
    signature: channel.last_claim_signature,
    publicKey: channel.public_key,
  });

  // The channel pays the gateway, so the seller is owed only the newly redeemed
  // delta (both XRPL PaymentChannelClaim fields are cumulative). Persist the
  // watermark, the payment record, and the owed cut in ONE transaction: if the
  // later on-chain forward fails, the debt survives for the maintenance sweep
  // instead of silently underpaying the seller.
  const { sellerCutDrops, feeDrops } = splitFeeDrops(deltaDrops, deps.env.platformFeeBps);
  const seller = await getSeller(deps.pool, channel.seller_id);
  const client = await deps.pool.connect();
  let payout: ChannelPayoutRow | null = null;
  try {
    await client.query('BEGIN');
    const completed = await completeChannelRedemption(client, channelId, channel.credits_used);
    if (!completed) {
      // Leave the channel SETTLING; the maintenance sweep reconciles it from
      // the ledger (the on-chain claim above is already durable).
      throw new Error(`redeemed channel ${channelId} but could not persist its ledger watermark`);
    }
    await insertPayment(client, {
      challengeId: null,
      walletAddress: channel.wallet_address,
      mode: PaymentMode.PREPAID_CREDITS,
      amount: String(dropsToXrp(deltaDrops)),
      asset: channel.asset,
      txHash,
      sourceTag: deps.env.sourceTag,
      platformFee: String(dropsToXrp(feeDrops)),
    });
    if (seller && BigInt(sellerCutDrops) > 0n) {
      payout = await insertChannelPayout(client, {
        channelId,
        sellerId: seller.id,
        destination: seller.pay_to_address,
        amount: String(dropsToXrp(sellerCutDrops)),
        redeemTxHash: txHash,
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Forward the seller's cut now, best-effort: on failure the payout row stays
  // PENDING and the maintenance sweep retries it.
  if (payout) await processChannelPayout(deps, payout);

  return {
    result: SettleResult.SETTLED,
    txHash,
    explorerUrl: buildExplorerUrl(deps.env, txHash),
    amount: String(dropsToXrp(deltaDrops)),
  };
}

/**
 * Forward one owed seller cut on chain. Claims the payout (PENDING → SENDING)
 * so concurrent sweeps never double-pay, persists the Payment's hash BEFORE
 * submitting, then submits and records the result.
 *
 * On a submission error the payout deliberately stays SENDING: `submitAndWait`
 * can throw (disconnect while polling) after the Payment was broadcast and it
 * may still validate, so blind re-queueing would double-pay the seller.
 * {@link resolveSendingPayout} settles the question from the ledger later.
 */
export async function processChannelPayout(
  deps: RedeemDeps,
  payout: ChannelPayoutRow,
): Promise<boolean> {
  const claimed = await claimChannelPayout(deps.pool, payout.id);
  if (!claimed) return false;
  try {
    const txHash = await deps.xrpl.submitPayment(
      {
        destination: claimed.destination,
        asset: Asset.XRP,
        amount: claimed.amount,
      },
      (signedHash) => setChannelPayoutTxHash(deps.pool, claimed.id, signedHash),
    );
    await markChannelPayoutPaid(deps.pool, claimed.id, txHash);
    return true;
  } catch (err) {
    console.error(
      `[channel] payout ${claimed.id} (${claimed.amount} XRP to ${claimed.destination}) errored; ` +
        'left SENDING for ledger resolution',
      err,
    );
    return false;
  }
}

/**
 * Resolve a payout stranded in SENDING (submit errored or the process died)
 * once enough time has passed that its Payment either validated or can never
 * validate (`LastLedgerSequence` is autofilled, giving the tx a hard expiry of
 * a few minutes — far less than the resolve delay). The ledger decides:
 * validated tesSUCCESS → PAID; validated tec / expired / never submitted →
 * released to PENDING for retry. Transient lookup errors leave it SENDING for
 * the next sweep.
 */
export async function resolveSendingPayout(
  deps: RedeemDeps,
  payout: ChannelPayoutRow,
): Promise<void> {
  if (!payout.payout_tx_hash) {
    // Died between claiming and signing — nothing was ever broadcast.
    await releaseChannelPayout(deps.pool, payout.id);
    return;
  }
  let response;
  try {
    response = await deps.xrpl.getTransaction(payout.payout_tx_hash);
  } catch (err) {
    if (rippledErrorCode(err) === 'txnNotFound') {
      // Never made a validated ledger and its LastLedgerSequence window is
      // long past — it can never validate now. Safe to retry.
      await releaseChannelPayout(deps.pool, payout.id);
      return;
    }
    throw err;
  }
  const tx = unwrapTxResult(response.result);
  if (tx.validated !== true) return; // still possible either way; check again next sweep
  const meta = tx.meta as { TransactionResult?: string } | string | undefined;
  const engineResult = typeof meta === 'object' && meta !== null ? meta.TransactionResult : undefined;
  if (engineResult === 'tesSUCCESS') {
    await markChannelPayoutPaid(deps.pool, payout.id, payout.payout_tx_hash);
    console.info(`[channel] payout ${payout.id} resolved from ledger as PAID`);
  } else {
    // Validated but failed (tec…) — the fee burned but nothing was delivered.
    await releaseChannelPayout(deps.pool, payout.id);
    console.warn(
      `[channel] payout ${payout.id} failed on ledger (${engineResult ?? 'unknown'}); re-queued`,
    );
  }
}

/**
 * Recover a channel stranded in SETTLING by a crash between the on-chain claim
 * and the watermark write. The ledger is the source of truth: if its Balance
 * moved past our watermark the claim landed — persist the watermark and the
 * owed seller cut (the redeem tx hash is lost, so no payments row can be
 * written); if it did not, the claim never made it — release the lease. A
 * missing ledger entry means the channel was closed on chain.
 */
export async function reconcileSettlingChannel(
  deps: RedeemDeps,
  channel: ChannelRow,
): Promise<void> {
  if (channel.status !== ChannelStatus.SETTLING) return;

  const ledgerChannel = await deps.xrpl.getPaymentChannel(channel.channel_id);
  if (!ledgerChannel) {
    await setChannelStatus(deps.pool, channel.channel_id, ChannelStatus.CLOSED);
    console.warn(`[channel] ${channel.channel_id} no longer exists on ledger; marked CLOSED`);
    return;
  }

  const ledgerBalance = BigInt(ledgerChannel.Balance);
  const redeemed = BigInt(xrpToDrops(channel.redeemed_amount));
  if (ledgerBalance <= redeemed) {
    // No claim landed; the redemption simply died before submitting.
    await abandonChannelRedemption(deps.pool, channel.channel_id);
    return;
  }

  const deltaDrops = (ledgerBalance - redeemed).toString();
  const { sellerCutDrops } = splitFeeDrops(deltaDrops, deps.env.platformFeeBps);
  const seller = await getSeller(deps.pool, channel.seller_id);
  const balanceHuman = String(dropsToXrp(ledgerChannel.Balance));

  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    const completed = await completeChannelRedemption(client, channel.channel_id, balanceHuman);
    if (!completed) {
      throw new Error(
        `channel ${channel.channel_id} ledger balance ${balanceHuman} does not reconcile with its stored claims`,
      );
    }
    if (seller && BigInt(sellerCutDrops) > 0n) {
      await insertChannelPayout(client, {
        channelId: channel.channel_id,
        sellerId: seller.id,
        destination: seller.pay_to_address,
        amount: String(dropsToXrp(sellerCutDrops)),
        redeemTxHash: null,
      });
    }
    await client.query('COMMIT');
    console.warn(
      `[channel] reconciled ${channel.channel_id}: recovered on-chain claim to ${balanceHuman} XRP (payments row unrecoverable; payout queued)`,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Split a claimed balance (drops) into the seller's cut and the platform fee. */
function splitFeeDrops(
  balanceDrops: string,
  feeBps: number,
): { sellerCutDrops: string; feeDrops: string } {
  const total = BigInt(balanceDrops);
  const feeDrops = (total * BigInt(feeBps)) / 10_000n;
  return { sellerCutDrops: (total - feeDrops).toString(), feeDrops: feeDrops.toString() };
}

function buildExplorerUrl(env: AppEnv, txHash: string): string {
  return explorerTxUrl(env.xrplNetwork, txHash);
}

/**
 * Best-effort on-chain redemption after a credit spend. Pulls the delivered
 * value on chain once the channel is mostly spent or is nearing its CancelAfter
 * expiry, so the gateway is not left holding only off-ledger claims when the
 * channel can be closed. Non-fatal: the manual `/redeem` route remains the
 * backstop, so any failure here is swallowed rather than failing the paid call.
 */
export async function autoRedeemIfNeeded(deps: RedeemDeps, channel: ChannelRow): Promise<void> {
  const totalDrops = BigInt(xrpToDrops(channel.credits_total));
  const usedDrops = BigInt(xrpToDrops(channel.credits_used));
  if (totalDrops <= 0n || usedDrops <= 0n) return;

  const ratioBasisPoints = BigInt(Math.round(CHANNEL_AUTO_REDEEM_RATIO * 10_000));
  const sufficientlySpent = usedDrops * 10_000n >= totalDrops * ratioBasisPoints;
  const nearExpiry =
    channel.cancel_after != null &&
    channel.cancel_after.getTime() - Date.now() <= CHANNEL_REDEEM_BUFFER_SEC * 1000;

  if (!sufficientlySpent && !nearExpiry) return;

  try {
    await redeemChannel(deps, channel.channel_id);
  } catch {
    // Leave the channel for the manual redeem backstop; the claim is durable.
  }
}
