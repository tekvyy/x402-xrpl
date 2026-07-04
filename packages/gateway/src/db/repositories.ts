/**
 * Thin data-access layer. Every function takes an explicit {@link Queryable}
 * so callers can run inside a transaction by passing a checked-out client.
 * SQL is parameterized; no string interpolation of user input.
 */
import type { Asset, ChallengeStatus, ChannelStatus, PaymentMode } from '@app/shared';
import type { Queryable } from './pool.js';
import type {
  ChallengeRow,
  ChannelRow,
  EscrowCreditRow,
  PaymentRow,
  SellerRow,
  UsageEventRow,
} from './types.js';

export interface CreateSellerInput {
  name: string;
  originUrl: string;
  payToAddress: string;
  priceAmount: string;
  priceAsset: Asset;
  paymentMode: PaymentMode;
}

export async function createSeller(db: Queryable, input: CreateSellerInput): Promise<SellerRow> {
  const { rows } = await db.query<SellerRow>(
    `INSERT INTO sellers (name, origin_url, pay_to_address, price_amount, price_asset, payment_mode)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.name,
      input.originUrl,
      input.payToAddress,
      input.priceAmount,
      input.priceAsset,
      input.paymentMode,
    ],
  );
  return rows[0]!;
}

export async function getSeller(db: Queryable, id: string): Promise<SellerRow | null> {
  const { rows } = await db.query<SellerRow>(`SELECT * FROM sellers WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export interface CreateChallengeInput {
  nonce: string;
  sellerId: string;
  amount: string;
  asset: Asset;
  resource: string;
  expiresAt: Date;
}

export async function createChallenge(
  db: Queryable,
  input: CreateChallengeInput,
): Promise<ChallengeRow> {
  const { rows } = await db.query<ChallengeRow>(
    `INSERT INTO challenges (nonce, seller_id, amount, asset, resource, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.nonce, input.sellerId, input.amount, input.asset, input.resource, input.expiresAt],
  );
  return rows[0]!;
}

export async function getChallengeByNonce(
  db: Queryable,
  nonce: string,
): Promise<ChallengeRow | null> {
  const { rows } = await db.query<ChallengeRow>(`SELECT * FROM challenges WHERE nonce = $1`, [
    nonce,
  ]);
  return rows[0] ?? null;
}

/**
 * Atomically transition a challenge to a terminal status, but only from an
 * still-open state. Returns the updated row, or `null` when the challenge was
 * already consumed/expired (the guard that makes each nonce single-use even
 * under concurrent settles).
 */
export async function transitionChallengeStatus(
  db: Queryable,
  id: string,
  next: ChallengeStatus,
  allowedFrom: readonly ChallengeStatus[],
): Promise<ChallengeRow | null> {
  const { rows } = await db.query<ChallengeRow>(
    `UPDATE challenges SET status = $1
     WHERE id = $2 AND status = ANY($3::challenge_status_enum[])
     RETURNING *`,
    [next, id, allowedFrom as string[]],
  );
  return rows[0] ?? null;
}

export interface InsertPaymentInput {
  challengeId: string | null;
  walletAddress: string;
  mode: PaymentMode;
  amount: string;
  asset: Asset;
  txHash: string;
  sourceTag: number;
}

export async function insertPayment(db: Queryable, input: InsertPaymentInput): Promise<PaymentRow> {
  const { rows } = await db.query<PaymentRow>(
    `INSERT INTO payments (challenge_id, wallet_address, mode, amount, asset, tx_hash, source_tag)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.challengeId,
      input.walletAddress,
      input.mode,
      input.amount,
      input.asset,
      input.txHash,
      input.sourceTag,
    ],
  );
  return rows[0]!;
}

export interface InsertUsageEventInput {
  sellerId: string;
  walletAddress: string;
  endpoint: string;
  amount: string;
  asset: Asset;
  mode: PaymentMode;
  txHash: string | null;
}

export async function insertUsageEvent(
  db: Queryable,
  input: InsertUsageEventInput,
): Promise<UsageEventRow> {
  const { rows } = await db.query<UsageEventRow>(
    `INSERT INTO usage_events (seller_id, wallet_address, endpoint, amount, asset, mode, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.sellerId,
      input.walletAddress,
      input.endpoint,
      input.amount,
      input.asset,
      input.mode,
      input.txHash,
    ],
  );
  return rows[0]!;
}

export interface CreateChannelInput {
  channelId: string;
  walletAddress: string;
  sellerId: string;
  depositAmount: string;
  asset: Asset;
  creditsTotal: string;
  publicKey: string;
}

export async function createChannel(db: Queryable, input: CreateChannelInput): Promise<ChannelRow> {
  const { rows } = await db.query<ChannelRow>(
    `INSERT INTO channels
       (channel_id, wallet_address, seller_id, deposit_amount, asset, credits_total, public_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.channelId,
      input.walletAddress,
      input.sellerId,
      input.depositAmount,
      input.asset,
      input.creditsTotal,
      input.publicKey,
    ],
  );
  return rows[0]!;
}

export async function getChannelByChannelId(
  db: Queryable,
  channelId: string,
): Promise<ChannelRow | null> {
  const { rows } = await db.query<ChannelRow>(`SELECT * FROM channels WHERE channel_id = $1`, [
    channelId,
  ]);
  return rows[0] ?? null;
}

export interface ApplyChannelClaimInput {
  channelId: string;
  /** New cumulative amount (human unit) the claim authorizes. */
  newCumulative: string;
  /** Minimum increment this call must cover (the challenge price). */
  minIncrement: string;
  signature: string;
}

/**
 * Atomically accept a claim: advance `credits_used` to `newCumulative` and
 * store its signature, but only when the channel is OPEN, the amount is
 * strictly greater than the last (monotonic), stays within the deposit, and
 * covers the call's price. Returns the updated row, or `null` when any guard
 * fails — the single point that rejects stale/duplicate/over-limit claims,
 * safe under concurrency.
 */
export async function applyChannelClaim(
  db: Queryable,
  input: ApplyChannelClaimInput,
): Promise<ChannelRow | null> {
  const { rows } = await db.query<ChannelRow>(
    `UPDATE channels
     SET credits_used = $2::numeric, last_claim_signature = $3
     WHERE channel_id = $1
       AND status = 'OPEN'::channel_status_enum
       AND credits_used < $2::numeric
       AND $2::numeric <= credits_total
       AND ($2::numeric - credits_used) >= $4::numeric
     RETURNING *`,
    [input.channelId, input.newCumulative, input.signature, input.minIncrement],
  );
  return rows[0] ?? null;
}

export async function setChannelStatus(
  db: Queryable,
  channelId: string,
  status: ChannelStatus,
): Promise<void> {
  await db.query(`UPDATE channels SET status = $2::channel_status_enum WHERE channel_id = $1`, [
    channelId,
    status,
  ]);
}

export interface CreateEscrowCreditInput {
  sellerId: string;
  walletAddress: string;
  asset: Asset;
  depositTxHash: string;
  creditsTotal: string;
}

export async function createEscrowCredit(
  db: Queryable,
  input: CreateEscrowCreditInput,
): Promise<EscrowCreditRow> {
  const { rows } = await db.query<EscrowCreditRow>(
    `INSERT INTO escrow_credits
       (seller_id, wallet_address, asset, deposit_tx_hash, credits_total)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.sellerId, input.walletAddress, input.asset, input.depositTxHash, input.creditsTotal],
  );
  return rows[0]!;
}

export async function getEscrowCreditByTxHash(
  db: Queryable,
  depositTxHash: string,
): Promise<EscrowCreditRow | null> {
  const { rows } = await db.query<EscrowCreditRow>(
    `SELECT * FROM escrow_credits WHERE deposit_tx_hash = $1`,
    [depositTxHash],
  );
  return rows[0] ?? null;
}

/**
 * Atomically debit `amount` (human unit) of escrow credits for a wallet, only
 * when sufficient unused balance remains. Returns the updated row, or `null`
 * when the balance is insufficient — the off-ledger debit guard.
 */
export async function debitEscrowCredit(
  db: Queryable,
  sellerId: string,
  walletAddress: string,
  amount: string,
): Promise<EscrowCreditRow | null> {
  const { rows } = await db.query<EscrowCreditRow>(
    `UPDATE escrow_credits
     SET credits_used = credits_used + $3::numeric
     WHERE id = (
       SELECT id FROM escrow_credits
       WHERE seller_id = $1 AND wallet_address = $2
         AND (credits_total - credits_used) >= $3::numeric
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE
     )
     RETURNING *`,
    [sellerId, walletAddress, amount],
  );
  return rows[0] ?? null;
}
