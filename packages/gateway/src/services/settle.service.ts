/**
 * Settlement orchestration for the facilitator. `settle` verifies a payment,
 * atomically consumes the single-use challenge, and durably records the payment
 * and usage event; `verify` runs the same checks without consuming anything
 * (backing the US-005 `/verify` endpoint). Both reuse {@link verifyPayPerCall}.
 */
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import {
  Asset,
  ChallengeStatus,
  PaymentMode,
  SettleResult,
  explorerTxUrl,
} from '@app/shared';
import type {
  AppEnv,
  PaymentPayload,
  PayPerCallPayload,
  PrepaidCreditsPayload,
} from '@app/shared';
import {
  applyChannelClaim,
  getChallengeByNonce,
  getChannelByChannelId,
  getSeller,
  insertPayment,
  insertUsageEvent,
  transitionChallengeStatus,
} from '../db/repositories.js';
import type { ChallengeRow, SellerRow } from '../db/types.js';
import type { UsageEventRow } from '../db/types.js';
import { verifyPayPerCall, verifyPrepaidClaim } from './verify.service.js';
import type { VerifyContext } from './verify.service.js';
import { publishUsageEvent } from './usage.service.js';
import { XrplService } from './xrpl.service.js';

export interface SettleDeps {
  pool: Pool;
  redis: Redis;
  xrpl: XrplService;
  env: AppEnv;
}

export interface SettleOutcome {
  result: SettleResult;
  reason?: string;
  txHash?: string;
  explorerUrl?: string;
  seller?: SellerRow;
  challenge?: ChallengeRow;
  /** Delivered amount in the asset's human unit, when settled/verified. */
  amount?: string;
}

const reject = (reason: string): SettleOutcome => ({ result: SettleResult.REJECTED, reason });

interface LoadedChallenge {
  challenge: ChallengeRow;
  seller: SellerRow;
  ctx: VerifyContext;
}

/**
 * Common prelude for verify and settle: resolve the challenge + seller for a
 * payload, enforce ownership and expiry, and build the verify context. Returns
 * a {@link SettleOutcome} (REJECTED) instead when any precondition fails.
 */
async function loadChallenge(
  deps: SettleDeps,
  payload: Pick<PaymentPayload, 'nonce'>,
  sellerId: string,
): Promise<LoadedChallenge | SettleOutcome> {
  const challenge = await getChallengeByNonce(deps.pool, payload.nonce);
  if (!challenge) return reject('unknown or unissued nonce');
  if (challenge.seller_id !== sellerId) return reject('nonce does not belong to this seller');

  const seller = await getSeller(deps.pool, sellerId);
  if (!seller) return reject('seller not found');

  if (challenge.expires_at.getTime() < Date.now()) {
    await transitionChallengeStatus(deps.pool, challenge.id, ChallengeStatus.EXPIRED, [
      ChallengeStatus.PENDING,
      ChallengeStatus.PAID,
    ]);
    return reject('challenge has expired');
  }

  const ctx: VerifyContext = {
    requiredAsset: challenge.asset,
    requiredAmount: challenge.amount,
    payTo: seller.pay_to_address,
    nonce: challenge.nonce,
    rlusdIssuer: deps.env.rlusdIssuer,
  };
  return { challenge, seller, ctx };
}

/** Verify a payment against its challenge without consuming it. */
export async function verify(
  deps: SettleDeps,
  payload: PaymentPayload,
  sellerId: string,
): Promise<SettleOutcome> {
  const loaded = await loadChallenge(deps, payload, sellerId);
  if ('result' in loaded) return loaded;

  if (payload.mode === PaymentMode.PREPAID_CREDITS) {
    const channel = await getChannelByChannelId(deps.pool, payload.channelId);
    if (!channel) return reject('unknown channel');
    if (channel.seller_id !== sellerId) return reject('channel does not belong to this seller');
    const result = verifyPrepaidClaim(payload, channel, loaded.ctx);
    if (!result.ok) return reject(result.reason);
    return {
      result: SettleResult.VERIFIED,
      seller: loaded.seller,
      challenge: loaded.challenge,
      amount: result.chargeHuman,
    };
  }

  const result = await verifyPayPerCall(deps.xrpl, payload, loaded.ctx);
  if (!result.ok) return reject(result.reason);

  return {
    result: SettleResult.VERIFIED,
    txHash: result.txHash,
    explorerUrl: explorerTxUrl(deps.env.xrplNetwork, result.txHash),
    seller: loaded.seller,
    challenge: loaded.challenge,
    amount: result.deliveredHuman,
  };
}

/**
 * Verify, then atomically consume the challenge and persist the payment +
 * usage event in one transaction. If another request consumes the same nonce
 * first, this call is REJECTED — the single-use guarantee.
 */
export async function settle(
  deps: SettleDeps,
  payload: PaymentPayload,
  sellerId: string,
): Promise<SettleOutcome> {
  const loaded = await loadChallenge(deps, payload, sellerId);
  if ('result' in loaded) return loaded;

  if (payload.mode === PaymentMode.PREPAID_CREDITS) {
    return settlePrepaidCredits(deps, payload, loaded);
  }

  const { challenge, seller } = loaded;

  if (challenge.status !== ChallengeStatus.PENDING) {
    return reject('nonce has already been used');
  }

  const result = await verifyPayPerCall(deps.xrpl, payload, loaded.ctx);
  if (!result.ok) return reject(result.reason);

  const client = await deps.pool.connect();
  let usageEvent: UsageEventRow;
  try {
    await client.query('BEGIN');

    const consumed = await transitionChallengeStatus(client, challenge.id, ChallengeStatus.CONSUMED, [
      ChallengeStatus.PENDING,
    ]);
    if (!consumed) {
      await client.query('ROLLBACK');
      return reject('nonce has already been used');
    }

    const sourceTag = result.sourceTag ?? deps.env.sourceTag;
    await insertPayment(client, {
      challengeId: challenge.id,
      walletAddress: result.payer,
      mode: PaymentMode.PAY_PER_CALL,
      amount: result.deliveredHuman,
      asset: challenge.asset,
      txHash: result.txHash,
      sourceTag,
    });
    usageEvent = await insertUsageEvent(client, {
      sellerId: seller.id,
      walletAddress: result.payer,
      endpoint: challenge.resource,
      amount: result.deliveredHuman,
      asset: challenge.asset,
      mode: PaymentMode.PAY_PER_CALL,
      txHash: result.txHash,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await publishUsageEvent(deps.redis, usageEvent);

  return {
    result: SettleResult.SETTLED,
    txHash: result.txHash,
    explorerUrl: explorerTxUrl(deps.env.xrplNetwork, result.txHash),
    seller,
    challenge,
    amount: result.deliveredHuman,
  };
}

/**
 * Settle a prepaid-credits claim: verify the PayChan claim, then atomically
 * consume the single-use challenge, advance the channel's credits, and record
 * the metered call as a usage event — all off-ledger (no per-call on-chain tx).
 * The on-chain settlement happens later via {@link redeemChannel}.
 */
async function settlePrepaidCredits(
  deps: SettleDeps,
  payload: PrepaidCreditsPayload,
  loaded: LoadedChallenge,
): Promise<SettleOutcome> {
  const { challenge, seller, ctx } = loaded;

  if (challenge.status !== ChallengeStatus.PENDING) {
    return reject('nonce has already been used');
  }

  const channel = await getChannelByChannelId(deps.pool, payload.channelId);
  if (!channel) return reject('unknown channel');
  if (channel.seller_id !== seller.id) return reject('channel does not belong to this seller');

  const result = verifyPrepaidClaim(payload, channel, ctx);
  if (!result.ok) return reject(result.reason);

  const client = await deps.pool.connect();
  let usageEvent: UsageEventRow;
  try {
    await client.query('BEGIN');

    const consumed = await transitionChallengeStatus(client, challenge.id, ChallengeStatus.CONSUMED, [
      ChallengeStatus.PENDING,
    ]);
    if (!consumed) {
      await client.query('ROLLBACK');
      return reject('nonce has already been used');
    }

    const applied = await applyChannelClaim(client, {
      channelId: payload.channelId,
      newCumulative: result.newCumulativeHuman,
      minIncrement: result.chargeHuman,
      signature: result.signature,
    });
    if (!applied) {
      await client.query('ROLLBACK');
      return reject('claim is stale, duplicate, or exceeds the channel deposit');
    }

    usageEvent = await insertUsageEvent(client, {
      sellerId: seller.id,
      walletAddress: channel.wallet_address,
      endpoint: challenge.resource,
      amount: result.chargeHuman,
      asset: challenge.asset,
      mode: PaymentMode.PREPAID_CREDITS,
      txHash: null,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await publishUsageEvent(deps.redis, usageEvent);

  return {
    result: SettleResult.SETTLED,
    seller,
    challenge,
    amount: result.chargeHuman,
  };
}

/** Assets the gateway can price a challenge in (both x402 modes settle these). */
export const SETTLEABLE_ASSETS: readonly Asset[] = [Asset.RLUSD, Asset.XRP];
