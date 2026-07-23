/**
 * Settlement orchestration for the facilitator. `settle` verifies a payment,
 * atomically consumes the single-use challenge, and durably records the payment
 * and usage event; `verify` runs the same checks without consuming anything
 * (backing the US-005 `/verify` endpoint). Both reuse {@link verifyPayPerCall}.
 */
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { xrpToDrops } from 'xrpl';
import {
  Asset,
  ChallengeStatus,
  ChannelStatus,
  PaymentMode,
  SettleResult,
  X402ErrorCode,
  X402Scheme,
  explorerTxUrl,
  modeForScheme,
  networkConfig,
  setupAllowsMode,
  x402NetworkId,
} from '@app/shared';
import type {
  AppEnv,
  XrplNetwork,
  PaymentPayload,
  PaymentRequirements,
  PaychanSchemePayload,
} from '@app/shared';
import {
  applyChannelClaim,
  extendChallengeExpiry,
  getChallengeByNonce,
  getChannelByChannelId,
  getSeller,
  insertPayment,
  insertUsageEvent,
  transitionChallengeStatus,
} from '../db/repositories.js';
import type { ChallengeRow, ChannelRow, SellerRow } from '../db/types.js';
import type { UsageEventRow } from '../db/types.js';
import { verifyPayPerCall, verifyPrepaidClaim } from './verify.service.js';
import type { VerifyContext } from './verify.service.js';
import { autoRedeemIfNeeded } from './channel.service.js';
import { publishUsageEvent } from './usage.service.js';
import { XrplService } from './xrpl.service.js';
import type { XrplRegistry } from './xrpl-registry.js';

export interface SettleDeps {
  pool: Pool;
  redis: Redis;
  /**
   * All enabled networks. Settlement cannot be scoped to one up front — the
   * network is a property of the challenge being settled, resolved inside
   * {@link loadChallenge} from the single-use nonce.
   */
  xrplRegistry: XrplRegistry;
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
  /** Payer's XRPL classic address, when known. */
  payer?: string;
  /** Gateway-side fault (ledger connection down): map to 503, payer should retry. */
  unavailable?: boolean;
}

const reject = (reason: string): SettleOutcome => ({ result: SettleResult.REJECTED, reason });

/**
 * Extra life granted to a PENDING challenge each time its settlement fails
 * through a gateway-side fault. Keeps the buyer's window open while the fault
 * is ours; a healthy retry a few seconds later settles normally.
 */
const UNAVAILABLE_EXPIRY_GRACE_MS = 60_000;

/**
 * Turn a failed verify into a REJECTED outcome. When the failure is a
 * gateway-side fault, also stop the challenge's expiry clock burning down
 * during our own outage — otherwise a validated, memo-bound payment can become
 * permanently unredeemable through no fault of the payer.
 */
async function rejectVerifyFailure(
  deps: SettleDeps,
  challenge: ChallengeRow,
  failure: { reason: string; unavailable?: boolean },
): Promise<SettleOutcome> {
  if (failure.unavailable) {
    await extendChallengeExpiry(
      deps.pool,
      challenge.id,
      new Date(Date.now() + UNAVAILABLE_EXPIRY_GRACE_MS),
    );
  }
  return { result: SettleResult.REJECTED, reason: failure.reason, unavailable: failure.unavailable };
}

/** Postgres unique-violation SQLSTATE — a concurrent settle already recorded this row. */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}

interface LoadedChallenge {
  challenge: ChallengeRow;
  seller: SellerRow;
  ctx: VerifyContext;
  /** The network the challenge is bound to. */
  network: XrplNetwork;
  /** XRPL service for {@link network} — the only ledger this settle may touch. */
  xrpl: XrplService;
}

/**
 * Common prelude for verify and settle: validate the spec envelope, resolve
 * the challenge + seller for the payload's nonce, check the caller-supplied
 * `paymentRequirements` against what this gateway actually issued, enforce
 * expiry, and build the verify context. Returns a {@link SettleOutcome}
 * (REJECTED) instead when any precondition fails.
 */
async function loadChallenge(
  deps: SettleDeps,
  payment: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<LoadedChallenge | SettleOutcome> {
  if (requirements.scheme !== payment.scheme) {
    return reject(X402ErrorCode.INVALID_PAYMENT_REQUIREMENTS);
  }

  const challenge = await getChallengeByNonce(deps.pool, payment.payload.nonce);
  if (!challenge) return reject('unknown or unissued nonce');
  if (requirements.extra.nonce !== challenge.nonce) {
    return reject('requirements nonce does not match the payment nonce');
  }

  // The network comes from the challenge, never from process config: the
  // gateway issues one challenge per network, so the single-use nonce *is* the
  // network binding. Without this, a free testnet payment could satisfy a
  // mainnet challenge. Both the payload and the echoed requirements must agree
  // with what was issued.
  const network = x402NetworkId(challenge.network);
  if (payment.network !== network || requirements.network !== network) {
    return reject(X402ErrorCode.INVALID_NETWORK);
  }
  if (!deps.xrplRegistry.has(challenge.network)) {
    return reject(`network ${challenge.network} is no longer served by this gateway`);
  }

  const seller = await getSeller(deps.pool, challenge.seller_id);
  if (!seller) return reject('seller not found');
  if (!setupAllowsMode(seller.payment_mode, modeForScheme(payment.scheme))) {
    return reject(`seller does not accept ${payment.scheme} payments`);
  }

  // The supplied requirements must be the ones this gateway issued for the
  // challenge — a caller must not be able to settle against altered terms.
  const wireAmount =
    challenge.asset === Asset.XRP ? xrpToDrops(challenge.amount) : challenge.amount;
  if (
    requirements.asset !== challenge.asset ||
    requirements.maxAmountRequired !== wireAmount ||
    requirements.payTo !== seller.pay_to_address ||
    requirements.resource !== challenge.resource
  ) {
    return reject(X402ErrorCode.INVALID_PAYMENT_REQUIREMENTS);
  }

  if (challenge.expires_at.getTime() <= Date.now()) {
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
    rlusdIssuer: networkConfig(deps.env, challenge.network).rlusdIssuer,
  };
  return {
    challenge,
    seller,
    ctx,
    network: challenge.network,
    xrpl: deps.xrplRegistry.for(challenge.network),
  };
}

/** Verify a payment against its challenge without consuming it. */
export async function verify(
  deps: SettleDeps,
  payment: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<SettleOutcome> {
  const loaded = await loadChallenge(deps, payment, requirements);
  if ('result' in loaded) return loaded;

  if (payment.scheme === X402Scheme.PAYCHAN) {
    const claim = payment.payload;
    const channel = await getChannelByChannelId(deps.pool, loaded.network, claim.channelId);
    if (!channel) return reject('unknown channel');
    if (channel.seller_id !== loaded.seller.id) {
      return reject('channel does not belong to this seller');
    }
    const result = verifyPrepaidClaim(claim, channel, loaded.ctx);
    if (!result.ok) return reject(result.reason);
    return {
      result: SettleResult.VERIFIED,
      seller: loaded.seller,
      challenge: loaded.challenge,
      amount: result.chargeHuman,
      payer: claim.payer,
    };
  }

  const result = await verifyPayPerCall(loaded.xrpl, payment.payload, loaded.ctx);
  if (!result.ok) return rejectVerifyFailure(deps, loaded.challenge, result);

  return {
    result: SettleResult.VERIFIED,
    txHash: result.txHash,
    explorerUrl: explorerTxUrl(loaded.network, result.txHash),
    seller: loaded.seller,
    challenge: loaded.challenge,
    amount: result.deliveredHuman,
    payer: result.payer,
  };
}

/**
 * Verify, then atomically consume the challenge and persist the payment +
 * usage event in one transaction. If another request consumes the same nonce
 * first, this call is REJECTED — the single-use guarantee.
 */
export async function settle(
  deps: SettleDeps,
  payment: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<SettleOutcome> {
  const loaded = await loadChallenge(deps, payment, requirements);
  if ('result' in loaded) return loaded;

  if (payment.scheme === X402Scheme.PAYCHAN) {
    return settlePrepaidCredits(deps, payment.payload, loaded);
  }

  const { challenge, seller } = loaded;

  if (challenge.status !== ChallengeStatus.PENDING) {
    return reject('nonce has already been used');
  }

  const result = await verifyPayPerCall(loaded.xrpl, payment.payload, loaded.ctx);
  if (!result.ok) return rejectVerifyFailure(deps, challenge, result);

  const client = await deps.pool.connect();
  let usageEvent: UsageEventRow;
  try {
    await client.query('BEGIN');

    const consumed = await transitionChallengeStatus(
      client,
      challenge.id,
      ChallengeStatus.CONSUMED,
      [ChallengeStatus.PENDING],
    );
    if (!consumed) {
      await client.query('ROLLBACK');
      return reject('nonce has already been used');
    }

    const sourceTag = result.sourceTag ?? deps.env.sourceTag;
    await insertPayment(client, {
      challengeId: challenge.id,
      network: loaded.network,
      walletAddress: result.payer,
      mode: PaymentMode.PAY_PER_CALL,
      amount: result.deliveredHuman,
      asset: challenge.asset,
      txHash: result.txHash,
      sourceTag,
    });
    usageEvent = await insertUsageEvent(client, {
      sellerId: seller.id,
      network: loaded.network,
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
    // A concurrent settle already recorded this transaction (unique tx_hash) —
    // treat it as a rejected replay rather than a server error.
    if (isUniqueViolation(err)) return reject('this transaction has already been settled');
    throw err;
  } finally {
    client.release();
  }

  await publishUsageEvent(deps.redis, usageEvent);

  return {
    result: SettleResult.SETTLED,
    txHash: result.txHash,
    explorerUrl: explorerTxUrl(loaded.network, result.txHash),
    seller,
    challenge,
    amount: result.deliveredHuman,
    payer: result.payer,
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
  payload: PaychanSchemePayload,
  loaded: LoadedChallenge,
): Promise<SettleOutcome> {
  const { challenge, seller, ctx } = loaded;

  if (challenge.status !== ChallengeStatus.PENDING) {
    return reject('nonce has already been used');
  }

  const channel = await getChannelByChannelId(deps.pool, loaded.network, payload.channelId);
  if (!channel) return reject('unknown channel');
  if (channel.seller_id !== seller.id) return reject('channel does not belong to this seller');
  if (channel.status === ChannelStatus.CLOSED) {
    return reject('channel is closed; open a new channel');
  }

  // While a redemption is in flight (SETTLING) the on-ledger Balance may have
  // already advanced past our stored watermark toward the claimed cumulative;
  // anything in that range is our own claim being settled, so paid calls keep
  // flowing. Outside a redemption the Balance must match the watermark exactly.
  const redeemedDrops = BigInt(xrpToDrops(channel.redeemed_amount));
  const claimedDrops = BigInt(xrpToDrops(channel.credits_used));
  const balanceMatches = (ledgerBalance: string): boolean => {
    const balance = BigInt(ledgerBalance);
    if (channel.status === ChannelStatus.SETTLING) {
      return balance >= redeemedDrops && balance <= claimedDrops;
    }
    return balance === redeemedDrops;
  };

  // Reconcile the stored credits with the validated ledger before delivering
  // another off-ledger-paid request. This rejects legacy seller-direct channels,
  // source-initiated closure, and balances not accounted for by this gateway.
  let ledgerChannel;
  try {
    ledgerChannel = await loaded.xrpl.getPaymentChannel(payload.channelId);
  } catch {
    return reject('could not read the channel from the ledger; try again');
  }
  if (
    !ledgerChannel ||
    ledgerChannel.Destination !== loaded.xrpl.address() ||
    ledgerChannel.Account !== channel.wallet_address ||
    ledgerChannel.PublicKey !== channel.public_key ||
    // The on-ledger deposit must at least cover the credits we registered. A
    // payer may top up the channel on-ledger (PaymentChannelFund), which only
    // raises `Amount`; those extra funds stay unspendable until the channel is
    // re-registered, but the top-up must not brick the channel. A ledger Amount
    // *below* the registered deposit means state we don't recognise — reject.
    BigInt(ledgerChannel.Amount) < BigInt(xrpToDrops(channel.deposit_amount)) ||
    !balanceMatches(ledgerChannel.Balance)
  ) {
    return reject('channel ledger state does not match its registered credit state');
  }
  if (ledgerChannel.Expiration != null) {
    return reject('channel has a pending expiration; open a new channel');
  }

  const result = verifyPrepaidClaim(payload, channel, ctx);
  if (!result.ok) return reject(result.reason);

  const client = await deps.pool.connect();
  let usageEvent: UsageEventRow;
  let appliedChannel: ChannelRow;
  try {
    await client.query('BEGIN');

    const consumed = await transitionChallengeStatus(
      client,
      challenge.id,
      ChallengeStatus.CONSUMED,
      [ChallengeStatus.PENDING],
    );
    if (!consumed) {
      await client.query('ROLLBACK');
      return reject('nonce has already been used');
    }

    const applied = await applyChannelClaim(client, {
      channelId: payload.channelId,
      network: loaded.network,
      newCumulative: result.newCumulativeHuman,
      minIncrement: result.chargeHuman,
      signature: result.signature,
    });
    if (!applied) {
      await client.query('ROLLBACK');
      return reject('claim is stale, duplicate, or exceeds the channel deposit');
    }
    appliedChannel = applied;

    usageEvent = await insertUsageEvent(client, {
      sellerId: seller.id,
      network: loaded.network,
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

  // Best-effort: pull the delivered value on chain once the channel is mostly
  // spent or nearing expiry. Fire-and-forget so it never delays the paid call;
  // the manual /redeem route stays the backstop.
  void autoRedeemIfNeeded(
    { pool: deps.pool, env: deps.env, xrpl: loaded.xrpl, network: loaded.network },
    appliedChannel,
  );

  return {
    result: SettleResult.SETTLED,
    seller,
    challenge,
    amount: result.chargeHuman,
    payer: payload.payer,
  };
}

/** Assets the gateway can price a challenge in (both x402 modes settle these). */
export const SETTLEABLE_ASSETS: readonly Asset[] = [Asset.RLUSD, Asset.XRP];
