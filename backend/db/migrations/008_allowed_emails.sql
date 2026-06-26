-- Invite/allowlist: pre-authorized emails who may access the app
CREATE TABLE IF NOT EXISTS allowed_emails (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'kid' CHECK (role IN ('parent', 'kid')),
  household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
