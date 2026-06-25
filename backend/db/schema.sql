-- Users (synced from Neon Auth)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  auth_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'kid' CHECK (role IN ('parent', 'kid')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Households
CREATE TABLE IF NOT EXISTS households (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Household membership
CREATE TABLE IF NOT EXISTS household_members (
  household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (household_id, user_id)
);

-- Plaid connections (one per linked bank)
CREATE TABLE IF NOT EXISTS plaid_items (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  item_id TEXT UNIQUE NOT NULL,
  institution_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Bank accounts
CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  plaid_account_id TEXT UNIQUE NOT NULL,
  plaid_item_id INTEGER REFERENCES plaid_items(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  subtype TEXT,
  balance NUMERIC(12,2),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  plaid_transaction_id TEXT UNIQUE NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  date DATE NOT NULL,
  merchant TEXT,
  category TEXT,
  pending BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
