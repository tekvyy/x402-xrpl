-- Up Migration

-- Matches the /usage/history keyset pagination: newest-first per seller with
-- (created_at, id) as the cursor.
CREATE INDEX usage_events_seller_created_idx
  ON usage_events (seller_id, created_at DESC, id DESC);

-- Down Migration

DROP INDEX IF EXISTS usage_events_seller_created_idx;
