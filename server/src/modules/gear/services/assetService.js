// Gear asset services — all SQL for the `assets` table lives here.
//
// Every function takes a `db` (the pool, or a pg client already inside a BEGIN) as its
// first argument so it can run standalone or compose inside a cross-module transaction —
// see `workflows/commissionAsset.js`.

import { executeSqlStrict, executeSqlWrite } from '../../../db/connection.js';
import { httpError } from '../../../core/http.js';

export const VALID_STATUSES = ['Available', 'In Use', 'Maintenance', 'Retired'];

/** Assets always travel with the name of their shared/core location. */
export async function listAssets(db) {
  return executeSqlStrict(db, `
    SELECT
      a.id,
      a.asset_tag,
      a.serial_number,
      a.asset_type,
      a.status,
      a.location_id,
      l.name AS location_name,
      a.notes,
      a.created_at,
      a.updated_at
    FROM assets a
    LEFT JOIN locations l ON a.location_id = l.id
    ORDER BY a.asset_tag
  `);
}

export async function getAsset(db, id) {
  const rows = await executeSqlStrict(db, `
    SELECT a.*, l.name AS location_name
    FROM assets a
    LEFT JOIN locations l ON a.location_id = l.id
    WHERE a.id = $1
  `, [id]);
  if (rows.length === 0) throw httpError('Asset not found', 404);
  return rows[0];
}

/**
 * Create an asset. When `location_id` is provided it must reference an existing
 * shared/core location (cross-module referential integrity).
 */
export async function createAsset(db, {
  asset_tag,
  serial_number = null,
  asset_type = 'General',
  status = 'Available',
  location_id = null,
  notes = null,
}) {
  if (!asset_tag || !asset_tag.trim()) {
    throw httpError('asset_tag is required', 400);
  }
  if (!VALID_STATUSES.includes(status)) {
    throw httpError(`status must be one of: ${VALID_STATUSES.join(', ')}`, 400);
  }

  if (location_id) {
    const locRows = await executeSqlStrict(db, 'SELECT id FROM locations WHERE id = $1', [location_id]);
    if (locRows.length === 0) throw httpError('Location not found', 404);
  }

  try {
    const rows = await executeSqlStrict(db, `
      INSERT INTO assets (asset_tag, serial_number, asset_type, status, location_id, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [asset_tag.trim(), serial_number, asset_type, status, location_id, notes]);
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw httpError('An asset with that asset_tag already exists', 409);
    throw err;
  }
}

/** Patch an asset — fields left out of `changes` keep their current value. */
export async function updateAsset(db, id, changes) {
  const { asset_tag, serial_number, asset_type, status, location_id, notes } = changes;

  if (asset_tag !== undefined && !asset_tag.trim()) {
    throw httpError('asset_tag cannot be empty', 400);
  }
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    throw httpError(`status must be one of: ${VALID_STATUSES.join(', ')}`, 400);
  }

  const existingRows = await executeSqlStrict(db, 'SELECT * FROM assets WHERE id = $1', [id]);
  if (existingRows.length === 0) throw httpError('Asset not found', 404);
  const existing = existingRows[0];

  // Omitted keeps the current location; an explicit falsy value clears it.
  const locId = location_id === undefined ? existing.location_id : (location_id || null);
  if (locId) {
    const locRows = await executeSqlStrict(db, 'SELECT id FROM locations WHERE id = $1', [locId]);
    if (locRows.length === 0) throw httpError('Location not found', 404);
  }

  try {
    const rows = await executeSqlStrict(db, `
      UPDATE assets SET
        asset_tag = $1,
        serial_number = $2,
        asset_type = $3,
        status = $4,
        location_id = $5,
        notes = $6,
        updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `, [
      asset_tag !== undefined ? asset_tag.trim() : existing.asset_tag,
      serial_number !== undefined ? serial_number : existing.serial_number,
      asset_type !== undefined ? asset_type : existing.asset_type,
      status !== undefined ? status : existing.status,
      locId,
      notes !== undefined ? notes : existing.notes,
      id,
    ]);
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw httpError('An asset with that asset_tag already exists', 409);
    throw err;
  }
}

export async function deleteAsset(db, id) {
  const rowCount = await executeSqlWrite(db, 'DELETE FROM assets WHERE id = $1', [id]);
  if (rowCount === 0) throw httpError('Asset not found', 404);
}
