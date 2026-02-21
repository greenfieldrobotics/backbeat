import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgres://backbeat:backbeat@localhost:5432/backbeat';
const APP_URL = 'http://localhost:5173';

export default async function globalSetup() {
  // 1. Health-check: verify the app is running
  let retries = 3;
  while (retries > 0) {
    try {
      const res = await fetch(APP_URL);
      if (res.ok) break;
    } catch {
      // ignore
    }
    retries--;
    if (retries === 0) {
      throw new Error(
        `App not running at ${APP_URL}. Start it with: docker compose up`
      );
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // 2. Truncate all tables so tests start from a clean slate
  const pool = new pg.Pool({ connectionString: DB_URL });
  try {
    await pool.query(`
      TRUNCATE
        inventory_transactions,
        fifo_layers,
        inventory,
        po_line_items,
        purchase_orders,
        suppliers,
        parts,
        locations
      RESTART IDENTITY CASCADE
    `);
  } finally {
    await pool.end();
  }
}
