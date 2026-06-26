-- Accounts a parent explicitly shares onto a kid's dashboard
CREATE TABLE IF NOT EXISTS account_shares (
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  shared_with_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  shared_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (account_id, shared_with_user_id)
);
