const jose = require('jose');
const { sql } = require('../db');
require('dotenv').config();

// Cache the remote JWK set (Neon Auth's public keys)
const JWKS = jose.createRemoteJWKSet(
  new URL(`${process.env.NEON_AUTH_URL}/.well-known/jwks.json`)
);

// Verifies the Bearer token, maps the auth user to our users row,
// and attaches { id, role, authId } to req.user
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = header.split(' ')[1];
  try {
    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer: new URL(process.env.NEON_AUTH_URL).origin,
    });
    const authId = payload.sub;

    // Existing users were already vetted at creation — always allowed
    const existing = await sql`SELECT id, role, auth_id FROM users WHERE auth_id = ${authId}`;
    if (existing.length) {
      req.user = { id: existing[0].id, role: existing[0].role, authId: existing[0].auth_id };
      return next();
    }

    // New auth identity: invite-only — must be on the allowlist
    const email = payload.email || null;
    const invite = email ? await sql`SELECT * FROM allowed_emails WHERE lower(email) = lower(${email})` : [];
    if (!invite.length) {
      return res.status(403).json({ error: 'invite_only', message: 'This app is invite-only. Ask a parent to invite your email first.' });
    }

    // Create the user with the invited role, attach to the household, and consume the invite
    const inv = invite[0];
    const created = await sql`
      INSERT INTO users (auth_id, name, email, role)
      VALUES (${authId}, ${payload.name || 'New user'}, ${email}, ${inv.role})
      RETURNING id, role, auth_id
    `;
    const uid = created[0].id;
    if (inv.household_id) {
      await sql`INSERT INTO household_members (household_id, user_id) VALUES (${inv.household_id}, ${uid}) ON CONFLICT DO NOTHING`;
    }
    await sql`DELETE FROM allowed_emails WHERE lower(email) = lower(${email})`;
    req.user = { id: created[0].id, role: created[0].role, authId: created[0].auth_id };
    next();
  } catch (err) {
    console.error('Auth error:', err.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Restrict a route to parents only
function requireParent(req, res, next) {
  if (req.user?.role !== 'parent') {
    return res.status(403).json({ error: 'Parents only' });
  }
  next();
}

module.exports = { requireAuth, requireParent };
