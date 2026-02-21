import pg from 'pg';

// Parse NUMERIC (OID 1700) as JavaScript floats instead of strings
pg.types.setTypeParser(1700, parseFloat);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://backbeat:backbeat@localhost:5432/backbeat',
});

/** Run a single query. Params use $1, $2, ... placeholders. */
export async function query(sql, params) {
  return pool.query(sql, params);
}

/** Get a dedicated client from the pool (for transactions). Call client.release() when done. */
export async function getClient() {
  return pool.connect();
}

/** Gracefully close the pool (for shutdown). */
export async function closePool() {
  await pool.end();
}

export default pool;
