import { Router } from 'express';
import pool from '../../db/connection.js';
import {
  listLocations,
  listInventoryLocations,
  getLocation,
  createLocation,
  updateLocation,
  deleteLocation,
} from './locationService.js';

const router = Router();

// GET /api/locations - List all locations
// GET /api/locations?inventory_only=true - Controlled storage areas only (Stash's pickers)
router.get('/', async (req, res) => {
  if (req.query.inventory_only === 'true') {
    return res.json(await listInventoryLocations(pool));
  }
  res.json(await listLocations(pool));
});

// GET /api/locations/:id - Get single location
router.get('/:id', async (req, res) => {
  try {
    res.json(await getLocation(pool, req.params.id));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// POST /api/locations - Create a location
router.post('/', async (req, res) => {
  const { name, type, is_inventory_location } = req.body;

  try {
    const location = await createLocation(pool, { name, type, is_inventory_location });
    res.status(201).json(location);
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// PUT /api/locations/:id - Update a location
router.put('/:id', async (req, res) => {
  const { name, type, is_inventory_location } = req.body;

  try {
    res.json(await updateLocation(pool, req.params.id, { name, type, is_inventory_location }));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// DELETE /api/locations/:id - Delete a location
router.delete('/:id', async (req, res) => {
  try {
    await deleteLocation(pool, req.params.id);
    res.status(204).send();
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

export default router;
