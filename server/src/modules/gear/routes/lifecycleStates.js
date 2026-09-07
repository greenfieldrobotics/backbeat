import { Router } from 'express';
import pool from '../../../db/connection.js';
import {
  listLifecycleStates,
  getLifecycleState,
  createLifecycleState,
  updateLifecycleState,
  deleteLifecycleState,
} from '../services/lifecycleStateService.js';

const router = Router();

// GET /api/gear/lifecycle-states - List all lifecycle states
router.get('/', async (req, res) => {
  res.json(await listLifecycleStates(pool));
});

// GET /api/gear/lifecycle-states/:id - Get single lifecycle state
router.get('/:id', async (req, res) => {
  try {
    res.json(await getLifecycleState(pool, req.params.id));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// POST /api/gear/lifecycle-states - Create a lifecycle state
router.post('/', async (req, res) => {
  const { name, sort_order, is_terminal, active } = req.body;

  try {
    const state = await createLifecycleState(pool, { name, sort_order, is_terminal, active });
    res.status(201).json(state);
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// PUT /api/gear/lifecycle-states/:id - Update a lifecycle state
router.put('/:id', async (req, res) => {
  const { name, sort_order, is_terminal, active } = req.body;

  try {
    res.json(await updateLifecycleState(pool, req.params.id, { name, sort_order, is_terminal, active }));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// DELETE /api/gear/lifecycle-states/:id - Delete a lifecycle state
router.delete('/:id', async (req, res) => {
  try {
    await deleteLifecycleState(pool, req.params.id);
    res.status(204).send();
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

export default router;
