// Apply pending database migrations, then exit:  npm run migrate
// (The server also does this automatically on every start.)
const db = require('../server/db');

db.migrate()
  .then(() => console.log('Database is up to date.'))
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => db.close());
