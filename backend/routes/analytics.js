const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { visibleAccountIds } = require('./scope');

router.use(requireAuth);

// Spending by category for a given month (defaults to current month).
// Only outflows (positive Plaid amounts = money leaving the account).
router.get('/spending', async (req, res) => {
  try {
    const ids = await visibleAccountIds(req.user);
    const month = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM
    const rows = await sql`
      SELECT COALESCE(category, 'Uncategorized') AS category,
             SUM(amount) AS total,
             COUNT(*) AS count
      FROM transactions
      WHERE account_id = ANY(${ids})
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

// Spending for a whole year: by category + monthly totals trend.
router.get('/spending/yearly', async (req, res) => {
  try {
    const ids = await visibleAccountIds(req.user);
    const year = String(req.query.year || new Date().getFullYear());
    const categories = await sql`
      SELECT COALESCE(category, 'Uncategorized') AS category, SUM(amount) AS total, COUNT(*) AS count
      FROM transactions
      WHERE account_id = ANY(${ids}) AND amount > 0 AND to_char(date, 'YYYY') = ${year}
      GROUP BY category
      ORDER BY total DESC
    `;
    const monthly = await sql`
      SELECT to_char(date, 'MM') AS month, SUM(amount) AS total
      FROM transactions
      WHERE account_id = ANY(${ids}) AND amount > 0 AND to_char(date, 'YYYY') = ${year}
      GROUP BY month
      ORDER BY month
    `;
    res.json({ year, categories, monthly });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch yearly spending' });
  }
});

// Net worth over time (sum across in-scope users per day).
router.get('/net-worth', async (req, res) => {
  try {
    const ids = await visibleAccountIds(req.user);
    const days = Math.min(Number(req.query.days) || 90, 365);
    // Derive from per-account snapshots so shares + asset/liability signs are respected
    const rows = await sql`
      SELECT s.date,
             SUM(CASE WHEN a.type IN ('loan', 'credit') THEN -s.balance ELSE s.balance END) AS net_worth
      FROM account_snapshots s
      JOIN accounts a ON s.account_id = a.id
      WHERE s.account_id = ANY(${ids})
        AND s.date >= CURRENT_DATE - ${days}::int
      GROUP BY s.date
      ORDER BY s.date
    `;
    res.json({ history: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch net worth history' });
  }
});

module.exports = router;
