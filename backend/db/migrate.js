const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  // Split on semicolons at end of statements, run each
  const statements = schema.split(/;\s*$/m).map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await sql.query(stmt);
    console.log('✓', stmt.split('\n')[0].slice(0, 60));
  }
  console.log('Migration complete.');
})().catch(e => { console.error(e); process.exit(1); });
