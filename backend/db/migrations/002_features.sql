-- Budgets (household-level, set by parents)
CREATE TABLE IF NOT EXISTS budgets (
  id SERIAL PRIMARY KEY,
  household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  period TEXT NOT NULL DEFAULT 'monthly',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (household_id, category)
);

-- Daily net-worth snapshots per user (household = sum of members)
CREATE TABLE IF NOT EXISTS balance_snapshots (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  net_worth NUMERIC(12,2) NOT NULL,
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_user_date ON balance_snapshots(user_id, date);
