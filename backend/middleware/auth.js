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

    // Find or create the local user row keyed by the auth provider's id
    let rows = await sql`SELECT id, role, auth_id FROM users WHERE auth_id = ${authId}`;
    if (!rows.length) {
      rows = await sql`
        INSERT INTO users (auth_id, name, email, role)
        VALUES (${authId}, ${payload.name || 'New user'}, ${payload.email || null}, 'kid')
        RETURNING id, role, auth_id
      `;
    }
    req.user = { id: rows[0].id, role: rows[0].role, authId: rows[0].auth_id };
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
