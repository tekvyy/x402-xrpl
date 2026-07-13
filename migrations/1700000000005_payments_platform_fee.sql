-- Up Migration

-- Platform fee (non-custodial seller fee). On the PayChan credits path the
-- gateway can be the channel destination: it redeems the aggregate claim on
-- chain, forwards the seller's cut, and retains this fee. Recorded per payment
-- for revenue accounting and audit. 0 for every fee-less path (default).
ALTER TABLE payments ADD COLUMN platform_fee NUMERIC(38, 6) NOT NULL DEFAULT 0;

-- Down Migration

ALTER TABLE payments DROP COLUMN IF EXISTS platform_fee;
