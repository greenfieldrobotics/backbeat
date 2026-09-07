// Gear asset type services — all SQL for the `asset_types` table lives here.
//
// Every function takes a `db` (the pool, or a pg client already inside a BEGIN) as its
// first argument so it can run standalone or compose inside a caller's transaction.
// Uniqueness is enforced with an explicit existence check before the insert/update,
// not a caught constraint-violation error code — Postgres's 23505 doesn't exist on
// SQL Server, and this module is meant to be born portable (requirements §6.1, §6.2).

import { executeSqlStrict, executeSqlWrite, executeSqlInsert } from '../../../db/connection.js';
import { httpError } from '../../../core/http.js';

export async function listAssetTypes(db) {
  return executeSqlStrict(db, 'SELECT * FROM asset_types ORDER BY name');
}

export async function getAssetType(db, id) {
  const rows = await executeSqlStrict(db, 'SELECT * FROM asset_types WHERE id = $1', [id]);
  if (rows.length === 0) throw httpError('Asset type not found', 404);
  return rows[0];
}

export async function createAssetType(db, {
  name,
  description = null,
  supports_location = false,
  supports_linking = false,
  supports_maintenance = false,
  active = true,
}) {
  if (!name || !name.trim()) throw httpError('name is required', 400);

  const dup = await executeSqlStrict(db, 'SELECT id FROM asset_types WHERE name = $1', [name.trim()]);
  if (dup.length > 0) throw httpError('An asset type with that name already exists', 409);

  const id = await executeSqlInsert(db, `
    INSERT INTO asset_types (name, description, supports_location, supports_linking, supports_maintenance, active)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [
    name.trim(),
    description,
    !!supports_location,
    !!supports_linking,
    !!supports_maintenance,
    active === undefined ? true : !!active,
  ]);

  return getAssetType(db, id);
}

export async function updateAssetType(db, id, changes) {
  const existing = await getAssetType(db, id);
  const {
    name, description, supports_location, supports_linking, supports_maintenance, active,
  } = changes;

  if (name !== undefined && !name.trim()) throw httpError('name cannot be empty', 400);

  if (name !== undefined && name.trim() !== existing.name) {
    const dup = await executeSqlStrict(db, 'SELECT id FROM asset_types WHERE name = $1 AND id != $2', [name.trim(), id]);
    if (dup.length > 0) throw httpError('An asset type with that name already exists', 409);
  }

  await executeSqlWrite(db, `
    UPDATE asset_types SET
      name = $1,
      description = $2,
      supports_location = $3,
      supports_linking = $4,
      supports_maintenance = $5,
      active = $6
    WHERE id = $7
  `, [
    name !== undefined ? name.trim() : existing.name,
    description !== undefined ? description : existing.description,
    supports_location !== undefined ? !!supports_location : existing.supports_location,
    supports_linking !== undefined ? !!supports_linking : existing.supports_linking,
    supports_maintenance !== undefined ? !!supports_maintenance : existing.supports_maintenance,
    active !== undefined ? !!active : existing.active,
    id,
  ]);

  return getAssetType(db, id);
}

export async function deleteAssetType(db, id) {
  const rowCount = await executeSqlWrite(db, 'DELETE FROM asset_types WHERE id = $1', [id]);
  if (rowCount === 0) throw httpError('Asset type not found', 404);
}
