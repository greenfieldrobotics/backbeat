import { Router } from 'express';
import pool, { withTransaction } from '../../../db/connection.js';
import {
  listAssets,
  getAsset,
  createAsset,
  updateAsset,
  deleteAsset,
} from '../services/assetService.js';
import { getAssetEvents } from '../services/assetEventService.js';

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

// GET /api/gear/assets/:id/events - One asset's history, newest first (G3.2).
// Read-only: there is no route anywhere that updates or deletes an event.
router.get('/:id/events', async (req, res) => {
  try {
    await getAsset(pool, req.params.id); // 404s if the asset doesn't exist
    res.json(await getAssetEvents(pool, req.params.id));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// POST /api/gear/assets - Create an asset
// Wrapped in a transaction: createAsset writes both the asset row and its
// `registered` event, and they must commit or roll back together (G3.2).
router.post('/', async (req, res) => {
  const {
    serial_number, asset_type_id, lifecycle_state_id, model_id, location_id,
    owner_party_id, custodian_party_id, acquired_at, disposed_at, attributes, notes,
  } = req.body;

  try {
    const asset = await withTransaction(client => createAsset(client, {
      serial_number, asset_type_id, lifecycle_state_id, model_id, location_id,
      owner_party_id, custodian_party_id, acquired_at, disposed_at, attributes, notes,
    }, req.user?.id));
    res.status(201).json(asset);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// PUT /api/gear/assets/:id - Update an asset
// Wrapped in a transaction for the same reason as POST above — updateAsset may
// write one event per changed dimension (state/location/custody) alongside the row
// update itself.
router.put('/:id', async (req, res) => {
  const {
    serial_number, asset_type_id, lifecycle_state_id, model_id, location_id,
    owner_party_id, custodian_party_id, acquired_at, disposed_at, attributes, notes,
  } = req.body;

  try {
    res.json(await withTransaction(client => updateAsset(client, req.params.id, {
      serial_number, asset_type_id, lifecycle_state_id, model_id, location_id,
      owner_party_id, custodian_party_id, acquired_at, disposed_at, attributes, notes,
    }, req.user?.id)));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// DELETE /api/gear/assets/:id - Delete an asset (and its event history with it)
router.delete('/:id', async (req, res) => {
  try {
    await withTransaction(client => deleteAsset(client, req.params.id));
    res.status(204).end();
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

export default router;
