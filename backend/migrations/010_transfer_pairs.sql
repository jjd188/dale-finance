ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_transfer_pair BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_tx_transfer_pair ON transactions(is_transfer_pair) WHERE is_transfer_pair = TRUE;
