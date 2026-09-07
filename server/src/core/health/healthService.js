// Health check for the shared database.

import { executeSqlStrict } from '../../db/connection.js';

/** Throws if the database is unreachable. */
export async function pingDatabase(db) {
  await executeSqlStrict(db, 'SELECT 1');
}
