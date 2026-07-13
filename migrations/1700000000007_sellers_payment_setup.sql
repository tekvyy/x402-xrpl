-- Up Migration

-- Sellers choose a payment *setup* (which modes they accept) rather than a
-- single mode: PAY_PER_CALL (traditional, one on-chain tx per call),
-- PREPAID_CREDITS (off-ledger PayChan claims), or BOTH. Individual payments
-- and usage events keep the binary payment_mode_enum — each settles in
-- exactly one mode.
CREATE TYPE payment_setup_enum AS ENUM ('PAY_PER_CALL', 'PREPAID_CREDITS', 'BOTH');

ALTER TABLE sellers
  ALTER COLUMN payment_mode TYPE payment_setup_enum
  USING payment_mode::text::payment_setup_enum;

-- Down Migration

ALTER TABLE sellers
  ALTER COLUMN payment_mode TYPE payment_mode_enum
  USING (CASE WHEN payment_mode::text = 'BOTH' THEN 'PAY_PER_CALL' ELSE payment_mode::text END)::payment_mode_enum;

DROP TYPE IF EXISTS payment_setup_enum;
