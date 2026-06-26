const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { scopeUserIds } = require('./scope');

router.use(requireAuth);

// Helper: get the household id for the current user
async function householdId(userId) {
  const rows = await sql`SELECT household_id FROM household_members WHERE user_id = ${userId} LIMIT 1`;
  return rows.length ? rows[0].household_id : null;
}

// Get accounts — parents see the whole household, kids see only their own
router.get('/', async (req, res) => {
  try {
    const userIds = await scopeUserIds(req.user);
    // prev_balance = most recent snapshot strictly before today, for day-over-day change
    const accounts = await sql`
      SELECT a.*, u.name as owner_name, pi.institution_name, prev.prev_balance
      FROM accounts a
      JOIN plaid_items pi ON a.plaid_item_id = pi.id
      JOIN users u ON a.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT s.balance AS prev_balance
        FROM account_snapshots s
        WHERE s.account_id = a.id AND s.date < CURRENT_DATE
        ORDER BY s.date DESC
        LIMIT 1
      ) prev ON true
      WHERE a.user_id = ANY(${userIds})
        AND (a.is_private = false OR a.user_id = ${req.user.id})
      ORDER BY u.name, a.type, a.name
    `;
    res.json(accounts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// Get transactions — parents see household, kids see only their own
router.get('/transactions', async (req, res) => {
  try {
    const userIds = await scopeUserIds(req.user);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    // Optional drill-down filters (null = match all)
    const category = req.query.category || null;
    const month = req.query.month || null; // YYYY-MM
    const transactions = await sql`
      SELECT t.*, a.name as account_name, u.name as owner_name
      FROM transactions t
      JOIN accounts a ON t.account_id = a.id
      JOIN users u ON t.user_id = u.id
      WHERE t.user_id = ANY(${userIds})
        AND (a.is_private = false OR a.user_id = ${req.user.id})
        AND (${category}::text IS NULL OR COALESCE(t.category, 'Uncategorized') = ${category})
        AND (${month}::text IS NULL OR to_char(t.date, 'YYYY-MM') = ${month})
      ORDER BY t.date DESC, t.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    res.json(transactions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Toggle an account's privacy (owner only)
router.patch('/:id/privacy', async (req, res) => {
  try {
    const { is_private } = req.body;
    const result = await sql`
      UPDATE accounts SET is_private = ${!!is_private}
      WHERE id = ${req.params.id} AND user_id = ${req.user.id}
      RETURNING id
    `;
    if (!result.length) return res.status(404).json({ error: 'Account not found or not yours' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update privacy' });
  }
});

// Return the current user's profile (used by the frontend after login)
router.get('/me', async (req, res) => {
  res.json(req.user);
});

module.exports = router;
