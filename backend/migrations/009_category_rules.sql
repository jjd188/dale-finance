-- Stores per-household merchant → category overrides.
-- Applied automatically during transaction sync so future imports self-categorize.
CREATE TABLE IF NOT EXISTS category_rules (
  id SERIAL PRIMARY KEY,
  household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  merchant TEXT NOT NULL,
  category TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(household_id, merchant)
);

CREATE INDEX IF NOT EXISTS idx_category_rules_household ON category_rules(household_id);
