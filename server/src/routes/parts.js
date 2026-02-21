import { Router } from 'express';
import { query } from '../db/connection.js';

const router = Router();

// GET /api/parts - List all parts
router.get('/', async (req, res) => {
  const { classification, search } = req.query;

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

  const { rows } = await query(sql, params);
  res.json(rows);
});

// GET /api/parts/classifications - Get distinct classifications
router.get('/classifications', async (req, res) => {
  const { rows } = await query('SELECT DISTINCT classification FROM parts ORDER BY classification');
  res.json(rows.map(r => r.classification));
});

// GET /api/parts/:id - Get single part
router.get('/:id', async (req, res) => {
  const { rows } = await query('SELECT * FROM parts WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Part not found' });
  res.json(rows[0]);
});

// POST /api/parts - Create a part
router.post('/', async (req, res) => {
  const { part_number, description, unit_of_measure, classification, cost, mfg_part_number, manufacturer, reseller, reseller_part_number, notes } = req.body;

  if (!part_number) {
    return res.status(400).json({ error: 'part_number is required' });
  }

  try {
    const { rows } = await query(`
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
      notes || null
    ]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Part number already exists' });
    }
    throw err;
  }
});

// PUT /api/parts/:id - Update a part
router.put('/:id', async (req, res) => {
  const { rows: existing } = await query('SELECT * FROM parts WHERE id = $1', [req.params.id]);
  if (existing.length === 0) return res.status(404).json({ error: 'Part not found' });

  const fields = ['part_number', 'description', 'unit_of_measure', 'classification', 'cost', 'mfg_part_number', 'manufacturer', 'reseller', 'reseller_part_number', 'notes'];
  const updates = [];
  const params = [];
  let paramIndex = 1;

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = $${paramIndex++}`);
      params.push(req.body[field]);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updates.push('updated_at = NOW()');
  params.push(req.params.id);

  try {
    const { rows } = await query(
      `UPDATE parts SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Part number already exists' });
    }
    throw err;
  }
});

// DELETE /api/parts/:id - Delete a part
router.delete('/:id', async (req, res) => {
  const { rows: existing } = await query('SELECT * FROM parts WHERE id = $1', [req.params.id]);
  if (existing.length === 0) return res.status(404).json({ error: 'Part not found' });

  const { rows: inv } = await query(
    'SELECT SUM(quantity_on_hand) as total FROM inventory WHERE part_id = $1',
    [req.params.id]
  );
  if (inv[0] && inv[0].total > 0) {
    return res.status(409).json({ error: 'Cannot delete part with existing inventory' });
  }

  await query('DELETE FROM parts WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

export default router;
