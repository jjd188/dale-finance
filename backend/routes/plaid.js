const express = require('express');
const router = express.Router();
const { PlaidApi, PlaidEnvironments, Configuration, Products, CountryCode } = require('plaid');
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');
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
    const accessToken = response.data.access_token;
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

// Sync accounts and transactions for a user
router.post('/sync', async (req, res) => {
  try {
    const userId = req.user.id;
    const items = await sql`SELECT * FROM plaid_items WHERE user_id = ${userId}`;

    for (const item of items) {
      // Sync accounts
      const accountsRes = await plaidClient.accountsGet({ access_token: item.access_token });
      for (const acct of accountsRes.data.accounts) {
        await sql`
          INSERT INTO accounts (plaid_account_id, plaid_item_id, user_id, name, type, subtype, balance)
          VALUES (${acct.account_id}, ${item.id}, ${userId}, ${acct.name}, ${acct.type}, ${acct.subtype}, ${acct.balances.current})
          ON CONFLICT (plaid_account_id) DO UPDATE SET balance = ${acct.balances.current}, name = ${acct.name}
        `;
      }

      // Sync transactions (last 30 days)
      const start = new Date(); start.setDate(start.getDate() - 30);
      const txRes = await plaidClient.transactionsGet({
        access_token: item.access_token,
        start_date: start.toISOString().split('T')[0],
        end_date: new Date().toISOString().split('T')[0],
      });
      for (const tx of txRes.data.transactions) {
        const account = await sql`SELECT id FROM accounts WHERE plaid_account_id = ${tx.account_id} LIMIT 1`;
        if (!account.length) continue;
        await sql`
          INSERT INTO transactions (plaid_transaction_id, account_id, user_id, amount, date, merchant, category, pending)
          VALUES (${tx.transaction_id}, ${account[0].id}, ${userId}, ${tx.amount}, ${tx.date}, ${tx.merchant_name || tx.name}, ${tx.personal_finance_category?.primary || null}, ${tx.pending})
          ON CONFLICT (plaid_transaction_id) DO UPDATE SET amount = ${tx.amount}, pending = ${tx.pending}
        `;
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

module.exports = router;
