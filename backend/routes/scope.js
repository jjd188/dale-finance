const { sql } = require('../db');

// The household id for a user (or null)
async function householdId(userId) {
  const rows = await sql`SELECT household_id FROM household_members WHERE user_id = ${userId} LIMIT 1`;
  return rows.length ? rows[0].household_id : null;
}

// The set of user ids the requester is allowed to see:
// parents see everyone in their household, kids see only themselves.
async function scopeUserIds(user) {
  if (user.role !== 'parent') return [user.id];
  const hid = await householdId(user.id);
  if (!hid) return [user.id];
  const rows = await sql`SELECT user_id FROM household_members WHERE household_id = ${hid}`;
  return rows.map(r => r.user_id);
}

// The set of account ids the requester can see:
// - parents: every household account except others' private ones
// - kids: their own accounts plus any explicitly shared with them
async function visibleAccountIds(user) {
  if (user.role === 'parent') {
    const hid = await householdId(user.id);
    if (!hid) {
      const rows = await sql`SELECT id FROM accounts WHERE user_id = ${user.id}`;
      return rows.map(r => r.id);
    }
    const rows = await sql`
      SELECT a.id FROM accounts a
      JOIN household_members hm ON hm.user_id = a.user_id
      WHERE hm.household_id = ${hid}
        AND (a.is_private = false OR a.user_id = ${user.id})
    `;
    return rows.map(r => r.id);
  }
  const rows = await sql`
    SELECT id FROM accounts WHERE user_id = ${user.id}
    UNION
    SELECT account_id FROM account_shares WHERE shared_with_user_id = ${user.id}
  `;
  return rows.map(r => r.id);
}

module.exports = { householdId, scopeUserIds, visibleAccountIds };
