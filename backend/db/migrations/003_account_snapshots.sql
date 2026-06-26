-- Daily per-account balance snapshots (for day-over-day change)
CREATE TABLE IF NOT EXISTS account_snapshots (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  balance NUMERIC(12,2) NOT NULL,
  UNIQUE (account_id, date)
);

CREATE INDEX IF NOT EXISTS idx_acct_snapshots ON account_snapshots(account_id, date DESC);
