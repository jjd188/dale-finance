require('dotenv').config();
const express = require('express');
const cors = require('cors');

const plaidRoutes = require('./routes/plaid');
const accountRoutes = require('./routes/accounts');

const app = express();
// API auth is via Bearer token (not cookies), so any origin is safe to allow
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/plaid', plaidRoutes);
app.use('/api/accounts', accountRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
