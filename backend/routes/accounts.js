const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// Helper: get the household id for the current user
async function householdId(userId) {
  const rows = await sql`SELECT household_id FROM household_members WHERE user_id = ${userId} LIMIT 1`;
  return rows.length ? rows[0].household_id : null;
}

// Get accounts — parents see the whole household, kids see only their own
router.get('/', async (req, res) => {
  try {
    const { id, role } = req.user;
    let accounts;
    if (role === 'parent') {
      const hid = await householdId(id);
      accounts = await sql`
        SELECT a.*, u.name as owner_name, pi.institution_name
        FROM accounts a
        JOIN plaid_items pi ON a.plaid_item_id = pi.id
        JOIN users u ON a.user_id = u.id
        JOIN household_members hm ON hm.user_id = a.user_id
        WHERE hm.household_id = ${hid}
        ORDER BY u.name, a.type
      `;
    } else {
      accounts = await sql`
        SELECT a.*, u.name as owner_name, pi.institution_name
        FROM accounts a
        JOIN plaid_items pi ON a.plaid_item_id = pi.id
        JOIN users u ON a.user_id = u.id
        WHERE a.user_id = ${id}
        ORDER BY a.type, a.name
      `;
    }
    res.json(accounts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// Get transactions — parents see household, kids see only their own
router.get('/transactions', async (req, res) => {
  try {
    const { id, role } = req.user;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    let transactions;
    if (role === 'parent') {
      const hid = await householdId(id);
      transactions = await sql`
        SELECT t.*, a.name as account_name, u.name as owner_name
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        JOIN users u ON t.user_id = u.id
        JOIN household_members hm ON hm.user_id = t.user_id
        WHERE hm.household_id = ${hid}
        ORDER BY t.date DESC, t.id DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      transactions = await sql`
        SELECT t.*, a.name as account_name, u.name as owner_name
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        JOIN users u ON t.user_id = u.id
        WHERE t.user_id = ${id}
        ORDER BY t.date DESC, t.id DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }
    res.json(transactions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Return the current user's profile (used by the frontend after login)
router.get('/me', async (req, res) => {
  res.json(req.user);
});

module.exports = router;
