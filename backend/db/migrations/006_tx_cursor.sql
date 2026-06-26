-- Cursor for Plaid's incremental /transactions/sync per linked item
ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS transactions_cursor TEXT;
