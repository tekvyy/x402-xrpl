/**
 * Row shapes returned by Postgres. `NUMERIC` columns come back as strings from
 * `pg` (to preserve precision) and we keep them as strings end-to-end; enum
 * columns are typed with the shared enums so the DB and wire stay in lockstep.
 */
import type { Asset, ChallengeStatus, PaymentMode } from '@app/shared';

export interface SellerRow {
  id: string;
  name: string;
  origin_url: string;
  pay_to_address: string;
  /** Price in the asset's human unit (e.g. "0.01" RLUSD, "0.1" XRP). */
  price_amount: string;
  price_asset: Asset;
  payment_mode: PaymentMode;
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
