import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

// GET /api/suppliers
router.get('/', (req, res) => {
  const db = getDb();
  const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY name').all();
  res.json(suppliers);
});

// POST /api/suppliers
router.post('/', (req, res) => {
  const db = getDb();
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const result = db.prepare('INSERT INTO suppliers (name) VALUES (?)').run(name);
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(supplier);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Supplier name already exists' });
    }
    throw err;
  }
});

export default router;
