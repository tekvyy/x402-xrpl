/**
 * PayChan channel lifecycle on the gateway side: register an on-ledger channel
 * as a prepaid-credits source, and redeem accumulated off-ledger claims on
 * chain. Registration trusts the *ledger* (not the client) for the channel's
 * destination, deposit, and signing public key.
 */
import { dropsToXrp, xrpToDrops } from 'xrpl';
import { Asset, ChannelStatus, PaymentMode, SettleResult, explorerTxUrl } from '@app/shared';
import type { AppEnv } from '@app/shared';
import {
  createChannel,
  getChannelByChannelId,
  getSeller,
  insertPayment,
  setChannelStatus,
} from '../db/repositories.js';
import type { ChannelRow } from '../db/types.js';
import { decimalGte } from '../util/decimal.js';
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
  if (existing) return { ok: true, channel: existing };

  const seller = await getSeller(deps.pool, input.sellerId);
  if (!seller) return { ok: false, reason: 'seller not found' };
  if (seller.price_asset !== Asset.XRP) {
    return { ok: false, reason: 'PayChan credits require an XRP-priced seller' };
  }

  const node = await deps.xrpl.getPaymentChannel(input.channelId);
  if (!node) return { ok: false, reason: 'payment channel not found on ledger' };
  if (node.Destination !== seller.pay_to_address) {
    return { ok: false, reason: 'channel destination does not match the seller' };
  }
  if (node.Account !== input.walletAddress) {
    return { ok: false, reason: 'channel owner does not match the wallet' };
  }

  const depositHuman = String(dropsToXrp(node.Amount));
  if (!decimalGte(depositHuman, seller.price_amount)) {
    return { ok: false, reason: 'deposit is below one call price' };
  }

  const channel = await createChannel(deps.pool, {
    channelId: input.channelId,
    walletAddress: input.walletAddress,
    sellerId: seller.id,
    depositAmount: depositHuman,
    asset: Asset.XRP,
    creditsTotal: depositHuman,
    publicKey: node.PublicKey,
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
export async function redeemChannel(
  deps: GatewayDeps,
  channelId: string,
): Promise<RedeemChannelResult> {
  const channel = await getChannelByChannelId(deps.pool, channelId);
  if (!channel) return { result: SettleResult.REJECTED, reason: 'unknown channel' };
  if (!channel.last_claim_signature || !channel.public_key) {
    return { result: SettleResult.REJECTED, reason: 'no claims to redeem' };
  }
  if (!decimalGte(channel.credits_used, '0.000001')) {
    return { result: SettleResult.REJECTED, reason: 'no claims to redeem' };
  }

  const balanceDrops = xrpToDrops(channel.credits_used);

  await setChannelStatus(deps.pool, channelId, ChannelStatus.SETTLING);
  let txHash: string;
  try {
    txHash = await deps.xrpl.redeemChannel({
      channelId,
      balanceDrops,
      signature: channel.last_claim_signature,
      publicKey: channel.public_key,
    });
  } catch (err) {
    await setChannelStatus(deps.pool, channelId, ChannelStatus.OPEN);
    throw err;
  }
  await setChannelStatus(deps.pool, channelId, ChannelStatus.OPEN);

  await insertPayment(deps.pool, {
    challengeId: null,
    walletAddress: channel.wallet_address,
    mode: PaymentMode.PREPAID_CREDITS,
    amount: channel.credits_used,
    asset: channel.asset,
    txHash,
    sourceTag: deps.env.sourceTag,
  });

  return {
    result: SettleResult.SETTLED,
    txHash,
    explorerUrl: buildExplorerUrl(deps.env, txHash),
    amount: channel.credits_used,
  };
}

function buildExplorerUrl(env: AppEnv, txHash: string): string {
  return explorerTxUrl(env.xrplNetwork, txHash);
}
