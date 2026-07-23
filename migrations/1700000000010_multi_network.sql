-- Up Migration

-- Multi-network support: one deployment now serves MAINNET and TESTNET at the
-- same time, so every network-scoped row records which ledger it belongs to.
--
-- Backfill: every row that exists today was created by a TESTNET-only
-- deployment, so each column is added with DEFAULT 'TESTNET' (correct for all
-- existing rows) and the default is then dropped so the application must be
-- explicit going forward.

-- Mirrors XrplNetwork in packages/shared/src/enums.ts (keep in lockstep).
CREATE TYPE xrpl_network_enum AS ENUM ('MAINNET', 'TESTNET');

-- A seller advertises its API on one or more networks; the 402 `accepts[]`
-- array carries one group of entries per network in this list. Kept as an
-- array (rather than a row per network) so a seller stays a single object the
-- owner manages, matching the x402 spec's multi-option `accepts[]` shape.
--
-- TEXT[] rather than xrpl_network_enum[] on purpose: node-postgres ships array
-- parsers only for built-in types, and a custom enum's array OID is assigned
-- per database, so `xrpl_network_enum[]` comes back to the app as the raw
-- string '{TESTNET}' instead of an array. TEXT[] (OID 1009) parses natively.
-- The CHECK below keeps the same validation the enum would have given.
ALTER TABLE sellers
  ADD COLUMN networks TEXT[] NOT NULL DEFAULT ARRAY['TESTNET'];
ALTER TABLE sellers ALTER COLUMN networks DROP DEFAULT;
ALTER TABLE sellers
  ADD CONSTRAINT sellers_networks_valid CHECK (
    cardinality(networks) > 0
    AND networks <@ ARRAY['MAINNET', 'TESTNET']
  );

-- The challenge is where the network becomes immutable. `issueChallenge`
-- writes one challenge row per network with its own nonce, so the single-use
-- nonce ledger doubles as the network binding: settle resolves the network
-- from the challenge it looked up, never from process config. This is what
-- prevents a free testnet payment from ever satisfying a mainnet challenge.
ALTER TABLE challenges
  ADD COLUMN network xrpl_network_enum NOT NULL DEFAULT 'TESTNET';
ALTER TABLE challenges ALTER COLUMN network DROP DEFAULT;

ALTER TABLE payments
  ADD COLUMN network xrpl_network_enum NOT NULL DEFAULT 'TESTNET';
ALTER TABLE payments ALTER COLUMN network DROP DEFAULT;

ALTER TABLE channels
  ADD COLUMN network xrpl_network_enum NOT NULL DEFAULT 'TESTNET';
ALTER TABLE channels ALTER COLUMN network DROP DEFAULT;

ALTER TABLE usage_events
  ADD COLUMN network xrpl_network_enum NOT NULL DEFAULT 'TESTNET';
ALTER TABLE usage_events ALTER COLUMN network DROP DEFAULT;

ALTER TABLE escrow_credits
  ADD COLUMN network xrpl_network_enum NOT NULL DEFAULT 'TESTNET';
ALTER TABLE escrow_credits ALTER COLUMN network DROP DEFAULT;

ALTER TABLE bots
  ADD COLUMN network xrpl_network_enum NOT NULL DEFAULT 'TESTNET';
ALTER TABLE bots ALTER COLUMN network DROP DEFAULT;

ALTER TABLE channel_payouts
  ADD COLUMN network xrpl_network_enum NOT NULL DEFAULT 'TESTNET';
ALTER TABLE channel_payouts ALTER COLUMN network DROP DEFAULT;

-- Re-scope the on-ledger uniqueness constraints. A transaction hash and a
-- channel id are only unique *within* a ledger, so a global UNIQUE would let a
-- testnet hash block the settlement of an unrelated mainnet payment carrying
-- the same hash (and vice versa). Every one of these must become composite.

ALTER TABLE payments DROP CONSTRAINT payments_tx_hash_key;
ALTER TABLE payments ADD CONSTRAINT payments_network_tx_hash_key UNIQUE (network, tx_hash);

ALTER TABLE escrow_credits DROP CONSTRAINT escrow_credits_deposit_tx_hash_key;
ALTER TABLE escrow_credits
  ADD CONSTRAINT escrow_credits_network_deposit_tx_hash_key UNIQUE (network, deposit_tx_hash);

-- channels.channel_id is referenced by channel_payouts, and a foreign key
-- requires a unique constraint on the referenced columns — so the dependent FK
-- has to be dropped and rebuilt as a composite alongside it.
ALTER TABLE channel_payouts DROP CONSTRAINT channel_payouts_channel_id_fkey;
ALTER TABLE channels DROP CONSTRAINT channels_channel_id_key;
ALTER TABLE channels ADD CONSTRAINT channels_network_channel_id_key UNIQUE (network, channel_id);
ALTER TABLE channel_payouts
  ADD CONSTRAINT channel_payouts_network_channel_id_fkey
  FOREIGN KEY (network, channel_id) REFERENCES channels (network, channel_id) ON DELETE CASCADE;

-- challenges.nonce stays globally UNIQUE on purpose: it is a gateway-generated
-- randomUUID, not a ledger identifier, and keeping it global means a nonce can
-- never be replayed across networks even if the network binding were wrong.

-- The maintenance sweeps select work per network, so keep those scans indexed.
CREATE INDEX channels_network_status_idx ON channels (network, status);
CREATE INDEX channel_payouts_network_status_idx ON channel_payouts (network, status);
CREATE INDEX usage_events_network_idx ON usage_events (network);

-- Down Migration

DROP INDEX IF EXISTS usage_events_network_idx;
DROP INDEX IF EXISTS channel_payouts_network_status_idx;
DROP INDEX IF EXISTS channels_network_status_idx;

ALTER TABLE channel_payouts DROP CONSTRAINT IF EXISTS channel_payouts_network_channel_id_fkey;
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_network_channel_id_key;
ALTER TABLE channels ADD CONSTRAINT channels_channel_id_key UNIQUE (channel_id);
ALTER TABLE channel_payouts
  ADD CONSTRAINT channel_payouts_channel_id_fkey
  FOREIGN KEY (channel_id) REFERENCES channels (channel_id) ON DELETE CASCADE;

ALTER TABLE escrow_credits DROP CONSTRAINT IF EXISTS escrow_credits_network_deposit_tx_hash_key;
ALTER TABLE escrow_credits ADD CONSTRAINT escrow_credits_deposit_tx_hash_key UNIQUE (deposit_tx_hash);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_network_tx_hash_key;
ALTER TABLE payments ADD CONSTRAINT payments_tx_hash_key UNIQUE (tx_hash);

ALTER TABLE channel_payouts DROP COLUMN IF EXISTS network;
ALTER TABLE bots DROP COLUMN IF EXISTS network;
ALTER TABLE escrow_credits DROP COLUMN IF EXISTS network;
ALTER TABLE usage_events DROP COLUMN IF EXISTS network;
ALTER TABLE channels DROP COLUMN IF EXISTS network;
ALTER TABLE payments DROP COLUMN IF EXISTS network;
ALTER TABLE challenges DROP COLUMN IF EXISTS network;
ALTER TABLE sellers DROP CONSTRAINT IF EXISTS sellers_networks_valid;
ALTER TABLE sellers DROP COLUMN IF EXISTS networks;

DROP TYPE IF EXISTS xrpl_network_enum;
