// Stash part services — all SQL for the `parts` table lives here.
//
// Every function takes a `db` (the pool, or a pg client already inside a BEGIN) as its
// first argument so it can run standalone or compose inside a caller's transaction.

import { httpError } from '../../../core/http.js';

// Fields a caller may set on create, and patch on update.
const EDITABLE_FIELDS = [
  'part_number',
  'description',
  'unit_of_measure',
  'classification',
  'cost',
  'mfg_part_number',
  'manufacturer',
  'reseller',
  'reseller_part_number',
  'notes',
];

export async function listParts(db, { classification, search } = {}) {
  let sql = 'SELECT * FROM parts';
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (classification) {
    conditions.push(`classification = $${paramIndex++}`);
    params.push(classification);
  }
  if (search) {
    conditions.push(`(part_number ILIKE $${paramIndex} OR description ILIKE $${paramIndex + 1} OR manufacturer ILIKE $${paramIndex + 2})`);
    const term = `%${search}%`;
    params.push(term, term, term);
    paramIndex += 3;
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY part_number';

  const { rows } = await db.query(sql, params);
  return rows;
}

/** Distinct classifications in use, for filter dropdowns. */
export async function listClassifications(db) {
  const { rows } = await db.query('SELECT DISTINCT classification FROM parts ORDER BY classification');
  return rows.map(r => r.classification);
}

export async function getPart(db, id) {
  const { rows } = await db.query('SELECT * FROM parts WHERE id = $1', [id]);
  if (rows.length === 0) throw httpError('Part not found', 404);
  return rows[0];
}

export async function createPart(db, {
  part_number,
  description,
  unit_of_measure,
  classification,
  cost,
  mfg_part_number,
  manufacturer,
  reseller,
  reseller_part_number,
  notes,
}) {
  if (!part_number) throw httpError('part_number is required', 400);

  try {
    const { rows } = await db.query(`
      INSERT INTO parts (part_number, description, unit_of_measure, classification, cost, mfg_part_number, manufacturer, reseller, reseller_part_number, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      part_number,
      description || '',
      unit_of_measure || 'EA',
      classification || 'General',
      cost || null,
      mfg_part_number || null,
      manufacturer || null,
      reseller || null,
      reseller_part_number || null,
      notes || null,
    ]);
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw httpError('Part number already exists', 409);
    throw err;
  }
}

/** Patch a part — only the fields present in `changes` are written. */
export async function updatePart(db, id, changes) {
  const { rows: existing } = await db.query('SELECT * FROM parts WHERE id = $1', [id]);
  if (existing.length === 0) throw httpError('Part not found', 404);

  const updates = [];
  const params = [];
  let paramIndex = 1;

  for (const field of EDITABLE_FIELDS) {
    if (changes[field] !== undefined) {
      updates.push(`${field} = $${paramIndex++}`);
      params.push(changes[field]);
    }
  }

  if (updates.length === 0) throw httpError('No fields to update', 400);

  updates.push('updated_at = NOW()');
  params.push(id);

  try {
    const { rows } = await db.query(
      `UPDATE parts SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw httpError('Part number already exists', 409);
    throw err;
  }
}

export async function deletePart(db, id) {
  const { rows: existing } = await db.query('SELECT * FROM parts WHERE id = $1', [id]);
  if (existing.length === 0) throw httpError('Part not found', 404);

  const { rows: inv } = await db.query(
    'SELECT SUM(quantity_on_hand) as total FROM inventory WHERE part_id = $1',
    [id]
  );
  if (inv[0] && inv[0].total > 0) {
    throw httpError('Cannot delete part with existing inventory', 409);
  }

  await db.query('DELETE FROM parts WHERE id = $1', [id]);
}
