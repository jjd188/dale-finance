const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth, requireParent } = require('../middleware/auth');
const { householdId, visibleAccountIds } = require('./scope');

router.use(requireAuth);

// List budgets with current-month spending progress
router.get('/', async (req, res) => {
  try {
    const hid = await householdId(req.user.id);
    if (!hid) return res.json([]);
    const budgets = await sql`SELECT * FROM budgets WHERE household_id = ${hid} ORDER BY category`;

    // Spend per category this month, scoped to what the requester can see
    const ids = await visibleAccountIds(req.user);
    const month = new Date().toISOString().slice(0, 7);
    const spend = await sql`
      SELECT COALESCE(category, 'Uncategorized') AS category, SUM(amount) AS spent
      FROM transactions
      WHERE account_id = ANY(${ids})
        AND amount > 0 AND to_char(date, 'YYYY-MM') = ${month}
      GROUP BY category
    `;
    const spendMap = Object.fromEntries(spend.map(s => [s.category, Number(s.spent)]));
    res.json(budgets.map(b => ({ ...b, spent: spendMap[b.category] || 0 })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch budgets' });
  }
});

// Create or update a budget (parents only)
router.post('/', requireParent, async (req, res) => {
  try {
    const { category, amount } = req.body;
    if (!category || amount == null) return res.status(400).json({ error: 'category and amount required' });
    const hid = await householdId(req.user.id);
    const [row] = await sql`
      INSERT INTO budgets (household_id, category, amount)
      VALUES (${hid}, ${category}, ${amount})
      ON CONFLICT (household_id, category) DO UPDATE SET amount = ${amount}
      RETURNING *
    `;
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save budget' });
  }
});

// Delete a budget (parents only)
router.delete('/:id', requireParent, async (req, res) => {
  try {
    const hid = await householdId(req.user.id);
    await sql`DELETE FROM budgets WHERE id = ${req.params.id} AND household_id = ${hid}`;
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete budget' });
  }
});

module.exports = router;
