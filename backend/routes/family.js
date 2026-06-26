const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth, requireParent } = require('../middleware/auth');
const { householdId, visibleAccountIds } = require('./scope');

router.use(requireAuth);

// List household members (parents only)
router.get('/', requireParent, async (req, res) => {
  try {
    const hid = await householdId(req.user.id);
    if (!hid) return res.json([]);
    const members = await sql`
      SELECT u.id, u.name, u.email, u.role
      FROM users u
      JOIN household_members hm ON hm.user_id = u.id
      WHERE hm.household_id = ${hid}
      ORDER BY u.role, u.name
    `;
    res.json(members);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch family' });
  }
});

// Invite a member by email. If they already have an account, attach them now;
// otherwise pre-authorize their email so they can sign up (invite-only gate).
router.post('/invite', requireParent, async (req, res) => {
  try {
    const { email } = req.body;
    const role = req.body.role === 'parent' ? 'parent' : 'kid';
    if (!email) return res.status(400).json({ error: 'email required' });
    const hid = await householdId(req.user.id);
    const user = await sql`SELECT id FROM users WHERE lower(email) = lower(${email}) LIMIT 1`;
    if (user.length) {
      await sql`UPDATE users SET role = ${role} WHERE id = ${user[0].id}`;
      await sql`INSERT INTO household_members (household_id, user_id) VALUES (${hid}, ${user[0].id}) ON CONFLICT DO NOTHING`;
      return res.json({ status: 'added' });
    }
    await sql`
      INSERT INTO allowed_emails (email, role, household_id, invited_by)
      VALUES (${email}, ${role}, ${hid}, ${req.user.id})
      ON CONFLICT (email) DO UPDATE SET role = ${role}, household_id = ${hid}, invited_by = ${req.user.id}
    `;
    res.json({ status: 'invited' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to invite' });
  }
});

// List pending invitations (not yet signed up) for this household
router.get('/invites', requireParent, async (req, res) => {
  try {
    const hid = await householdId(req.user.id);
    const invites = await sql`SELECT email, role, created_at FROM allowed_emails WHERE household_id = ${hid} ORDER BY created_at`;
    res.json(invites);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

// Revoke a pending invitation
router.delete('/invite/:email', requireParent, async (req, res) => {
  try {
    const hid = await householdId(req.user.id);
    await sql`DELETE FROM allowed_emails WHERE lower(email) = lower(${req.params.email}) AND household_id = ${hid}`;
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to revoke invite' });
  }
});

// Change a member's role (parents only)
router.patch('/:id/role', requireParent, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['parent', 'kid'].includes(role)) return res.status(400).json({ error: 'invalid role' });
    if (Number(req.params.id) === req.user.id && role !== 'parent') {
      return res.status(400).json({ error: "You can't demote yourself" });
    }
    const hid = await householdId(req.user.id);
    await sql`
      UPDATE users SET role = ${role}
      WHERE id = ${req.params.id}
        AND id IN (SELECT user_id FROM household_members WHERE household_id = ${hid})
    `;
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// Helper: confirm a user is in the requesting parent's household
async function inHousehold(parentId, memberId) {
  const hid = await householdId(parentId);
  if (!hid) return false;
  const rows = await sql`SELECT 1 FROM household_members WHERE household_id = ${hid} AND user_id = ${memberId}`;
  return rows.length > 0;
}

// List accounts a parent can share, flagged with whether they're already shared with this member
router.get('/:memberId/shares', requireParent, async (req, res) => {
  try {
    if (!(await inHousehold(req.user.id, req.params.memberId))) return res.status(404).json({ error: 'Not in your household' });
    const visible = await visibleAccountIds(req.user);
    const accounts = await sql`
      SELECT a.id, a.name, a.type, u.name AS owner_name, pi.institution_name
      FROM accounts a
      JOIN users u ON a.user_id = u.id
      JOIN plaid_items pi ON a.plaid_item_id = pi.id
      WHERE a.id = ANY(${visible}) AND a.user_id <> ${req.params.memberId}
      ORDER BY u.name, a.name
    `;
    const shared = (await sql`SELECT account_id FROM account_shares WHERE shared_with_user_id = ${req.params.memberId}`).map(r => r.account_id);
    res.json(accounts.map(a => ({ ...a, shared: shared.includes(a.id) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch shares' });
  }
});

// Replace the set of accounts shared with a member (parents only)
router.put('/:memberId/shares', requireParent, async (req, res) => {
  try {
    if (!(await inHousehold(req.user.id, req.params.memberId))) return res.status(404).json({ error: 'Not in your household' });
    const visible = await visibleAccountIds(req.user);
    const toShare = (req.body.accountIds || []).filter(id => visible.includes(id));
    // Only touch shares within the parent's visible accounts; leave others intact
    await sql`DELETE FROM account_shares WHERE shared_with_user_id = ${req.params.memberId} AND account_id = ANY(${visible})`;
    for (const aid of toShare) {
      await sql`
        INSERT INTO account_shares (account_id, shared_with_user_id, shared_by_user_id)
        VALUES (${aid}, ${req.params.memberId}, ${req.user.id})
        ON CONFLICT DO NOTHING
      `;
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update shares' });
  }
});

module.exports = router;
