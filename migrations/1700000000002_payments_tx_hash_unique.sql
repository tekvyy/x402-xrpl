-- Up Migration

-- Double-spend defense in depth (US-008 hardening): a settled on-chain tx hash
-- may back at most one recorded payment. The single-use nonce guard already
-- prevents a challenge from being consumed twice; this constraint additionally
-- makes a duplicate settle of the *same* transaction fail at the database level
-- (unique violation → the settle transaction rolls back and is REJECTED),
-- regardless of which code path attempted the insert.
ALTER TABLE payments ADD CONSTRAINT payments_tx_hash_key UNIQUE (tx_hash);

-- Down Migration

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_tx_hash_key;
