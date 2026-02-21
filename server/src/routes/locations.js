import { Router } from 'express';
import { query } from '../db/connection.js';

const router = Router();

// GET /api/locations - List all locations
router.get('/', async (req, res) => {
  const { rows } = await query('SELECT * FROM locations ORDER BY name');
  res.json(rows);
});

// GET /api/locations/:id - Get single location
router.get('/:id', async (req, res) => {
  const { rows } = await query('SELECT * FROM locations WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Location not found' });
  res.json(rows[0]);
});

// POST /api/locations - Create a location
router.post('/', async (req, res) => {
  const { name, type } = req.body;

  if (!name || !type) {
    return res.status(400).json({ error: 'name and type are required' });
  }

  const validTypes = ['Warehouse', 'Regional Site', 'Contract Manufacturer'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }

  try {
    const { rows } = await query(
      'INSERT INTO locations (name, type) VALUES ($1, $2) RETURNING *',
      [name, type]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Location name already exists' });
    }
    throw err;
  }
});

// PUT /api/locations/:id - Update a location
router.put('/:id', async (req, res) => {
  const { rows: existing } = await query('SELECT * FROM locations WHERE id = $1', [req.params.id]);
  if (existing.length === 0) return res.status(404).json({ error: 'Location not found' });

  const { name, type } = req.body;

  if (type) {
    const validTypes = ['Warehouse', 'Regional Site', 'Contract Manufacturer'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
    }
  }

  try {
    const { rows } = await query(`
      UPDATE locations SET
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [name || null, type || null, req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Location name already exists' });
    }
    throw err;
  }
});

// DELETE /api/locations/:id - Delete a location
router.delete('/:id', async (req, res) => {
  const { rows: existing } = await query('SELECT * FROM locations WHERE id = $1', [req.params.id]);
  if (existing.length === 0) return res.status(404).json({ error: 'Location not found' });

  const { rows: inv } = await query(
    'SELECT SUM(quantity_on_hand) as total FROM inventory WHERE location_id = $1',
    [req.params.id]
  );
  if (inv[0] && inv[0].total > 0) {
    return res.status(409).json({ error: 'Cannot delete location with existing inventory' });
  }

  await query('DELETE FROM locations WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

export default router;
