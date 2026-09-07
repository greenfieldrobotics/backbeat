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

/**
 * Run `fn` inside a single transaction.
 *
 * `fn` receives a client that is already inside BEGIN; the transaction commits when
 * `fn` resolves and rolls back when it throws. Services keep taking a `client` as
 * their first argument, so this is what lets a route run one service inside a
 * transaction without writing any SQL itself — and lets `workflows/` compose several
 * services from different modules into the same transaction.
 */
export async function withTransaction(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Gracefully close the pool (for shutdown). */
export async function closePool() {
  await pool.end();
}

export default pool;
