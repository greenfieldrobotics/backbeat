// Stash supplier services — all SQL for the `suppliers` table lives here.
//
// Every function takes a `db` (the pool, or a pg client already inside a BEGIN) as its
// first argument so it can run standalone or compose inside a caller's transaction.

import { executeSqlStrict } from '../../../db/connection.js';
import { httpError } from '../../../core/http.js';

export async function listSuppliers(db) {
  return executeSqlStrict(db, 'SELECT * FROM suppliers ORDER BY name');
}

export async function createSupplier(db, { name }) {
  if (!name) throw httpError('name is required', 400);

  try {
    const rows = await executeSqlStrict(
      db,
      'INSERT INTO suppliers (name) VALUES ($1) RETURNING *',
      [name]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw httpError('Supplier name already exists', 409);
    throw err;
  }
}
