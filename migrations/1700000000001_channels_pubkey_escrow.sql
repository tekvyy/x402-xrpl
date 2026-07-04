-- Up Migration

-- PayChan claims are verified against the channel's signing public key, set at
-- creation time. Storing it keeps per-call claim verification a pure DB read
-- (no ledger round-trip on the off-ledger fast path).
ALTER TABLE channels ADD COLUMN public_key TEXT;

-- Escrow fallback (config-gated, demo insurance only): a simple custodial
-- credits ledger. A wallet deposits an asset to the gateway wallet once, then
-- spends credits off-ledger. Kept in its own table so it never touches the
-- PayChan path.
CREATE TABLE escrow_credits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID NOT NULL REFERENCES sellers (id) ON DELETE CASCADE,
  wallet_address  TEXT NOT NULL,
  asset           asset_enum NOT NULL,
  deposit_tx_hash TEXT NOT NULL UNIQUE,
  credits_total   NUMERIC(38, 6) NOT NULL,
  credits_used    NUMERIC(38, 6) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX escrow_credits_seller_wallet_idx
  ON escrow_credits (seller_id, wallet_address);

-- Down Migration

DROP TABLE IF EXISTS escrow_credits;
ALTER TABLE channels DROP COLUMN IF EXISTS public_key;
