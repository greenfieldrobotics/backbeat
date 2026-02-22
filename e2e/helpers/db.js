import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgres://backbeat:backbeat@localhost:5432/backbeat';

let pool;

export function getPool() {
  if (!pool) {
    pool = new pg.Pool({ connectionString: DB_URL });
  }
  return pool;
}

export async function truncateAllTables() {
  const p = getPool();
  await p.query(`
    TRUNCATE
      inventory_transactions,
      fifo_layers,
      inventory,
      po_line_items,
      purchase_orders,
      suppliers,
      parts,
      locations,
      users
    RESTART IDENTITY CASCADE
  `);
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
