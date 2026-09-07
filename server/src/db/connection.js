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

// ---------------------------------------------------------------------------
// Query helper layer
// ---------------------------------------------------------------------------
//
// These four helpers mirror the names and semantics of dashboard's
// `core/database.py`, so a future Flask port is a function-for-function
// translation. Services call these; they never call `db.query()` directly.
//
//   executeSql        rows; logs and returns [] on failure
//   executeSqlStrict  rows; propagates failure to the caller
//   executeSqlWrite   statement not expected to return rows; returns the row count
//   executeSqlInsert  insert returning the new id
//
// THE EXECUTOR ARGUMENT
//
// Dashboard's helpers own their connection: `execute_sql(sql, params)` opens one,
// runs, closes. Backbeat cannot do that, because a helper that opened its own
// connection could not take part in a caller's open transaction — and composing
// services inside ONE transaction is the whole point of `withTransaction()` and
// `workflows/`. So every helper takes the executor as its FIRST argument:
//
//   executeSqlStrict(db, sql, params)
//
// where `db` is either the pool (standalone, auto-committing) or a pg client
// already inside a BEGIN. That is exactly the convention the service layer
// already follows — every service function takes `db`/`client` first and passes
// it straight down — so the executor threads through unchanged from route or
// workflow to SQL. The port to Flask drops the leading argument; nothing else
// about the call sites changes.
//
// SWALLOWED FAILURES
//
// Dashboard's rule applies here too: SQL failures are not a normal control path.
// `executeSql` is the only helper that swallows one, and it must never be used
// on a `client` inside a transaction — a failed statement poisons the whole
// transaction, so continuing past it turns the eventual COMMIT into a silent
// ROLLBACK. Writes never swallow: a write that fails quietly is data loss, and
// services rely on constraint violations (e.g. Postgres 23505) reaching them so
// they can answer 409 instead of 500.

/** Trim SQL down to something readable in a log line. */
function describeSql(sql) {
  const oneLine = String(sql).trim().replace(/\s+/g, ' ');
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
}

/**
 * Run a query and return its rows. Failure propagates to the caller.
 * This is the default for anything inside a transaction, and for anything whose
 * caller needs to see the error (a constraint violation, say).
 */
export async function executeSqlStrict(db, sql, params = []) {
  const { rows } = await db.query(sql, params);
  return rows;
}

/**
 * Run a query and return its rows, logging and returning [] if it fails.
 *
 * Only for standalone reads on the pool where an empty result is an acceptable
 * degradation. Never pass a transaction client — see SWALLOWED FAILURES above.
 */
export async function executeSql(db, sql, params = []) {
  try {
    return await executeSqlStrict(db, sql, params);
  } catch (err) {
    console.error(`[db] query failed: ${err.message} | SQL: ${describeSql(sql)}`);
    return [];
  }
}

/**
 * Run a statement that is not expected to return rows (UPDATE / DELETE / plain
 * INSERT). Returns the number of rows affected. Failure propagates.
 */
export async function executeSqlWrite(db, sql, params = []) {
  const { rowCount } = await db.query(sql, params);
  return rowCount;
}

/**
 * Run an INSERT and return the id of the new row. Failure propagates.
 *
 * Pass a plain INSERT with no RETURNING clause: getting the new id back is the
 * dialect-specific part (Postgres `RETURNING`, SQL Server `OUTPUT` /
 * `SCOPE_IDENTITY()`), and isolating it here is the point of the helper. Returns
 * null when the insert produced no row.
 *
 * If you need columns other than the id back, use `executeSqlStrict` and write
 * the RETURNING clause yourself.
 */
export async function executeSqlInsert(db, sql, params = []) {
  if (/\bRETURNING\b/i.test(sql)) {
    throw new Error(
      'executeSqlInsert() adds its own RETURNING clause — pass a plain INSERT, ' +
      'or use executeSqlStrict() if you need specific columns back'
    );
  }
  const text = `${String(sql).trim().replace(/;\s*$/, '')} RETURNING id`;
  const { rows } = await db.query(text, params);
  return rows.length > 0 ? rows[0].id : null;
}

export default pool;
