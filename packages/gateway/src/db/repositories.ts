/**
 * Thin data-access layer. Every function takes an explicit {@link Queryable}
 * so callers can run inside a transaction by passing a checked-out client.
 * SQL is parameterized; no string interpolation of user input.
 */
import type {
  Asset,
  ChallengeStatus,
  ChannelStatus,
  PaymentMode,
  PaymentSetup,
  XrplNetwork,
} from '@app/shared';
import type { Queryable } from './pool.js';
import type {
  AuditLogRow,
  BotRow,
  ChallengeRow,
  ChannelPayoutRow,
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
  paymentMode: PaymentSetup;
  /** Networks to advertise this seller on; must not be empty. */
  networks: XrplNetwork[];
  /** Owning XRPL address (from the authenticated session). */
  ownerAddress: string;
}

export async function createSeller(db: Queryable, input: CreateSellerInput): Promise<SellerRow> {
  const { rows } = await db.query<SellerRow>(
    `INSERT INTO sellers
       (name, origin_url, pay_to_address, price_amount, price_asset, payment_mode,
        networks, owner_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8)
     RETURNING *`,
    [
      input.name,
      input.originUrl,
      input.payToAddress,
      input.priceAmount,
      input.priceAsset,
      input.paymentMode,
      input.networks,
      input.ownerAddress,
    ],
  );
  return rows[0]!;
}

export async function getSeller(db: Queryable, id: string): Promise<SellerRow | null> {
  const { rows } = await db.query<SellerRow>(`SELECT * FROM sellers WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * All registered sellers, newest first — the public service catalog agents
 * browse to discover payable APIs. Registration is the act of publishing, so
 * every seller is listed; only public projection fields leave the route layer.
 */
export async function listPublicSellers(db: Queryable, limit = 100): Promise<SellerRow[]> {
  const { rows } = await db.query<SellerRow>(
    `SELECT * FROM sellers ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

/** All sellers owned by an address, newest first. */
export async function listSellersByOwner(
  db: Queryable,
  ownerAddress: string,
): Promise<SellerRow[]> {
  const { rows } = await db.query<SellerRow>(
    `SELECT * FROM sellers WHERE owner_address = $1 ORDER BY created_at DESC`,
    [ownerAddress],
  );
  return rows;
}

export interface CreateChallengeInput {
  nonce: string;
  sellerId: string;
  /** The network this nonce may be settled on. */
  network: XrplNetwork;
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
    `INSERT INTO challenges (nonce, seller_id, network, amount, asset, resource, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.nonce,
      input.sellerId,
      input.network,
      input.amount,
      input.asset,
      input.resource,
      input.expiresAt,
    ],
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
 * Push a still-PENDING challenge's expiry out to at least `minExpiry`. Used
 * when settlement fails through a gateway-side fault (ledger connection down):
 * the expiry clock must not burn down during an outage that is entirely ours,
 * or the outage converts into the buyer's loss (an on-chain payment memo-bound
 * to a nonce that can never settle). Never shortens an expiry.
 */
export async function extendChallengeExpiry(
  db: Queryable,
  id: string,
  minExpiry: Date,
): Promise<void> {
  await db.query(
    `UPDATE challenges SET expires_at = GREATEST(expires_at, $2)
     WHERE id = $1 AND status = 'PENDING'`,
    [id, minExpiry],
  );
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
  /** Network the settling transaction landed on. */
  network: XrplNetwork;
  walletAddress: string;
  mode: PaymentMode;
  amount: string;
  asset: Asset;
  txHash: string;
  sourceTag: number;
  /** Platform fee retained (human unit); defaults to 0 when the path has no fee. */
  platformFee?: string;
}

export async function insertPayment(db: Queryable, input: InsertPaymentInput): Promise<PaymentRow> {
  const { rows } = await db.query<PaymentRow>(
    `INSERT INTO payments
       (challenge_id, network, wallet_address, mode, amount, asset, tx_hash, source_tag,
        platform_fee)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.challengeId,
      input.network,
      input.walletAddress,
      input.mode,
      input.amount,
      input.asset,
      input.txHash,
      input.sourceTag,
      input.platformFee ?? '0',
    ],
  );
  return rows[0]!;
}

export interface InsertUsageEventInput {
  sellerId: string;
  /** Network this call was paid on. */
  network: XrplNetwork;
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
    `INSERT INTO usage_events
       (seller_id, network, wallet_address, endpoint, amount, asset, mode, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.sellerId,
      input.network,
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
  /** Network the PayChan lives on. */
  network: XrplNetwork;
  walletAddress: string;
  sellerId: string;
  depositAmount: string;
  asset: Asset;
  creditsTotal: string;
  publicKey: string;
  /** PayChan `SettleDelay` (seconds), read from the ledger. */
  settleDelay: number;
  /** Immutable `CancelAfter` expiry, or null when the channel sets none. */
  cancelAfter: Date | null;
}

export async function createChannel(db: Queryable, input: CreateChannelInput): Promise<ChannelRow> {
  const { rows } = await db.query<ChannelRow>(
    `INSERT INTO channels
       (channel_id, network, wallet_address, seller_id, deposit_amount, asset, credits_total,
        public_key, settle_delay, cancel_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.channelId,
      input.network,
      input.walletAddress,
      input.sellerId,
      input.depositAmount,
      input.asset,
      input.creditsTotal,
      input.publicKey,
      input.settleDelay,
      input.cancelAfter,
    ],
  );
  return rows[0]!;
}

export async function getChannelByChannelId(
  db: Queryable,
  network: XrplNetwork,
  channelId: string,
): Promise<ChannelRow | null> {
  const { rows } = await db.query<ChannelRow>(
    `SELECT * FROM channels WHERE network = $1 AND channel_id = $2`,
    [network, channelId],
  );
  return rows[0] ?? null;
}

export interface ApplyChannelClaimInput {
  channelId: string;
  network: XrplNetwork;
  /** New cumulative amount (human unit) the claim authorizes. */
  newCumulative: string;
  /** Minimum increment this call must cover (the challenge price). */
  minIncrement: string;
  signature: string;
}

/**
 * Atomically accept a claim: advance `credits_used` to `newCumulative` and
 * store its signature, but only when the channel is usable, the amount is
 * strictly greater than the last (monotonic), stays within the deposit, and
 * covers the call's price. Returns the updated row, or `null` when any guard
 * fails — the single point that rejects stale/duplicate/over-limit claims,
 * safe under concurrency.
 *
 * SETTLING channels stay claimable: an in-flight redemption works from the
 * snapshot it leased, so advancing `credits_used` under it is safe, and
 * rejecting claims here would fail legitimate paid calls whenever the
 * auto-redeem kicks in.
 */
export async function applyChannelClaim(
  db: Queryable,
  input: ApplyChannelClaimInput,
): Promise<ChannelRow | null> {
  const { rows } = await db.query<ChannelRow>(
    `UPDATE channels
     SET credits_used = $3::numeric, last_claim_signature = $4
     WHERE network = $1 AND channel_id = $2
       AND status IN ('OPEN'::channel_status_enum, 'SETTLING'::channel_status_enum)
       AND credits_used < $3::numeric
       AND $3::numeric <= credits_total
       AND ($3::numeric - credits_used) >= $5::numeric
     RETURNING *`,
    [input.network, input.channelId, input.newCumulative, input.signature, input.minIncrement],
  );
  return rows[0] ?? null;
}

export async function setChannelStatus(
  db: Queryable,
  network: XrplNetwork,
  channelId: string,
  status: ChannelStatus,
): Promise<void> {
  await db.query(
    `UPDATE channels SET status = $3::channel_status_enum
     WHERE network = $1 AND channel_id = $2`,
    [network, channelId, status],
  );
}

/** Lease one outstanding redemption and return its stable cumulative snapshot. */
export async function beginChannelRedemption(
  db: Queryable,
  network: XrplNetwork,
  channelId: string,
): Promise<ChannelRow | null> {
  const { rows } = await db.query<ChannelRow>(
    `UPDATE channels
     SET status = 'SETTLING'::channel_status_enum, settling_since = now()
     WHERE network = $1 AND channel_id = $2
       AND status = 'OPEN'::channel_status_enum
       AND credits_used > redeemed_amount
       AND last_claim_signature IS NOT NULL
     RETURNING *`,
    [network, channelId],
  );
  return rows[0] ?? null;
}

/** Persist a validated cumulative redemption and release the redemption lease. */
export async function completeChannelRedemption(
  db: Queryable,
  network: XrplNetwork,
  channelId: string,
  redeemedAmount: string,
): Promise<ChannelRow | null> {
  const { rows } = await db.query<ChannelRow>(
    `UPDATE channels
     SET redeemed_amount = $3::numeric,
         status = 'OPEN'::channel_status_enum,
         settling_since = NULL
     WHERE network = $1 AND channel_id = $2
       AND status = 'SETTLING'::channel_status_enum
       AND redeemed_amount < $3::numeric
       AND $3::numeric <= credits_used
     RETURNING *`,
    [network, channelId, redeemedAmount],
  );
  return rows[0] ?? null;
}

/** Release a failed redemption lease without changing the ledger watermark. */
export async function abandonChannelRedemption(
  db: Queryable,
  network: XrplNetwork,
  channelId: string,
): Promise<void> {
  await db.query(
    `UPDATE channels
     SET status = 'OPEN'::channel_status_enum, settling_since = NULL
     WHERE network = $1 AND channel_id = $2
       AND status = 'SETTLING'::channel_status_enum`,
    [network, channelId],
  );
}

/**
 * Channels whose SETTLING lease predates `cutoff` — a redemption stranded by a
 * crash between the on-chain claim and the watermark write. The maintenance
 * sweep reconciles these against the ledger.
 */
export async function listStaleSettlingChannels(
  db: Queryable,
  cutoff: Date,
): Promise<ChannelRow[]> {
  const { rows } = await db.query<ChannelRow>(
    `SELECT * FROM channels
     WHERE status = 'SETTLING'::channel_status_enum
       AND (settling_since IS NULL OR settling_since < $1)`,
    [cutoff],
  );
  return rows;
}

export interface InsertChannelPayoutInput {
  channelId: string;
  /** Network the redemption happened on; part of the FK to `channels`. */
  network: XrplNetwork;
  sellerId: string;
  destination: string;
  /** Owed seller cut in XRP (human unit). */
  amount: string;
  /** Claim tx that redeemed the funds; null when recovered by reconciliation. */
  redeemTxHash: string | null;
}

/** Record a seller cut owed from a redemption (inside the redemption tx). */
export async function insertChannelPayout(
  db: Queryable,
  input: InsertChannelPayoutInput,
): Promise<ChannelPayoutRow> {
  const { rows } = await db.query<ChannelPayoutRow>(
    `INSERT INTO channel_payouts
       (channel_id, network, seller_id, destination, amount, redeem_tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.channelId,
      input.network,
      input.sellerId,
      input.destination,
      input.amount,
      input.redeemTxHash,
    ],
  );
  return rows[0]!;
}

/**
 * Atomically claim a payout for sending (PENDING → SENDING), stamping the
 * claim time and counting the attempt. Returns the row, or `null` when another
 * worker already claimed it — the guard that stops two sweeps from
 * double-paying a seller.
 */
export async function claimChannelPayout(
  db: Queryable,
  id: string,
): Promise<ChannelPayoutRow | null> {
  const { rows } = await db.query<ChannelPayoutRow>(
    `UPDATE channel_payouts
     SET status = 'SENDING'::payout_status_enum,
         sending_at = now(),
         attempts = attempts + 1
     WHERE id = $1 AND status = 'PENDING'::payout_status_enum
     RETURNING *`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Record the forward Payment's hash BEFORE it is submitted, so a crash or an
 * ambiguous submit error can later be resolved by looking the hash up on the
 * ledger instead of guessing (and double paying).
 */
export async function setChannelPayoutTxHash(
  db: Queryable,
  id: string,
  payoutTxHash: string,
): Promise<void> {
  await db.query(
    `UPDATE channel_payouts
     SET payout_tx_hash = $2
     WHERE id = $1 AND status = 'SENDING'::payout_status_enum`,
    [id, payoutTxHash],
  );
}

/** Mark a claimed payout as paid on chain. */
export async function markChannelPayoutPaid(
  db: Queryable,
  id: string,
  payoutTxHash: string,
): Promise<void> {
  await db.query(
    `UPDATE channel_payouts
     SET status = 'PAID'::payout_status_enum, payout_tx_hash = $2, paid_at = now()
     WHERE id = $1 AND status = 'SENDING'::payout_status_enum`,
    [id, payoutTxHash],
  );
}

/**
 * Release a claimed payout back to PENDING for retry. Only call this when the
 * in-flight payment is KNOWN not to have delivered (looked up on the ledger,
 * or provably never submitted) — releasing an ambiguous send double-pays.
 */
export async function releaseChannelPayout(db: Queryable, id: string): Promise<void> {
  await db.query(
    `UPDATE channel_payouts
     SET status = 'PENDING'::payout_status_enum, payout_tx_hash = NULL
     WHERE id = $1 AND status = 'SENDING'::payout_status_enum`,
    [id],
  );
}

/** Payouts still owed to sellers with retry budget left, oldest first. */
export async function listPendingChannelPayouts(
  db: Queryable,
  maxAttempts: number,
  limit = 50,
): Promise<ChannelPayoutRow[]> {
  const { rows } = await db.query<ChannelPayoutRow>(
    `SELECT * FROM channel_payouts
     WHERE status = 'PENDING'::payout_status_enum AND attempts < $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [maxAttempts, limit],
  );
  return rows;
}

/**
 * Payouts whose SENDING claim predates `cutoff` — the submit errored or the
 * process died mid payment. Old enough that the submitted transaction (if any)
 * has either validated or expired, so each can be resolved from the ledger.
 */
export async function listUnresolvedSendingPayouts(
  db: Queryable,
  cutoff: Date,
): Promise<ChannelPayoutRow[]> {
  const { rows } = await db.query<ChannelPayoutRow>(
    `SELECT * FROM channel_payouts
     WHERE status = 'SENDING'::payout_status_enum
       AND (sending_at IS NULL OR sending_at < $1)`,
    [cutoff],
  );
  return rows;
}

/** Payouts that exhausted their retry budget; owed money needing an operator. */
export async function listExhaustedChannelPayouts(
  db: Queryable,
  maxAttempts: number,
): Promise<ChannelPayoutRow[]> {
  const { rows } = await db.query<ChannelPayoutRow>(
    `SELECT * FROM channel_payouts
     WHERE status = 'PENDING'::payout_status_enum AND attempts >= $1`,
    [maxAttempts],
  );
  return rows;
}

/**
 * Drop challenges that expired before `cutoff` and were never consumed, so an
 * anonymous caller cannot grow the table without bound. Consumed challenges
 * are kept — payments reference them. Returns the number of rows removed.
 */
export async function deleteExpiredChallenges(db: Queryable, cutoff: Date): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM challenges
     WHERE expires_at < $1
       AND status IN ('PENDING'::challenge_status_enum, 'EXPIRED'::challenge_status_enum)`,
    [cutoff],
  );
  return rowCount ?? 0;
}

export interface CreateEscrowCreditInput {
  sellerId: string;
  /** Network the deposit landed on. */
  network: XrplNetwork;
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
       (seller_id, network, wallet_address, asset, deposit_tx_hash, credits_total)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.sellerId,
      input.network,
      input.walletAddress,
      input.asset,
      input.depositTxHash,
      input.creditsTotal,
    ],
  );
  return rows[0]!;
}

/** Revenue and call count for one asset, within a seller's usage. */
export interface AssetRevenue {
  asset: Asset;
  /** Summed amount in the asset's human unit. */
  amount: string;
  calls: number;
}

export interface UsageSummary {
  totalCalls: number;
  activeWallets: number;
  revenueByAsset: AssetRevenue[];
}

/**
 * Headline metrics for a seller: total metered calls, distinct paying wallets,
 * and revenue broken down per settlement asset.
 */
export async function getUsageSummary(db: Queryable, sellerId: string): Promise<UsageSummary> {
  const totals = await db.query<{ total_calls: number; active_wallets: number }>(
    `SELECT COUNT(*)::int AS total_calls,
            COUNT(DISTINCT wallet_address)::int AS active_wallets
     FROM usage_events
     WHERE seller_id = $1`,
    [sellerId],
  );
  const byAsset = await db.query<AssetRevenue>(
    `SELECT asset,
            COALESCE(SUM(amount), 0)::text AS amount,
            COUNT(*)::int AS calls
     FROM usage_events
     WHERE seller_id = $1
     GROUP BY asset
     ORDER BY asset ASC`,
    [sellerId],
  );
  const row = totals.rows[0]!;
  return {
    totalCalls: row.total_calls,
    activeWallets: row.active_wallets,
    revenueByAsset: byAsset.rows,
  };
}

export interface EndpointUsage {
  endpoint: string;
  calls: number;
  /** Summed amount across all assets (human unit), as a decimal string. */
  revenue: string;
}

/** The busiest endpoints for a seller, most-called first. */
export async function getTopEndpoints(
  db: Queryable,
  sellerId: string,
  limit = 20,
): Promise<EndpointUsage[]> {
  const { rows } = await db.query<EndpointUsage>(
    `SELECT endpoint,
            COUNT(*)::int AS calls,
            COALESCE(SUM(amount), 0)::text AS revenue
     FROM usage_events
     WHERE seller_id = $1
     GROUP BY endpoint
     ORDER BY calls DESC, endpoint ASC
     LIMIT $2`,
    [sellerId, limit],
  );
  return rows;
}

export interface WalletUsage {
  walletAddress: string;
  calls: number;
  /** Summed spend across all assets (human unit), as a decimal string. */
  spend: string;
}

/** Per-wallet call count and spend for a seller, biggest spender first. */
export async function getUsageByWallet(db: Queryable, sellerId: string): Promise<WalletUsage[]> {
  const { rows } = await db.query<{ wallet_address: string; calls: number; spend: string }>(
    `SELECT wallet_address,
            COUNT(*)::int AS calls,
            COALESCE(SUM(amount), 0)::text AS spend
     FROM usage_events
     WHERE seller_id = $1
     GROUP BY wallet_address
     ORDER BY spend DESC, wallet_address ASC`,
    [sellerId],
  );
  return rows.map((r) => ({ walletAddress: r.wallet_address, calls: r.calls, spend: r.spend }));
}

export interface CreateBotInput {
  ownerAddress: string;
  label: string;
  sellerId: string;
  walletAddress: string;
  /** Network this bot transacts on. */
  network: XrplNetwork;
  asset: Asset;
  paymentMode: PaymentMode;
  resource: string;
  sourceTag: number;
  maxAmount: string | null;
  depositAmount: string | null;
  meteredCalls: number;
}

export async function createBot(db: Queryable, input: CreateBotInput): Promise<BotRow> {
  const { rows } = await db.query<BotRow>(
    `INSERT INTO bots
       (owner_address, label, seller_id, wallet_address, network, asset, payment_mode,
        resource, source_tag, max_amount, deposit_amount, metered_calls)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      input.ownerAddress,
      input.label,
      input.sellerId,
      input.walletAddress,
      input.network,
      input.asset,
      input.paymentMode,
      input.resource,
      input.sourceTag,
      input.maxAmount,
      input.depositAmount,
      input.meteredCalls,
    ],
  );
  return rows[0]!;
}

/** All bots owned by an address, newest first. */
export async function listBotsByOwner(db: Queryable, ownerAddress: string): Promise<BotRow[]> {
  const { rows } = await db.query<BotRow>(
    `SELECT * FROM bots WHERE owner_address = $1 ORDER BY created_at DESC`,
    [ownerAddress],
  );
  return rows;
}

export async function getBot(db: Queryable, id: string): Promise<BotRow | null> {
  const { rows } = await db.query<BotRow>(`SELECT * FROM bots WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** Delete a bot, but only if it belongs to `ownerAddress`. Returns true when removed. */
export async function deleteBot(db: Queryable, id: string, ownerAddress: string): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM bots WHERE id = $1 AND owner_address = $2`, [
    id,
    ownerAddress,
  ]);
  return (rowCount ?? 0) > 0;
}

/** Call count and total spend for a single wallet against one seller. */
export interface WalletSpend {
  calls: number;
  /** Summed spend (human unit) across all assets, as a decimal string. */
  spend: string;
}

export async function getWalletSpend(
  db: Queryable,
  sellerId: string,
  walletAddress: string,
): Promise<WalletSpend> {
  const { rows } = await db.query<{ calls: number; spend: string }>(
    `SELECT COUNT(*)::int AS calls, COALESCE(SUM(amount), 0)::text AS spend
     FROM usage_events
     WHERE seller_id = $1 AND wallet_address = $2`,
    [sellerId, walletAddress],
  );
  const row = rows[0]!;
  return { calls: row.calls, spend: row.spend };
}

export async function getEscrowCreditByTxHash(
  db: Queryable,
  network: XrplNetwork,
  depositTxHash: string,
): Promise<EscrowCreditRow | null> {
  const { rows } = await db.query<EscrowCreditRow>(
    `SELECT * FROM escrow_credits WHERE network = $1 AND deposit_tx_hash = $2`,
    [network, depositTxHash],
  );
  return rows[0] ?? null;
}

/**
 * Atomically debit `amount` (human unit) of escrow credits for a wallet, only
 * when the wallet's *combined* unused balance covers it. The debit drains rows
 * oldest-first and may span several deposits (5 + 5 covers an 8 charge).
 * Returns `true` when debited, `false` when the balance is insufficient — the
 * off-ledger debit guard. Rows are locked oldest-first, so concurrent debits
 * for the same wallet serialize instead of double-spending.
 */
export async function debitEscrowCredit(
  db: Queryable,
  sellerId: string,
  walletAddress: string,
  amount: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `WITH locked AS (
       SELECT id, created_at, credits_total, credits_used
       FROM escrow_credits
       WHERE seller_id = $1 AND wallet_address = $2 AND credits_used < credits_total
       ORDER BY created_at ASC, id ASC
       FOR UPDATE
     ),
     ranked AS (
       SELECT id,
              credits_total - credits_used AS available,
              COALESCE(
                SUM(credits_total - credits_used)
                  OVER (ORDER BY created_at ASC, id ASC
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),
                0
              ) AS drained_before
       FROM locked
     ),
     debits AS (
       SELECT id, LEAST(available, $3::numeric - drained_before) AS debit
       FROM ranked
       WHERE drained_before < $3::numeric
     ),
     total AS (
       SELECT COALESCE(SUM(available), 0) AS available FROM ranked
     )
     UPDATE escrow_credits e
     SET credits_used = e.credits_used + debits.debit
     FROM debits, total
     WHERE e.id = debits.id AND total.available >= $3::numeric`,
    [sellerId, walletAddress, amount],
  );
  return (rowCount ?? 0) > 0;
}

export interface InsertAuditLogInput {
  requestId: string;
  method: string;
  route: string | null;
  path: string;
  statusCode: number;
  durationMs: number;
  actorAddress: string | null;
  sellerId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export async function insertAuditLog(db: Queryable, input: InsertAuditLogInput): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs
       (request_id, method, route, path, status_code, duration_ms,
        actor_address, seller_id, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.requestId,
      input.method,
      input.route,
      input.path,
      input.statusCode,
      input.durationMs,
      input.actorAddress,
      input.sellerId,
      input.ip,
      input.userAgent,
    ],
  );
}

/** Admin audit-trail filters; every field is optional and ANDed together. */
export interface AuditLogFilters {
  from?: Date;
  to?: Date;
  method?: string;
  /** Exact matched-route pattern, e.g. `/sellers/:id`. */
  route?: string;
  /** Prefix match on the concrete request path. */
  pathPrefix?: string;
  /** Exact status code; ignored when min/max are also set. */
  status?: number;
  statusMin?: number;
  statusMax?: number;
  actorAddress?: string;
  sellerId?: string;
  requestId?: string;
}

/** Keyset cursor: everything strictly older than this (created_at, id) pair. */
export interface AuditLogCursor {
  createdAt: Date;
  id: string;
}

/** Escape LIKE metacharacters so a prefix filter matches literally. */
function escapeLikePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Page through the audit trail, newest first. Filters are ANDed; pagination is
 * keyset on `(created_at, id)` (matching `audit_logs_created_at_idx`) so deep
 * pages stay cheap as the table grows.
 */
export async function queryAuditLogs(
  db: Queryable,
  filters: AuditLogFilters,
  limit: number,
  cursor?: AuditLogCursor,
): Promise<AuditLogRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.from) clauses.push(`created_at >= ${bind(filters.from)}`);
  if (filters.to) clauses.push(`created_at <= ${bind(filters.to)}`);
  if (filters.method) clauses.push(`method = ${bind(filters.method)}`);
  if (filters.route) clauses.push(`route = ${bind(filters.route)}`);
  if (filters.pathPrefix) clauses.push(`path LIKE ${bind(escapeLikePrefix(filters.pathPrefix))}`);
  if (filters.statusMin !== undefined || filters.statusMax !== undefined) {
    if (filters.statusMin !== undefined) clauses.push(`status_code >= ${bind(filters.statusMin)}`);
    if (filters.statusMax !== undefined) clauses.push(`status_code <= ${bind(filters.statusMax)}`);
  } else if (filters.status !== undefined) {
    clauses.push(`status_code = ${bind(filters.status)}`);
  }
  if (filters.actorAddress) clauses.push(`actor_address = ${bind(filters.actorAddress)}`);
  if (filters.sellerId) clauses.push(`seller_id = ${bind(filters.sellerId)}`);
  if (filters.requestId) clauses.push(`request_id = ${bind(filters.requestId)}`);
  if (cursor) {
    clauses.push(`(created_at, id) < (${bind(cursor.createdAt)}, ${bind(cursor.id)})`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await db.query<AuditLogRow>(
    `SELECT * FROM audit_logs
     ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT ${bind(limit)}`,
    params,
  );
  return rows;
}

/** Prune audit rows older than `cutoff`; returns how many were removed. */
export async function deleteOldAuditLogs(db: Queryable, cutoff: Date): Promise<number> {
  const { rowCount } = await db.query(`DELETE FROM audit_logs WHERE created_at < $1`, [cutoff]);
  return rowCount ?? 0;
}
