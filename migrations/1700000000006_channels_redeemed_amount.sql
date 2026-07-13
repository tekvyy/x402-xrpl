-- Up Migration

-- PayChan Amount and Balance are cumulative. Keep the amount already redeemed
-- separately from the newest authorized claim so later redemption forwards only
-- the newly delivered delta.
ALTER TABLE channels
  ADD COLUMN redeemed_amount NUMERIC(38, 6) NOT NULL DEFAULT 0;

-- Down Migration

ALTER TABLE channels DROP COLUMN IF EXISTS redeemed_amount;
