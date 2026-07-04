/**
 * Thin data-access layer. Every function takes an explicit {@link Queryable}
 * so callers can run inside a transaction by passing a checked-out client.
 * SQL is parameterized; no string interpolation of user input.
 */
import type { Asset, ChallengeStatus, PaymentMode } from '@app/shared';
import type { Queryable } from './pool.js';
import type { ChallengeRow, PaymentRow, SellerRow, UsageEventRow } from './types.js';

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
  challengeId: string;
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
