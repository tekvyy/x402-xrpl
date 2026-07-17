/**
 * Row shapes returned by Postgres. `NUMERIC` columns come back as strings from
 * `pg` (to preserve precision) and we keep them as strings end-to-end; enum
 * columns are typed with the shared enums so the DB and wire stay in lockstep.
 */
import type {
  Asset,
  ChallengeStatus,
  ChannelStatus,
  PaymentMode,
  PaymentSetup,
  PayoutStatus,
} from '@app/shared';

export interface SellerRow {
  id: string;
  name: string;
  origin_url: string;
  pay_to_address: string;
  /** Price in the asset's human unit (e.g. "0.01" RLUSD, "0.1" XRP). */
  price_amount: string;
  price_asset: Asset;
  /** Which payment modes this seller accepts. */
  payment_mode: PaymentSetup;
  /** XRPL address that registered (owns) this seller; null for legacy rows. */
  owner_address: string | null;
  created_at: Date;
}

export interface BotRow {
  id: string;
  owner_address: string;
  label: string;
  seller_id: string;
  /** The bot's public XRPL paying address (never a seed). */
  wallet_address: string;
  asset: Asset;
  payment_mode: PaymentMode;
  resource: string;
  source_tag: string;
  /** Per-call spend ceiling in the asset's human unit; null = no cap. */
  max_amount: string | null;
  /** PayChan deposit (human unit) for prepaid-credits bots; null otherwise. */
  deposit_amount: string | null;
  metered_calls: number;
  created_at: Date;
}

export interface ChallengeRow {
  id: string;
  nonce: string;
  seller_id: string;
  /** Required amount in the asset's human unit. */
  amount: string;
  asset: Asset;
  status: ChallengeStatus;
  resource: string;
  expires_at: Date;
  created_at: Date;
}

export interface PaymentRow {
  id: string;
  challenge_id: string | null;
  wallet_address: string;
  mode: PaymentMode;
  amount: string;
  asset: Asset;
  tx_hash: string;
  source_tag: string;
  /** Platform fee retained on this payment (human unit); "0" when the path has no fee. */
  platform_fee: string;
  created_at: Date;
}

export interface UsageEventRow {
  id: string;
  seller_id: string;
  wallet_address: string;
  endpoint: string;
  amount: string;
  asset: Asset;
  mode: PaymentMode;
  tx_hash: string | null;
  created_at: Date;
}

export interface ChannelRow {
  id: string;
  channel_id: string;
  wallet_address: string;
  seller_id: string;
  /** Deposit in the asset's human unit (XRP; PayChan is XRP-native). */
  deposit_amount: string;
  asset: Asset;
  /** Total credits available (human unit), equal to the deposit. */
  credits_total: string;
  /** Cumulative credits spent (human unit) — the latest claim's amount. */
  credits_used: string;
  /** Cumulative XRP already redeemed on ledger from accepted claims. */
  redeemed_amount: string;
  /** Latest accepted claim signature; null until the first claim. */
  last_claim_signature: string | null;
  /** Channel signing public key (hex), read from the ledger at registration. */
  public_key: string | null;
  /** PayChan `SettleDelay` (seconds), read from the ledger at registration. */
  settle_delay: number | null;
  /** Immutable `CancelAfter` expiry as a timestamp; null when the channel sets none. */
  cancel_after: Date | null;
  status: ChannelStatus;
  /** When the SETTLING lease was taken; null unless a redemption is in flight. */
  settling_since: Date | null;
  created_at: Date;
}

/** A seller cut owed (or paid) from a channel redemption. */
export interface ChannelPayoutRow {
  id: string;
  channel_id: string;
  seller_id: string;
  /** Seller pay-to address the cut is forwarded to. */
  destination: string;
  /** Owed amount in XRP (human unit). */
  amount: string;
  status: PayoutStatus;
  /** Claim tx that redeemed the funds; null when recovered by reconciliation. */
  redeem_tx_hash: string | null;
  /** Forward Payment hash, written before submission for crash recovery. */
  payout_tx_hash: string | null;
  /** Send attempts so far; exhausted payouts stop auto-retrying. */
  attempts: number;
  /** When the current SENDING claim was taken; null unless in flight. */
  sending_at: Date | null;
  created_at: Date;
  paid_at: Date | null;
}

export interface EscrowCreditRow {
  id: string;
  seller_id: string;
  wallet_address: string;
  asset: Asset;
  deposit_tx_hash: string;
  credits_total: string;
  credits_used: string;
  created_at: Date;
}
