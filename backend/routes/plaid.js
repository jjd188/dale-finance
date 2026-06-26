const express = require('express');
const router = express.Router();
const { PlaidApi, PlaidEnvironments, Configuration, Products, CountryCode } = require('plaid');
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { encrypt, decrypt } = require('../crypto');
require('dotenv').config();

router.use(requireAuth);

const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});
const plaidClient = new PlaidApi(plaidConfig);

// Create a link token to initialize Plaid Link in the frontend
router.post('/create-link-token', async (req, res) => {
  try {
    const userId = req.user.id;
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: String(userId) },
      client_name: 'Dale Finance',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    });
    res.json({ link_token: response.data.link_token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create link token' });
  }
});

// Exchange public token for access token and store it
router.post('/exchange-token', async (req, res) => {
  try {
    const { publicToken, institutionName } = req.body;
    const userId = req.user.id;
    const response = await plaidClient.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = encrypt(response.data.access_token);
    const itemId = response.data.item_id;

    await sql`
      INSERT INTO plaid_items (user_id, access_token, item_id, institution_name)
      VALUES (${userId}, ${accessToken}, ${itemId}, ${institutionName})
      ON CONFLICT (item_id) DO UPDATE SET access_token = ${accessToken}
    `;
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to exchange token' });
  }
});

// Upsert a single transaction (added or modified) into our DB
async function upsertTransaction(tx, userId, acctMap) {
  const accountId = acctMap[tx.account_id];
  if (!accountId) return;
  await sql`
    INSERT INTO transactions (plaid_transaction_id, account_id, user_id, amount, date, merchant, category, pending)
    VALUES (${tx.transaction_id}, ${accountId}, ${userId}, ${tx.amount}, ${tx.date}, ${tx.merchant_name || tx.name}, ${tx.personal_finance_category?.primary || null}, ${tx.pending})
    ON CONFLICT (plaid_transaction_id) DO UPDATE
      SET amount = ${tx.amount}, pending = ${tx.pending},
          merchant = ${tx.merchant_name || tx.name},
          category = ${tx.personal_finance_category?.primary || null}
  `;
}

// Incrementally sync transactions for one item via Plaid's cursor-based endpoint.
// Returns true if synced, false if Plaid isn't ready yet (PRODUCT_NOT_READY).
async function syncItemTransactions(item, userId) {
  const accts = await sql`SELECT id, plaid_account_id FROM accounts WHERE plaid_item_id = ${item.id}`;
  const acctMap = Object.fromEntries(accts.map(a => [a.plaid_account_id, a.id]));
  let cursor = item.transactions_cursor || null;
  let hasMore = true;
  try {
    while (hasMore) {
      const resp = await plaidClient.transactionsSync({
        access_token: item.access_token,
        cursor: cursor || undefined,
      });
      const data = resp.data;
      for (const tx of data.added) await upsertTransaction(tx, userId, acctMap);
      for (const tx of data.modified) await upsertTransaction(tx, userId, acctMap);
      for (const rem of data.removed) await sql`DELETE FROM transactions WHERE plaid_transaction_id = ${rem.transaction_id}`;
      cursor = data.next_cursor;
      hasMore = data.has_more;
    }
    await sql`UPDATE plaid_items SET transactions_cursor = ${cursor} WHERE id = ${item.id}`;
    return true;
  } catch (err) {
    if (err.response?.data?.error_code === 'PRODUCT_NOT_READY') return false;
    throw err;
  }
}

// Sync accounts and transactions for a user
router.post('/sync', async (req, res) => {
  try {
    const userId = req.user.id;
    const items = await sql`SELECT * FROM plaid_items WHERE user_id = ${userId}`;

    let transactionsPending = false;
    for (const item of items) {
      item.access_token = decrypt(item.access_token); // legacy plaintext passes through unchanged
      // Sync accounts (always available, even right after linking)
      const accountsRes = await plaidClient.accountsGet({ access_token: item.access_token });
      for (const acct of accountsRes.data.accounts) {
        await sql`
          INSERT INTO accounts (plaid_account_id, plaid_item_id, user_id, name, type, subtype, balance)
          VALUES (${acct.account_id}, ${item.id}, ${userId}, ${acct.name}, ${acct.type}, ${acct.subtype}, ${acct.balances.current})
          ON CONFLICT (plaid_account_id) DO UPDATE SET balance = ${acct.balances.current}, name = ${acct.name}
        `;
      }

      // Sync transactions incrementally; degrade gracefully if not ready yet
      const ok = await syncItemTransactions(item, userId);
      if (!ok) transactionsPending = true;
    }

    // Capture daily per-account balance snapshots (for day-over-day change)
    await sql`
      INSERT INTO account_snapshots (account_id, date, balance)
      SELECT id, CURRENT_DATE, balance FROM accounts WHERE user_id = ${userId}
      ON CONFLICT (account_id, date) DO UPDATE SET balance = EXCLUDED.balance
    `;

    // Capture a daily net-worth snapshot for this user (assets minus liabilities)
    const [{ net_worth }] = await sql`
      SELECT COALESCE(SUM(
        CASE WHEN type IN ('loan', 'credit') THEN -balance ELSE balance END
      ), 0) AS net_worth
      FROM accounts WHERE user_id = ${userId}
    `;
    await sql`
      INSERT INTO balance_snapshots (user_id, date, net_worth)
      VALUES (${userId}, CURRENT_DATE, ${net_worth})
      ON CONFLICT (user_id, date) DO UPDATE SET net_worth = ${net_worth}
    `;

    res.json({ success: true, transactionsPending });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

module.exports = router;
