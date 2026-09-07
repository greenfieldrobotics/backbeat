import { Router } from 'express';
import pool from '../../../db/connection.js';
import {
  listParts,
  listClassifications,
  getPart,
  createPart,
  updatePart,
  deletePart,
} from '../services/partService.js';

const router = Router();

// GET /api/parts - List all parts
router.get('/', async (req, res) => {
  const { classification, search } = req.query;
  res.json(await listParts(pool, { classification, search }));
});

// GET /api/parts/classifications - Get distinct classifications
router.get('/classifications', async (req, res) => {
  res.json(await listClassifications(pool));
});

// GET /api/parts/:id - Get single part
router.get('/:id', async (req, res) => {
  try {
    res.json(await getPart(pool, req.params.id));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// POST /api/parts - Create a part
router.post('/', async (req, res) => {
  try {
    const part = await createPart(pool, req.body);
    res.status(201).json(part);
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// PUT /api/parts/:id - Update a part
router.put('/:id', async (req, res) => {
  try {
    res.json(await updatePart(pool, req.params.id, req.body));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// DELETE /api/parts/:id - Delete a part
router.delete('/:id', async (req, res) => {
  try {
    await deletePart(pool, req.params.id);
    res.status(204).send();
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

export default router;
