-- Track when each item last hit Plaid, to throttle auto-sync to once/day
ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
