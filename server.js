'use strict';

const path = require('path');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'voting.db');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const SEED_CSV = path.join(__dirname, 'data', 'teams.csv');

if (ADMIN_PASSWORD === 'admin') {
  console.warn('\n⚠️  Using the default admin password "admin". Set ADMIN_PASSWORD before sharing the link.\n');
}

const app = createApp({ dbPath: DB_PATH, adminPassword: ADMIN_PASSWORD, seedCsv: SEED_CSV });

app.listen(PORT, () => {
  console.log(`\n🗳️  Voting platform running at http://localhost:${PORT}`);
  console.log(`    Voter link:  http://localhost:${PORT}/`);
  console.log(`    Admin:       http://localhost:${PORT}/admin\n`);
});
