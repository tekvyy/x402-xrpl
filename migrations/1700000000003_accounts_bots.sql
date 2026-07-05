-- Up Migration

-- Sellers are now owned by the XRPL address that registered them (via
-- sign-in-with-XRPL). Nullable so pre-auth/demo rows remain valid.
ALTER TABLE sellers ADD COLUMN owner_address TEXT;
CREATE INDEX sellers_owner_address_idx ON sellers (owner_address);

-- A bot is a saved, self-custody agent configuration owned by a signed-in
-- address. It stores everything needed to run an x402 paying agent EXCEPT the
-- seed — the owner keeps that. `wallet_address` is the bot's public paying
-- address, used to attribute on-chain spend back to the bot for monitoring.
CREATE TABLE bots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_address   TEXT NOT NULL,
  label           TEXT NOT NULL,
  seller_id       UUID NOT NULL REFERENCES sellers (id) ON DELETE CASCADE,
  wallet_address  TEXT NOT NULL,
  asset           asset_enum NOT NULL,
  payment_mode    payment_mode_enum NOT NULL,
  resource        TEXT NOT NULL,
  source_tag      BIGINT NOT NULL,
  -- Per-call spend ceiling (human unit); null = no cap.
  max_amount      NUMERIC(38, 6),
  -- PayChan deposit for prepaid-credits bots (human unit); null otherwise.
  deposit_amount  NUMERIC(38, 6),
  -- How many metered calls a demo run should make.
  metered_calls   INTEGER NOT NULL DEFAULT 20,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bots_owner_address_idx ON bots (owner_address);
CREATE INDEX bots_seller_id_idx ON bots (seller_id);
CREATE INDEX bots_wallet_address_idx ON bots (wallet_address);

-- Down Migration

DROP TABLE IF EXISTS bots;
DROP INDEX IF EXISTS sellers_owner_address_idx;
ALTER TABLE sellers DROP COLUMN IF EXISTS owner_address;
