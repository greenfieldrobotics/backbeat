// Gear lifecycle state services — all SQL for the `lifecycle_states` table lives here.
//
// Every function takes a `db` (the pool, or a pg client already inside a BEGIN) as its
// first argument so it can run standalone or compose inside a caller's transaction.
// Uniqueness is enforced with an explicit existence check before the insert/update —
// see assetTypeService.js for why this replaces a caught 23505.

import { executeSqlStrict, executeSqlWrite, executeSqlInsert } from '../../../db/connection.js';
import { httpError } from '../../../core/http.js';

export async function listLifecycleStates(db) {
  return executeSqlStrict(db, 'SELECT * FROM lifecycle_states ORDER BY sort_order, name');
}

export async function getLifecycleState(db, id) {
  const rows = await executeSqlStrict(db, 'SELECT * FROM lifecycle_states WHERE id = $1', [id]);
  if (rows.length === 0) throw httpError('Lifecycle state not found', 404);
  return rows[0];
}

export async function createLifecycleState(db, {
  name,
  sort_order = 0,
  is_terminal = false,
  active = true,
}) {
  if (!name || !name.trim()) throw httpError('name is required', 400);

  const dup = await executeSqlStrict(db, 'SELECT id FROM lifecycle_states WHERE name = $1', [name.trim()]);
  if (dup.length > 0) throw httpError('A lifecycle state with that name already exists', 409);

  const id = await executeSqlInsert(db, `
    INSERT INTO lifecycle_states (name, sort_order, is_terminal, active)
    VALUES ($1, $2, $3, $4)
  `, [
    name.trim(),
    sort_order === undefined ? 0 : sort_order,
    !!is_terminal,
    active === undefined ? true : !!active,
  ]);

  return getLifecycleState(db, id);
}

export async function updateLifecycleState(db, id, changes) {
  const existing = await getLifecycleState(db, id);
  const { name, sort_order, is_terminal, active } = changes;

  if (name !== undefined && !name.trim()) throw httpError('name cannot be empty', 400);

  if (name !== undefined && name.trim() !== existing.name) {
    const dup = await executeSqlStrict(db, 'SELECT id FROM lifecycle_states WHERE name = $1 AND id != $2', [name.trim(), id]);
    if (dup.length > 0) throw httpError('A lifecycle state with that name already exists', 409);
  }

  await executeSqlWrite(db, `
    UPDATE lifecycle_states SET
      name = $1,
      sort_order = $2,
      is_terminal = $3,
      active = $4
    WHERE id = $5
  `, [
    name !== undefined ? name.trim() : existing.name,
    sort_order !== undefined ? sort_order : existing.sort_order,
    is_terminal !== undefined ? !!is_terminal : existing.is_terminal,
    active !== undefined ? !!active : existing.active,
    id,
  ]);

  return getLifecycleState(db, id);
}

export async function deleteLifecycleState(db, id) {
  const rowCount = await executeSqlWrite(db, 'DELETE FROM lifecycle_states WHERE id = $1', [id]);
  if (rowCount === 0) throw httpError('Lifecycle state not found', 404);
}
