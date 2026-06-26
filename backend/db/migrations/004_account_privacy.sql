-- Per-account privacy: when true, only the owner can see it (hidden from household/parent views)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;
