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
  completeChannelRedemption,
  createChannel,
  getChannelByChannelId,
  getSeller,
  insertPayment,
} from '../db/repositories.js';
import type { ChannelRow } from '../db/types.js';
import { decimalGte } from '../util/decimal.js';
import { channelDestinationFor } from '../deps.js';
import type { GatewayDeps } from '../deps.js';

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

  const node = await deps.xrpl.getPaymentChannel(input.channelId);
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
  const channel = await beginChannelRedemption(deps.pool, channelId);
  if (!channel) {
    const known = await getChannelByChannelId(deps.pool, channelId);
    return {
      result: SettleResult.REJECTED,
      reason: known ? 'no outstanding claim to redeem or redemption already in progress' : 'unknown channel',
    };
  }
  if (!channel.last_claim_signature || !channel.public_key) {
    await abandonChannelRedemption(deps.pool, channelId);
    return { result: SettleResult.REJECTED, reason: 'no claims to redeem' };
  }

  const balanceDrops = xrpToDrops(channel.credits_used);
  const previouslyRedeemedDrops = xrpToDrops(channel.redeemed_amount);
  const deltaDrops = (BigInt(balanceDrops) - BigInt(previouslyRedeemedDrops)).toString();
  const ledgerChannel = await deps.xrpl.getPaymentChannel(channelId);
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
  let txHash: string;
  try {
    txHash = await deps.xrpl.redeemChannel({
      channelId,
      balanceDrops,
      signature: channel.last_claim_signature,
      publicKey: channel.public_key,
    });
  } catch (err) {
    await abandonChannelRedemption(deps.pool, channelId);
    throw err;
  }
  const completed = await completeChannelRedemption(deps.pool, channelId, channel.credits_used);
  if (!completed) {
    throw new Error(`redeemed channel ${channelId} but could not persist its ledger watermark`);
  }

  // The channel pays the gateway, so forward only the newly redeemed delta. Both
  // XRPL PaymentChannelClaim fields are cumulative; forwarding credits_used here
  // would pay the seller repeatedly for funds already delivered in an earlier claim.
  let platformFee = '0';
  const { sellerCutDrops, feeDrops } = splitFeeDrops(deltaDrops, deps.env.platformFeeBps);
  platformFee = String(dropsToXrp(feeDrops));
  const seller = await getSeller(deps.pool, channel.seller_id);
  if (seller && BigInt(sellerCutDrops) > 0n) {
    try {
      await deps.xrpl.submitPayment({
        destination: seller.pay_to_address,
        asset: Asset.XRP,
        amount: String(dropsToXrp(sellerCutDrops)),
      });
    } catch (err) {
      // The validated channel redemption is durable; retain the delta for a
      // recoverable manual payout rather than pretending the forwarding worked.
      console.error(
        `[channel] redeemed ${channelId} but failed to forward seller cut ${sellerCutDrops} drops`,
        err,
      );
    }
  }

  await insertPayment(deps.pool, {
    challengeId: null,
    walletAddress: channel.wallet_address,
    mode: PaymentMode.PREPAID_CREDITS,
    amount: String(dropsToXrp(deltaDrops)),
    asset: channel.asset,
    txHash,
    sourceTag: deps.env.sourceTag,
    platformFee,
  });

  return {
    result: SettleResult.SETTLED,
    txHash,
    explorerUrl: buildExplorerUrl(deps.env, txHash),
    amount: String(dropsToXrp(deltaDrops)),
  };
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
