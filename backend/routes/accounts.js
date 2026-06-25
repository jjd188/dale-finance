const express = require('express');
const router = express.Router();
const { sql } = require('../db');

// Get all accounts for a user
router.get('/:userId', async (req, res) => {
  try {
    const accounts = await sql`
      SELECT a.*, pi.institution_name
      FROM accounts a
      JOIN plaid_items pi ON a.plaid_item_id = pi.id
      WHERE a.user_id = ${req.params.userId}
      ORDER BY a.type, a.name
    `;
    res.json(accounts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// Get transactions for a user (with optional filters)
router.get('/:userId/transactions', async (req, res) => {
  try {
    const { limit = 50, offset = 0, accountId } = req.query;
    const transactions = accountId
      ? await sql`
          SELECT * FROM transactions
          WHERE user_id = ${req.params.userId} AND account_id = ${accountId}
          ORDER BY date DESC, id DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      : await sql`
          SELECT t.*, a.name as account_name
          FROM transactions t
          JOIN accounts a ON t.account_id = a.id
          WHERE t.user_id = ${req.params.userId}
          ORDER BY t.date DESC, t.id DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
    res.json(transactions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Get household accounts (parents see all)
router.get('/household/:householdId', async (req, res) => {
  try {
    const accounts = await sql`
      SELECT a.*, u.name as owner_name, pi.institution_name
      FROM accounts a
      JOIN plaid_items pi ON a.plaid_item_id = pi.id
      JOIN users u ON a.user_id = u.id
      JOIN household_members hm ON hm.user_id = a.user_id
      WHERE hm.household_id = ${req.params.householdId}
      ORDER BY u.name, a.type
    `;
    res.json(accounts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch household accounts' });
  }
});

module.exports = router;
