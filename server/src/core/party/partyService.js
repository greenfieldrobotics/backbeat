// Party services — all SQL for the shared `parties` table lives here.
//
// Every function takes a `db` (the pool, or a pg client already inside a BEGIN) as its
// first argument so it can run standalone or compose inside a caller's transaction.
// Parties carry no uniqueness constraint (requirements §5.3 doesn't ask for one — two
// distinct parties may share a name), so creation has nothing to conflict with.

import { executeSqlStrict, executeSqlWrite, executeSqlInsert } from '../../db/connection.js';
import { httpError } from '../http.js';

export const VALID_PARTY_TYPES = ['internal_entity', 'employee', 'customer', 'vendor'];

export async function listParties(db) {
  return executeSqlStrict(db, 'SELECT * FROM parties ORDER BY name');
}

export async function getParty(db, id) {
  const rows = await executeSqlStrict(db, 'SELECT * FROM parties WHERE id = $1', [id]);
  if (rows.length === 0) throw httpError('Party not found', 404);
  return rows[0];
}

export async function createParty(db, { name, party_type, active }) {
  if (!name || !name.trim()) throw httpError('name is required', 400);
  if (!party_type || !VALID_PARTY_TYPES.includes(party_type)) {
    throw httpError(`party_type must be one of: ${VALID_PARTY_TYPES.join(', ')}`, 400);
  }

  const id = await executeSqlInsert(db, `
    INSERT INTO parties (name, party_type, active)
    VALUES ($1, $2, $3)
  `, [name.trim(), party_type, active === undefined ? true : !!active]);

  return getParty(db, id);
}

export async function updateParty(db, id, changes) {
  const existing = await getParty(db, id);
  const { name, party_type, active } = changes;

  if (name !== undefined && !name.trim()) throw httpError('name cannot be empty', 400);
  if (party_type !== undefined && !VALID_PARTY_TYPES.includes(party_type)) {
    throw httpError(`party_type must be one of: ${VALID_PARTY_TYPES.join(', ')}`, 400);
  }

  await executeSqlWrite(db, `
    UPDATE parties SET
      name = $1,
      party_type = $2,
      active = $3
    WHERE id = $4
  `, [
    name !== undefined ? name.trim() : existing.name,
    party_type !== undefined ? party_type : existing.party_type,
    active !== undefined ? !!active : existing.active,
    id,
  ]);

  return getParty(db, id);
}

export async function deleteParty(db, id) {
  const rowCount = await executeSqlWrite(db, 'DELETE FROM parties WHERE id = $1', [id]);
  if (rowCount === 0) throw httpError('Party not found', 404);
}
