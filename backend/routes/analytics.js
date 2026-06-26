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

// Projected available balance through end of month for depository (checking/savings) accounts.
// Model: average daily net cash flow over the last 30 days, projected linearly to month end.
router.get('/projection', async (req, res) => {
  try {
    const ids = await visibleAccountIds(req.user);
    const accounts = await sql`
      SELECT id, name, balance FROM accounts
      WHERE id = ANY(${ids}) AND type = 'depository'
      ORDER BY name
    `;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const daysRemaining = Math.round((endOfMonth - today) / 86400000);

    if (!accounts.length) {
      return res.json({ asOf: today.toISOString().slice(0, 10), endOfMonth: endOfMonth.toISOString().slice(0, 10), accounts: [], series: [] });
    }

    const acctIds = accounts.map(a => a.id);
    // Plaid convention: positive amount = money out, negative = money in.
    const flows = await sql`
      SELECT account_id, COALESCE(SUM(amount), 0) AS net_out
      FROM transactions
      WHERE account_id = ANY(${acctIds}) AND date >= CURRENT_DATE - 30
      GROUP BY account_id
    `;
    const flowMap = Object.fromEntries(flows.map(f => [f.account_id, Number(f.net_out)]));

    const perAccount = accounts.map(a => {
      const dailyNet = -(flowMap[a.id] || 0) / 30; // + = balance trends up, - = down
      const projectedEnd = Number(a.balance) + dailyNet * daysRemaining;
      return { id: a.id, name: a.name, current: Number(a.balance), dailyNet, projectedEnd };
    });

    // Aggregate available-balance series, one point per remaining day
    const series = [];
    for (let i = 0; i <= daysRemaining; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      const total = perAccount.reduce((s, a) => s + (a.current + a.dailyNet * i), 0);
      series.push({ date: d.toISOString().slice(0, 10), total });
    }

    res.json({ asOf: today.toISOString().slice(0, 10), endOfMonth: endOfMonth.toISOString().slice(0, 10), accounts: perAccount, series });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to compute projection' });
  }
});

module.exports = router;
