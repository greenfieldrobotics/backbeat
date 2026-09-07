// Health check for the shared database.

/** Throws if the database is unreachable. */
export async function pingDatabase(db) {
  await db.query('SELECT 1');
}
