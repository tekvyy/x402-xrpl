-- Up Migration

-- Mirrors PayoutStatus in packages/shared/src/enums.ts (keep in lockstep).
CREATE TYPE payout_status_enum AS ENUM ('PENDING', 'SENDING', 'PAID');

-- Durable ledger of seller cuts owed from channel redemptions. The gateway is
-- the PayChan destination, so every on-chain claim lands in the gateway wallet
-- and the seller's share must be forwarded; recording that debt *in the same
-- transaction* as the redemption watermark means a failed forward is retried
-- by the maintenance sweep instead of silently underpaying the seller.
CREATE TABLE channel_payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id      TEXT NOT NULL REFERENCES channels (channel_id) ON DELETE CASCADE,
  seller_id       UUID NOT NULL REFERENCES sellers (id) ON DELETE CASCADE,
  destination     TEXT NOT NULL,
  amount          NUMERIC(38, 6) NOT NULL,
  status          payout_status_enum NOT NULL DEFAULT 'PENDING',
  -- Claim tx that redeemed the funds; null when recovered by reconciliation
  -- (the redeeming tx hash was lost with the crash).
  redeem_tx_hash  TEXT,
  -- Hash of the forward Payment. Written BEFORE submission (the local signing
  -- hash), so an ambiguous submit error can later be resolved from the ledger.
  payout_tx_hash  TEXT,
  -- How many send attempts have been made; exhausted payouts stop auto-retrying.
  attempts        INT NOT NULL DEFAULT 0,
  -- When the current SENDING claim was taken (drives in-flight resolution).
  sending_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ
);
CREATE INDEX channel_payouts_status_idx ON channel_payouts (status);

-- When the SETTLING lease was taken, so the maintenance sweep can distinguish
-- an in-flight redemption from one stranded by a crash.
ALTER TABLE channels
  ADD COLUMN settling_since TIMESTAMPTZ;

-- The expired-challenge sweep filters on expiry.
CREATE INDEX challenges_expires_at_idx ON challenges (expires_at);

-- Down Migration

DROP INDEX IF EXISTS challenges_expires_at_idx;
ALTER TABLE channels DROP COLUMN IF EXISTS settling_since;
DROP TABLE IF EXISTS channel_payouts;
DROP TYPE IF EXISTS payout_status_enum;
