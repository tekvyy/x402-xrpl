-- Up Migration

-- Enum types mirror packages/shared/src/enums.ts (keep in lockstep).
CREATE TYPE asset_enum AS ENUM ('RLUSD', 'XRP');
CREATE TYPE payment_mode_enum AS ENUM ('PAY_PER_CALL', 'PREPAID_CREDITS');
CREATE TYPE challenge_status_enum AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CONSUMED');
CREATE TYPE channel_status_enum AS ENUM ('OPEN', 'SETTLING', 'CLOSED');

CREATE TABLE sellers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  origin_url      TEXT NOT NULL,
  pay_to_address  TEXT NOT NULL,
  price_amount    NUMERIC(38, 6) NOT NULL,
  price_asset     asset_enum NOT NULL,
  payment_mode    payment_mode_enum NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE challenges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce       TEXT NOT NULL UNIQUE,
  seller_id   UUID NOT NULL REFERENCES sellers (id) ON DELETE CASCADE,
  amount      NUMERIC(38, 6) NOT NULL,
  asset       asset_enum NOT NULL,
  status      challenge_status_enum NOT NULL DEFAULT 'PENDING',
  resource    TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX challenges_seller_id_idx ON challenges (seller_id);

CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id    UUID REFERENCES challenges (id) ON DELETE SET NULL,
  wallet_address  TEXT NOT NULL,
  mode            payment_mode_enum NOT NULL,
  amount          NUMERIC(38, 6) NOT NULL,
  asset           asset_enum NOT NULL,
  tx_hash         TEXT NOT NULL,
  source_tag      BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_wallet_address_idx ON payments (wallet_address);

CREATE TABLE channels (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id            TEXT NOT NULL UNIQUE,
  wallet_address        TEXT NOT NULL,
  seller_id             UUID NOT NULL REFERENCES sellers (id) ON DELETE CASCADE,
  deposit_amount        NUMERIC(38, 6) NOT NULL,
  asset                 asset_enum NOT NULL,
  credits_total         NUMERIC(38, 6) NOT NULL,
  credits_used          NUMERIC(38, 6) NOT NULL DEFAULT 0,
  last_claim_signature  TEXT,
  status                channel_status_enum NOT NULL DEFAULT 'OPEN',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX channels_seller_id_idx ON channels (seller_id);

CREATE TABLE usage_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID NOT NULL REFERENCES sellers (id) ON DELETE CASCADE,
  wallet_address  TEXT NOT NULL,
  endpoint        TEXT NOT NULL,
  amount          NUMERIC(38, 6) NOT NULL,
  asset           asset_enum NOT NULL,
  mode            payment_mode_enum NOT NULL,
  tx_hash         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_seller_id_idx ON usage_events (seller_id);
CREATE INDEX usage_events_created_at_idx ON usage_events (created_at);

-- Down Migration

DROP TABLE IF EXISTS usage_events;
DROP TABLE IF EXISTS channels;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS challenges;
DROP TABLE IF EXISTS sellers;
DROP TYPE IF EXISTS channel_status_enum;
DROP TYPE IF EXISTS challenge_status_enum;
DROP TYPE IF EXISTS payment_mode_enum;
DROP TYPE IF EXISTS asset_enum;
