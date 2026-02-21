import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

// GET /api/parts - List all parts
router.get('/', (req, res) => {
  const db = getDb();
  const { classification, search } = req.query;

  let sql = 'SELECT * FROM parts';
  const conditions = [];
  const params = [];

  if (classification) {
    conditions.push('classification = ?');
    params.push(classification);
  }
  if (search) {
    conditions.push('(part_number LIKE ? OR description LIKE ? OR manufacturer LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY part_number';

  const parts = db.prepare(sql).all(...params);
  res.json(parts);
});

// GET /api/parts/classifications - Get distinct classifications
router.get('/classifications', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT DISTINCT classification FROM parts ORDER BY classification').all();
  res.json(rows.map(r => r.classification));
});

// GET /api/parts/:id - Get single part
router.get('/:id', (req, res) => {
  const db = getDb();
  const part = db.prepare('SELECT * FROM parts WHERE id = ?').get(req.params.id);
  if (!part) return res.status(404).json({ error: 'Part not found' });
  res.json(part);
});

// POST /api/parts - Create a part
router.post('/', (req, res) => {
  const db = getDb();
  const { part_number, description, unit_of_measure, classification, cost, mfg_part_number, manufacturer, reseller, reseller_part_number, notes } = req.body;

  if (!part_number) {
    return res.status(400).json({ error: 'part_number is required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO parts (part_number, description, unit_of_measure, classification, cost, mfg_part_number, manufacturer, reseller, reseller_part_number, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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
    );

    const part = db.prepare('SELECT * FROM parts WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(part);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Part number already exists' });
    }
    throw err;
  }
});

// PUT /api/parts/:id - Update a part
router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM parts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Part not found' });

  const fields = ['part_number', 'description', 'unit_of_measure', 'classification', 'cost', 'mfg_part_number', 'manufacturer', 'reseller', 'reseller_part_number', 'notes'];
  const updates = [];
  const params = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updates.push("updated_at = datetime('now')");
  params.push(req.params.id);

  try {
    db.prepare(`UPDATE parts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const part = db.prepare('SELECT * FROM parts WHERE id = ?').get(req.params.id);
    res.json(part);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Part number already exists' });
    }
    throw err;
  }
});

// DELETE /api/parts/:id - Delete a part
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM parts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Part not found' });

  const inv = db.prepare('SELECT SUM(quantity_on_hand) as total FROM inventory WHERE part_id = ?').get(req.params.id);
  if (inv && inv.total > 0) {
    return res.status(409).json({ error: 'Cannot delete part with existing inventory' });
  }

  db.prepare('DELETE FROM parts WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

export default router;
