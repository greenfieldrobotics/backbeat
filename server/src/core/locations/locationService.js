// Location services — all SQL for the shared `locations` table lives here.
// Locations are core (not module-owned): both Stash and Gear reference them.
//
// Every function takes a `db` (the pool, or a pg client already inside a BEGIN) as its
// first argument so it can run standalone or compose inside a caller's transaction.

import { executeSqlStrict, executeSqlWrite } from '../../db/connection.js';
import { httpError } from '../http.js';

// Keep in sync with the `locations_type_check` CHECK constraint in db/schema.js.
export const VALID_TYPES = ['Warehouse', 'Regional Site', 'Contract Manufacturer', 'Farm', 'In Transit', 'Customer Site'];

export async function listLocations(db) {
  return executeSqlStrict(db, 'SELECT * FROM locations ORDER BY name');
}

/** Controlled storage areas only — what Stash's pickers should offer (G3.1, requirements §5.2). */
export async function listInventoryLocations(db) {
  return executeSqlStrict(db, 'SELECT * FROM locations WHERE is_inventory_location = true ORDER BY name');
}

export async function getLocation(db, id) {
  const rows = await executeSqlStrict(db, 'SELECT * FROM locations WHERE id = $1', [id]);
  if (rows.length === 0) throw httpError('Location not found', 404);
  return rows[0];
}

export async function createLocation(db, { name, type, is_inventory_location }) {
  if (!name || !type) {
    throw httpError('name and type are required', 400);
  }
  if (!VALID_TYPES.includes(type)) {
    throw httpError(`type must be one of: ${VALID_TYPES.join(', ')}`, 400);
  }

  try {
    const rows = await executeSqlStrict(
      db,
      'INSERT INTO locations (name, type, is_inventory_location) VALUES ($1, $2, $3) RETURNING *',
      [name, type, is_inventory_location === undefined ? true : !!is_inventory_location]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw httpError('Location name already exists', 409);
    throw err;
  }
}

export async function updateLocation(db, id, { name, type, is_inventory_location }) {
  const existing = await executeSqlStrict(db, 'SELECT * FROM locations WHERE id = $1', [id]);
  if (existing.length === 0) throw httpError('Location not found', 404);

  if (type && !VALID_TYPES.includes(type)) {
    throw httpError(`type must be one of: ${VALID_TYPES.join(', ')}`, 400);
  }

  try {
    const rows = await executeSqlStrict(db, `
      UPDATE locations SET
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        is_inventory_location = COALESCE($3, is_inventory_location),
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `, [
      name || null,
      type || null,
      // A plain `is_inventory_location || null` would be wrong here: false is
      // falsy in JS, so an explicit "set it to false" would collapse to null and
      // be silently ignored by COALESCE. Only an actually-omitted field should
      // fall through to the existing value.
      is_inventory_location === undefined ? null : is_inventory_location,
      id,
    ]);
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw httpError('Location name already exists', 409);
    throw err;
  }
}

export async function deleteLocation(db, id) {
  const existing = await executeSqlStrict(db, 'SELECT * FROM locations WHERE id = $1', [id]);
  if (existing.length === 0) throw httpError('Location not found', 404);

  const inv = await executeSqlStrict(
    db,
    'SELECT SUM(quantity_on_hand) as total FROM inventory WHERE location_id = $1',
    [id]
  );
  if (inv[0] && inv[0].total > 0) {
    throw httpError('Cannot delete location with existing inventory', 409);
  }

  await executeSqlWrite(db, 'DELETE FROM locations WHERE id = $1', [id]);
}
