import app from './app.js';
import pool, { closePool } from './db/connection.js';
import { initializeDatabase } from './db/schema.js';

const PORT = process.env.PORT || 3001;

async function start() {
  await initializeDatabase(pool);

  app.listen(PORT, () => {
    console.log(`Backbeat Stash API running on http://localhost:${PORT}`);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received — closing database pool');
  await closePool();
  process.exit(0);
});

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
