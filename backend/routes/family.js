const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth, requireParent } = require('../middleware/auth');
const { householdId } = require('./scope');

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

// Add an existing (signed-up) user to this household by email
router.post('/add', requireParent, async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const hid = await householdId(req.user.id);
    const user = await sql`SELECT id FROM users WHERE lower(email) = lower(${email}) LIMIT 1`;
    if (!user.length) return res.status(404).json({ error: 'No signed-up user with that email yet' });
    const uid = user[0].id;
    await sql`UPDATE users SET role = ${role === 'parent' ? 'parent' : 'kid'} WHERE id = ${uid}`;
    await sql`INSERT INTO household_members (household_id, user_id) VALUES (${hid}, ${uid}) ON CONFLICT DO NOTHING`;
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add member' });
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

module.exports = router;
