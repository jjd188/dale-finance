const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { scopeUserIds } = require('./scope');

router.use(requireAuth);

// Spending by category for a given month (defaults to current month).
// Only outflows (positive Plaid amounts = money leaving the account).
router.get('/spending', async (req, res) => {
  try {
    const userIds = await scopeUserIds(req.user);
    const month = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM
    const rows = await sql`
      SELECT COALESCE(category, 'Uncategorized') AS category,
             SUM(amount) AS total,
             COUNT(*) AS count
      FROM transactions
      WHERE user_id = ANY(${userIds})
        AND amount > 0
        AND to_char(date, 'YYYY-MM') = ${month}
      GROUP BY category
      ORDER BY total DESC
    `;
    res.json({ month, categories: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch spending' });
  }
});

// Net worth over time (sum across in-scope users per day).
router.get('/net-worth', async (req, res) => {
  try {
    const userIds = await scopeUserIds(req.user);
    const days = Math.min(Number(req.query.days) || 90, 365);
    const rows = await sql`
      SELECT date, SUM(net_worth) AS net_worth
      FROM balance_snapshots
      WHERE user_id = ANY(${userIds})
        AND date >= CURRENT_DATE - ${days}::int
      GROUP BY date
      ORDER BY date
    `;
    res.json({ history: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch net worth history' });
  }
});

module.exports = router;
