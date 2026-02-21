import { Router } from 'express';
import { query } from '../db/connection.js';

const router = Router();

// GET /api/suppliers
router.get('/', async (req, res) => {
  const { rows } = await query('SELECT * FROM suppliers ORDER BY name');
  res.json(rows);
});

// POST /api/suppliers
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const { rows } = await query(
      'INSERT INTO suppliers (name) VALUES ($1) RETURNING *',
      [name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Supplier name already exists' });
    }
    throw err;
  }
});

export default router;
