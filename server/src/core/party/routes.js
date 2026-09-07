import { Router } from 'express';
import pool from '../../db/connection.js';
import {
  listParties,
  getParty,
  createParty,
  updateParty,
  deleteParty,
} from './partyService.js';

const router = Router();

// GET /api/parties - List all parties
router.get('/', async (req, res) => {
  res.json(await listParties(pool));
});

// GET /api/parties/:id - Get single party
router.get('/:id', async (req, res) => {
  try {
    res.json(await getParty(pool, req.params.id));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// POST /api/parties - Create a party
router.post('/', async (req, res) => {
  const { name, party_type, active } = req.body;

  try {
    const party = await createParty(pool, { name, party_type, active });
    res.status(201).json(party);
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// PUT /api/parties/:id - Update a party
router.put('/:id', async (req, res) => {
  const { name, party_type, active } = req.body;

  try {
    res.json(await updateParty(pool, req.params.id, { name, party_type, active }));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// DELETE /api/parties/:id - Delete a party
router.delete('/:id', async (req, res) => {
  try {
    await deleteParty(pool, req.params.id);
    res.status(204).send();
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

export default router;
