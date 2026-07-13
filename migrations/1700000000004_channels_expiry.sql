-- Up Migration

-- PayChan expiry guard. A channel owner can force-close and reclaim the unspent
-- deposit at `close_time + SettleDelay`, or immediately once `CancelAfter`
-- passes. The gateway delivers value off-ledger *before* redeeming on chain, so
-- it must reject channels whose expiry leaves too little runway to redeem. Store
-- both at registration (read from the ledger) so per-call claim verification can
-- enforce the runway without a ledger round-trip. `cancel_after` is the immutable
-- CancelAfter converted to a timestamp; NULL when the channel sets none.
ALTER TABLE channels ADD COLUMN settle_delay INTEGER;
ALTER TABLE channels ADD COLUMN cancel_after TIMESTAMPTZ;

-- Down Migration

ALTER TABLE channels DROP COLUMN IF EXISTS cancel_after;
ALTER TABLE channels DROP COLUMN IF EXISTS settle_delay;
