import { Router } from 'express';
import pool from '../../../db/connection.js';
import {
  listAssets,
  getAsset,
  createAsset,
  updateAsset,
  deleteAsset,
} from '../services/assetService.js';

const router = Router();

// GET /api/gear/assets - List all assets (joined with their shared/core location)
router.get('/', async (req, res) => {
  res.json(await listAssets(pool));
});

// GET /api/gear/assets/:id - Get a single asset
router.get('/:id', async (req, res) => {
  try {
    res.json(await getAsset(pool, req.params.id));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// POST /api/gear/assets - Create an asset
router.post('/', async (req, res) => {
  const {
    serial_number, asset_type_id, lifecycle_state_id, model_id, location_id,
    owner_party_id, custodian_party_id, acquired_at, disposed_at, attributes, notes,
  } = req.body;

  try {
    const asset = await createAsset(pool, {
      serial_number, asset_type_id, lifecycle_state_id, model_id, location_id,
      owner_party_id, custodian_party_id, acquired_at, disposed_at, attributes, notes,
    });
    res.status(201).json(asset);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// PUT /api/gear/assets/:id - Update an asset
router.put('/:id', async (req, res) => {
  const {
    serial_number, asset_type_id, lifecycle_state_id, model_id, location_id,
    owner_party_id, custodian_party_id, acquired_at, disposed_at, attributes, notes,
  } = req.body;

  try {
    res.json(await updateAsset(pool, req.params.id, {
      serial_number, asset_type_id, lifecycle_state_id, model_id, location_id,
      owner_party_id, custodian_party_id, acquired_at, disposed_at, attributes, notes,
    }));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// DELETE /api/gear/assets/:id - Delete an asset
router.delete('/:id', async (req, res) => {
  try {
    await deleteAsset(pool, req.params.id);
    res.status(204).end();
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

export default router;
