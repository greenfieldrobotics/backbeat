// Gear asset services — reusable logic, takes a `client` (or pool) with `.query`
// as its first argument so it can run standalone or inside a cross-module transaction.

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const VALID_STATUSES = ['Available', 'In Use', 'Maintenance', 'Retired'];

/**
 * Create an asset. When `location_id` is provided it must reference an existing
 * shared/core location (cross-module referential integrity).
 */
export async function createAsset(client, {
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
    const { rows } = await client.query('SELECT id FROM locations WHERE id = $1', [location_id]);
    if (rows.length === 0) throw httpError('Location not found', 404);
  }

  try {
    const { rows } = await client.query(`
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
