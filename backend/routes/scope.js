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

module.exports = { householdId, scopeUserIds };
