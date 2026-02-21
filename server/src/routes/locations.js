import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

// GET /api/locations - List all locations
router.get('/', (req, res) => {
  const db = getDb();
  const locations = db.prepare('SELECT * FROM locations ORDER BY name').all();
  res.json(locations);
});

// GET /api/locations/:id - Get single location
router.get('/:id', (req, res) => {
  const db = getDb();
  const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id);
  if (!location) return res.status(404).json({ error: 'Location not found' });
  res.json(location);
});

// POST /api/locations - Create a location
router.post('/', (req, res) => {
  const db = getDb();
  const { name, type } = req.body;

  if (!name || !type) {
    return res.status(400).json({ error: 'name and type are required' });
  }

  const validTypes = ['Warehouse', 'Regional Site', 'Contract Manufacturer'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }

  try {
    const result = db.prepare('INSERT INTO locations (name, type) VALUES (?, ?)').run(name, type);
    const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(location);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Location name already exists' });
    }
    throw err;
  }
});

// PUT /api/locations/:id - Update a location
router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Location not found' });

  const { name, type } = req.body;

  if (type) {
    const validTypes = ['Warehouse', 'Regional Site', 'Contract Manufacturer'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
    }
  }

  try {
    db.prepare(`
      UPDATE locations SET
        name = COALESCE(?, name),
        type = COALESCE(?, type),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(name || null, type || null, req.params.id);

    const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id);
    res.json(location);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Location name already exists' });
    }
    throw err;
  }
});

// DELETE /api/locations/:id - Delete a location
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Location not found' });

  const inv = db.prepare('SELECT SUM(quantity_on_hand) as total FROM inventory WHERE location_id = ?').get(req.params.id);
  if (inv && inv.total > 0) {
    return res.status(409).json({ error: 'Cannot delete location with existing inventory' });
  }

  db.prepare('DELETE FROM locations WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

export default router;
